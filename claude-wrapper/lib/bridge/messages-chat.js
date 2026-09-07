/**
 * Chat Completions handler (OpenAI /chat/completions).
 * Buffers streams until content exists so empty upstream replies can retry
 * (same model once, then cascade — Ultra/Super for coding).
 */
const { json, writeSse, newMessageId } = require('./http')
const {
  anthropicToOpenAIMessages,
  anthropicToolsToOpenAI,
  mapToolChoice,
  extractReasoning,
  extractMessageText,
  finishReasonToStop,
  joinChatUrl,
  maxOutputTokensCap,
  requestShapeStats,
  visibleTextAgainstReasoning,
} = require('./translate')
const { readOpenAIStream } = require('./stream')
const { summarizeUpstreamError, criticalLog } = require('../wrapper/log')
const { resolveVisionInMessages, isVisionUpstreamModel } = require('./vision-describer')
const { autoPruneMessages } = require('./prune')
const { shouldRetryUpstream } = require('./auto-router')
const { randomUUID } = require('crypto')

function messagesHaveImageUrl(messages) {
  if (!Array.isArray(messages)) return false
  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) continue
    if (msg.content.some((p) => p && p.type === 'image_url')) return true
  }
  return false
}

function completionFromChatData(data) {
  const msg = data.choices?.[0]?.message || {}
  const content = []
  const reasoning = extractReasoning(msg)
  const rawText = extractMessageText(msg)
  const text = visibleTextAgainstReasoning(reasoning, rawText)
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning })
  if (text) content.push({ type: 'text', text })
  else if (reasoning) content.push({ type: 'text', text: reasoning })
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      let input = {}
      try {
        input = JSON.parse(tc.function?.arguments || '{}')
      } catch {
        input = { raw: tc.function?.arguments || '' }
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${randomUUID().slice(0, 10)}`,
        name: tc.function?.name || 'unknown',
        input,
      })
    }
  }
  const hasTools = (msg.tool_calls || []).length > 0
  return {
    content,
    hasTools,
    finishReason: data.choices?.[0]?.finish_reason,
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    upstreamModelId: data?.model,
  }
}

function streamHasContent(result) {
  return !!(
    (result.text && result.text.length) ||
    (result.reasoning && result.reasoning.length) ||
    (result.toolCalls && result.toolCalls.length)
  )
}

async function handleChat(req, res, ctx, { body, provider, upstreamModel }) {
  const rawMessages = anthropicToOpenAIMessages(body)
  const cascade =
    Array.isArray(body.__nvidiaFallbackCascade) && body.__nvidiaFallbackCascade.length
      ? body.__nvidiaFallbackCascade
      : [upstreamModel]

  const tools = anthropicToolsToOpenAI(body.tools)
  const wantStream = body.stream === true
  const advertisedModel = body.model || upstreamModel

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  if (provider.name === 'openrouter') {
    headers['HTTP-Referer'] =
      process.env.OPENROUTER_HTTP_REFERER || 'https://github.com/StillHue/claudio'
    headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'claudio-wrapper'
  }

  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)
  const visionCache = new Map()

  async function messagesForModel(model) {
    if (visionCache.has(model)) return visionCache.get(model)
    const resolved = await resolveVisionInMessages(rawMessages, provider, ctx, model)
    const pruneResult = autoPruneMessages(resolved)
    if (pruneResult.pruned) {
      ctx.log?.(
        `[micro-compact] pruned payload from ${(pruneResult.beforeBytes / 1024).toFixed(1)} KB → ${(pruneResult.afterBytes / 1024).toFixed(1)} KB`,
      )
    }
    visionCache.set(model, pruneResult.messages)
    return pruneResult.messages
  }

  async function prepareChatBody(model, { stream }) {
    let messages = await messagesForModel(model)
    if (!isVisionUpstreamModel(model) && messagesHaveImageUrl(messages)) {
      messages = await resolveVisionInMessages(rawMessages, provider, ctx, model)
      const pruneResult = autoPruneMessages(messages)
      messages = pruneResult.messages
      visionCache.set(model, messages)
    }
    const shape = requestShapeStats(messages, tools)
    const chatBody = {
      model,
      messages,
      stream,
    }
    const requestedMax = body.max_tokens != null ? Number(body.max_tokens) : 0
    const outputCap = maxOutputTokensCap(provider, model)
    const floor = Math.min(8192, outputCap)
    chatBody.max_tokens = Math.min(outputCap, Math.max(requestedMax || 0, floor))
    if (body.temperature != null) chatBody.temperature = body.temperature
    if (body.top_p != null) chatBody.top_p = body.top_p
    if (body.stop_sequences) chatBody.stop = body.stop_sequences
    if (tools) {
      chatBody.tools = tools
      chatBody.tool_choice = mapToolChoice(body.tool_choice)
    }
    if (Array.isArray(body.__openRouterPlugins) && body.__openRouterPlugins.length) {
      chatBody.plugins = body.__openRouterPlugins
    }
    if (body.__openRouterSessionId) {
      chatBody.session_id = body.__openRouterSessionId
    }
    let requestBytes = 0
    try {
      requestBytes = Buffer.byteLength(JSON.stringify(chatBody), 'utf8')
    } catch {
      /* ignore */
    }
    return { chatBody, shape, requestBytes }
  }

  // Attempt queue: cascade models; empty content inserts one same-model retry.
  const attempts = cascade.map((model) => ({ model, emptyRetry: false }))
  const emptyRetried = new Set()
  let lastSummary = ''
  let lastShape = { msgs: 0, tools: 0, images: 0 }

  for (let i = 0; i < attempts.length; i++) {
    const { model: activeModel, emptyRetry } = attempts[i]
    const { chatBody, shape, requestBytes } = await prepareChatBody(activeModel, {
      stream: wantStream,
    })
    lastShape = shape

    ctx.log(
      `POST /v1/messages → ${provider.baseUrl} model=${activeModel} msgs=${shape.msgs} tools=${shape.tools} toolMsgs=${shape.toolMsgs} images=${shape.images} stream=${wantStream} max_tokens=${chatBody.max_tokens} bytes=${requestBytes}${emptyRetry ? ' emptyRetry=1' : ''}`,
    )

    let upstream
    try {
      upstream = await fetch(joinChatUrl(provider.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(chatBody),
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      })
    } catch (err) {
      const timedOut = shouldRetryUpstream(0, err)
      ctx.log(`upstream fetch ${timedOut ? 'timeout' : 'failed'}: ${err.message}`)
      if (timedOut && i < attempts.length - 1) {
        ctx.log(`[auto-router] ${activeModel}→${attempts[i + 1].model} reason=timeout`)
        continue
      }
      return json(res, timedOut ? 504 : 502, {
        type: 'error',
        error: {
          type: 'api_error',
          message: timedOut
            ? `upstream timed out after ${upstreamTimeoutMs}ms`
            : `upstream fetch failed: ${err.message}`,
        },
      })
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      lastSummary = summarizeUpstreamError(errText)
      criticalLog(
        `upstream ${upstream.status} model=${activeModel} msgs=${shape.msgs} tools=${shape.tools} images=${shape.images} max_tokens=${chatBody.max_tokens} bytes=${requestBytes} detail=${lastSummary}`,
      )
      ctx.log?.(`upstream ${upstream.status} detail=${lastSummary}`)
      if (shouldRetryUpstream(upstream.status) && i < attempts.length - 1) {
        ctx.log(`[auto-router] ${activeModel}→${attempts[i + 1].model} reason=${upstream.status}`)
        continue
      }
      return json(res, upstream.status, {
        type: 'error',
        error: { type: 'api_error', message: `upstream HTTP ${upstream.status}` },
      })
    }

    const messageId = newMessageId()

    if (!wantStream) {
      const data = await upstream.json()
      if (provider.name === 'openrouter' && data?.model) {
        ctx.log?.(`[openrouter] upstream-resolved-model=${data.model}`)
      }
      const parsed = completionFromChatData(data)
      if (!parsed.content.length) {
        criticalLog(
          `empty upstream completion model=${activeModel} msgs=${shape.msgs} images=${shape.images} finish=${parsed.finishReason || ''}`,
        )
        if (!emptyRetried.has(activeModel)) {
          emptyRetried.add(activeModel)
          attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
          ctx.log(`[auto-router] ${activeModel} empty→retry same`)
          continue
        }
        if (i < attempts.length - 1) {
          ctx.log(`[auto-router] ${activeModel}→${attempts[i + 1].model} reason=empty`)
          continue
        }
        return json(res, 502, {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'upstream returned an empty completion (refusing to poison session history)',
          },
        })
      }
      return json(res, 200, {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: parsed.content,
        model: advertisedModel,
        stop_reason: finishReasonToStop(parsed.finishReason, parsed.hasTools),
        stop_sequence: null,
        usage: parsed.usage,
      })
    }

    // Stream: buffer until we know there is content, then flush SSE.
    const buffered = []
    let finishReason = 'end_turn'
    const result = await readOpenAIStream(upstream.body, {
      onReasoning(delta) {
        if (!delta) return
        buffered.push({ kind: 'reasoning', delta })
      },
      onText(delta) {
        buffered.push({ kind: 'text', delta })
      },
      onToolDelta(openaiIdx, acc, tc) {
        buffered.push({ kind: 'tool', openaiIdx, acc, tc })
      },
      onFinish(reason) {
        finishReason = finishReasonToStop(reason, false)
      },
    })

    if (!streamHasContent(result)) {
      criticalLog(
        `empty upstream stream model=${activeModel} msgs=${shape.msgs} images=${shape.images}`,
      )
      if (!emptyRetried.has(activeModel)) {
        emptyRetried.add(activeModel)
        attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
        ctx.log(`[auto-router] ${activeModel} empty→retry same`)
        continue
      }
      if (i < attempts.length - 1) {
        ctx.log(`[auto-router] ${activeModel}→${attempts[i + 1].model} reason=empty`)
        continue
      }
      // All attempts empty — surface notice (headers not yet sent).
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      writeSse(res, 'message_start', {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: advertisedModel,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })
      const notice =
        '[upstream returned no content after retries — retry the turn; empty replies are not stored as blank assistants]'
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: notice },
      })
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
      writeSse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 0 },
      })
      writeSse(res, 'message_stop', { type: 'message_stop' })
      res.end()
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    writeSse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: advertisedModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    let textStarted = false
    let textIndex = 0
    let textClosed = false
    let thinkingStarted = false
    let thinkingIndex = 0
    let thinkingClosed = false
    const toolBlockIndex = new Map()
    const openedTools = new Set()
    let nextIndex = 0

    const ensureThinkingBlock = () => {
      if (thinkingStarted) return
      thinkingStarted = true
      thinkingIndex = nextIndex++
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: thinkingIndex,
        content_block: { type: 'thinking', thinking: '' },
      })
    }
    const closeThinkingBlock = () => {
      if (!thinkingStarted || thinkingClosed) return
      thinkingClosed = true
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: thinkingIndex })
    }
    const ensureTextBlock = () => {
      if (textStarted) return
      closeThinkingBlock()
      textStarted = true
      textIndex = nextIndex++
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'text', text: '' },
      })
    }
    const closeTextBlock = () => {
      if (!textStarted || textClosed) return
      textClosed = true
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
    }

    try {
      for (const ev of buffered) {
        if (ev.kind === 'reasoning') {
          ensureThinkingBlock()
          writeSse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: thinkingIndex,
            delta: { type: 'thinking_delta', thinking: ev.delta },
          })
        } else if (ev.kind === 'text') {
          ensureTextBlock()
          writeSse(res, 'content_block_delta', {
            type: 'content_block_delta',
            index: textIndex,
            delta: { type: 'text_delta', text: ev.delta },
          })
        } else if (ev.kind === 'tool') {
          closeThinkingBlock()
          if (!openedTools.size) closeTextBlock()
          const { openaiIdx, acc, tc } = ev
          if (!openedTools.has(openaiIdx)) {
            const idx = nextIndex++
            toolBlockIndex.set(openaiIdx, idx)
            openedTools.add(openaiIdx)
            writeSse(res, 'content_block_start', {
              type: 'content_block_start',
              index: idx,
              content_block: {
                type: 'tool_use',
                id: acc.id,
                name: acc.name || tc.function?.name || 'unknown',
                input: {},
              },
            })
          }
          const idx = toolBlockIndex.get(openaiIdx)
          const argDelta = tc.function?.arguments
          if (argDelta) {
            writeSse(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'input_json_delta', partial_json: argDelta },
            })
          }
        }
      }

      closeThinkingBlock()
      if (!textStarted && !openedTools.size && !thinkingStarted && result.reasoning) {
        ensureTextBlock()
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: result.reasoning },
        })
      }
      closeTextBlock()
      for (const [, idx] of [...toolBlockIndex.entries()].sort((a, b) => a[1] - b[1])) {
        writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: idx })
      }
      if (openedTools.size > 0) finishReason = 'tool_use'
      writeSse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: finishReason, stop_sequence: null },
        usage: { output_tokens: 0 },
      })
      writeSse(res, 'message_stop', { type: 'message_stop' })
      res.end()
      ctx.log(
        `stream done model=${activeModel} text=${result.text?.length || 0} reasoning=${result.reasoning?.length || 0} tools=${result.toolCalls?.length || 0}`,
      )
    } catch (err) {
      ctx.log(`stream error: ${err.message}`)
      try {
        writeSse(res, 'error', { type: 'error', error: { type: 'api_error', message: err.message } })
        res.end()
      } catch {
        /* ignore */
      }
    }
    return
  }

  return json(res, 502, {
    type: 'error',
    error: {
      type: 'api_error',
      message: lastSummary || `upstream failed after fallback cascade (msgs=${lastShape.msgs})`,
    },
  })
}

module.exports = { handleChat }
