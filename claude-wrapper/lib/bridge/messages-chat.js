/**
 * Chat Completions handler (OpenAI /chat/completions).
 * Full tool schemas (no compact). Prunes only oversized old tool dumps.
 * Empty upstream → one same-model retry, then optional cascade.
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
const { autoPruneMessages } = require('./prune')
const { shouldRetryUpstream } = require('./auto-router')
const { randomUUID } = require('crypto')

/** Replace image_url parts with a short text stub for text-only providers. */
function stripImagesFromMessages(messages) {
  if (!Array.isArray(messages)) return messages
  return messages.map((msg) => {
    if (!Array.isArray(msg?.content)) return msg
    const content = msg.content.map((p) => {
      if (p && p.type === 'image_url') {
        return { type: 'text', text: '[image omitted — text-only model]' }
      }
      return p
    })
    return { ...msg, content }
  })
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

async function handleChat(req, res, ctx, { body, provider, upstreamModel }) {
  const rawMessages = anthropicToOpenAIMessages(body)
  const cascade =
    Array.isArray(body.__fallbackCascade) && body.__fallbackCascade.length
      ? body.__fallbackCascade
      : [upstreamModel]

  const tools = anthropicToolsToOpenAI(body.tools)
  const wantStream = body.stream === true
  const advertisedModel = body.model || upstreamModel
  const pruneMaxBytes = Number(process.env.CLAUDE_NATIVE_PRUNE_MAX_BYTES || 220000)
  const pruneKeepRecent = Number(process.env.CLAUDE_NATIVE_PRUNE_KEEP_RECENT || 16)

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)
  const messagesCache = new Map()

  async function messagesForModel(model) {
    if (messagesCache.has(model)) return messagesCache.get(model)
    // Vision is opt-in per provider (`"vision": true` in providers.json);
    // text-only models get image stubs instead of base64 payloads.
    const base = provider?.vision === true ? rawMessages : stripImagesFromMessages(rawMessages)
    const pruneResult = autoPruneMessages(base, pruneMaxBytes, pruneKeepRecent)
    if (pruneResult.pruned) {
      ctx.log?.(
        `[micro-compact] pruned payload from ${(pruneResult.beforeBytes / 1024).toFixed(1)} KB → ${(pruneResult.afterBytes / 1024).toFixed(1)} KB`,
      )
    }
    messagesCache.set(model, pruneResult.messages)
    return pruneResult.messages
  }

  async function prepareChatBody(model, { stream }) {
    const messages = await messagesForModel(model)
    const shape = requestShapeStats(messages, tools)
    const chatBody = {
      model,
      messages,
      stream,
    }
    const requestedMax = body.max_tokens != null ? Number(body.max_tokens) : 0
    const outputCap = maxOutputTokensCap()
    // Prefer Claude Code's budget; do not invent high floors that bloat reservations.
    const preferred = requestedMax > 0 ? requestedMax : outputCap
    chatBody.max_tokens = Math.min(outputCap, preferred)
    if (body.temperature != null) chatBody.temperature = body.temperature
    if (body.top_p != null) chatBody.top_p = body.top_p
    if (body.stop_sequences) chatBody.stop = body.stop_sequences
    if (tools) {
      chatBody.tools = tools
      chatBody.tool_choice = mapToolChoice(body.tool_choice)
    }
    let requestBytes = 0
    let serialized = ''
    try {
      serialized = JSON.stringify(chatBody)
      requestBytes = Buffer.byteLength(serialized, 'utf8')
    } catch {
      /* ignore */
    }
    return { chatBody, serialized, shape, requestBytes }
  }

  const attempts = cascade.map((model) => ({ model, emptyRetry: false }))
  const emptyRetried = new Set()
  let lastSummary = ''
  let lastShape = { msgs: 0, tools: 0, images: 0 }

  for (let i = 0; i < attempts.length; i++) {
    const { model: activeModel, emptyRetry } = attempts[i]
    const { chatBody, serialized, shape, requestBytes } = await prepareChatBody(activeModel, {
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
        body: serialized || JSON.stringify(chatBody),
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      })
    } catch (err) {
      const timedOut = shouldRetryUpstream(0, err)
      ctx.log(`upstream fetch ${timedOut ? 'timeout' : 'failed'}: ${err.message}`)
      if (timedOut && i < attempts.length - 1) {
        ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=timeout`)
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
        ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=${upstream.status}`)
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
      if (data && data.error) {
        const errCode = Number(data.error.code) || 500
        const errMsg = String(data.error.message || 'upstream error')
        const errType = String(data.error.type || 'api_error')
        lastSummary = summarizeUpstreamError(JSON.stringify(data.error))
        criticalLog(
          `upstream body-error ${errCode} model=${activeModel} msgs=${shape.msgs} images=${shape.images} detail=${lastSummary}`,
        )
        if (!emptyRetried.has(activeModel) && i >= attempts.length - 1) {
          emptyRetried.add(activeModel)
          attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
          ctx.log(`[retry] ${activeModel} body-error→retry same`)
          continue
        }
        if (shouldRetryUpstream(errCode) && i < attempts.length - 1) {
          ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=${errCode}`)
          continue
        }
        return json(res, errCode, {
          type: 'error',
          error: { type: errType, message: `upstream ${errCode}: ${errMsg}` },
        })
      }
      const parsed = completionFromChatData(data)
      if (!parsed.content.length) {
        criticalLog(
          `empty upstream completion model=${activeModel} msgs=${shape.msgs} images=${shape.images} finish=${parsed.finishReason || ''}`,
        )
        // Single-model cascade: one same-model retry. With a fallback
        // available, skip it and go straight to the next model — a second
        // full-latency call on a flaky model is pure wait.
        if (!emptyRetried.has(activeModel) && i >= attempts.length - 1) {
          emptyRetried.add(activeModel)
          attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
          ctx.log(`[retry] ${activeModel} empty→retry same`)
          continue
        }
        if (i < attempts.length - 1) {
          ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=empty`)
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

    // Stream: forward deltas live; headers go out on first content so an
    // empty upstream still ends as a notice, never a hung socket.
    let headersSent = false
    let finishReason = 'end_turn'
    let textStarted = false
    let textIndex = 0
    let textClosed = false
    let thinkingStarted = false
    let thinkingIndex = 0
    let thinkingClosed = false
    const toolBlockIndex = new Map()
    const openedTools = new Set()
    let nextIndex = 0

    const sendHeaders = () => {
      if (headersSent) return
      headersSent = true
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
    }
    const ensureThinkingBlock = () => {
      if (thinkingStarted) return
      sendHeaders()
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
      sendHeaders()
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

    const result = await readOpenAIStream(upstream.body, {
      onReasoning(delta) {
        if (!delta) return
        ensureThinkingBlock()
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: thinkingIndex,
          delta: { type: 'thinking_delta', thinking: delta },
        })
      },
      onText(delta) {
        if (!delta) return
        ensureTextBlock()
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: delta },
        })
      },
      onToolDelta(openaiIdx, acc, tc) {
        sendHeaders()
        closeThinkingBlock()
        if (!openedTools.size) closeTextBlock()
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
      },
      onFinish(reason) {
        finishReason = finishReasonToStop(reason, false)
      },
    })

    const hasStreamContent = !!(
      (result.text && result.text.length) ||
      (result.reasoning && result.reasoning.length) ||
      (result.toolCalls && result.toolCalls.length)
    )
    // Upstream error smuggled inside HTTP 200 SSE (e.g. Nvidia 503
    // "Service temporarily overloaded"). Propagate the real status so the
    // client can retry, instead of mislabeling it an empty completion.
    if (result.streamError && !hasStreamContent) {
      const errCode = Number(result.streamError.code) || 500
      const errMsg = String(result.streamError.message || 'upstream stream error')
      const errType = String(result.streamError.type || 'api_error')
      lastSummary = summarizeUpstreamError(JSON.stringify(result.streamError))
      criticalLog(
        `upstream stream-error ${errCode} model=${activeModel} msgs=${shape.msgs} images=${shape.images} detail=${lastSummary}`,
      )
      if (!emptyRetried.has(activeModel) && i >= attempts.length - 1) {
        emptyRetried.add(activeModel)
        attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
        ctx.log(`[retry] ${activeModel} stream-error→retry same`)
        continue
      }
      if (shouldRetryUpstream(errCode) && i < attempts.length - 1) {
        ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=${errCode}`)
        continue
      }
      return json(res, errCode, {
        type: 'error',
        error: { type: errType, message: `upstream ${errCode}: ${errMsg}` },
      })
    }
    if (!hasStreamContent) {
      criticalLog(
        `empty upstream stream model=${activeModel} msgs=${shape.msgs} images=${shape.images}`,
      )
      // Single-model cascade: one same-model retry. With a fallback
      // available, skip it and go straight to the next model.
      if (!emptyRetried.has(activeModel) && i >= attempts.length - 1) {
        emptyRetried.add(activeModel)
        attempts.splice(i + 1, 0, { model: activeModel, emptyRetry: true })
        ctx.log(`[retry] ${activeModel} empty→retry same`)
        continue
      }
        if (i < attempts.length - 1) {
          ctx.log(`[retry] ${activeModel}→${attempts[i + 1].model} reason=empty`)
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

    // Live deltas already flowed above (or this is the all-dupe edge: full
    // reasoning accumulated with zero emitted deltas — surface it as text).
    sendHeaders()

    try {
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
