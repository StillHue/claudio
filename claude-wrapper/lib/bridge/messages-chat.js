/**
 * Chat Completions handler (OpenAI /chat/completions).
 * Transient upstream failures and empty responses get one same-model retry.
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
const { randomUUID } = require('crypto')
const { estimateTokens, estimateInputTokens } = require('./count-tokens')

function isUpstreamTimeout(err) {
  const name = err?.name || ''
  const msg = String(err?.message || err)
  return name === 'TimeoutError' || /aborted|timeout|econnreset|fetch failed/i.test(msg)
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function retryDelayMs() {
  const configured = Number(process.env.CLAUDE_NATIVE_RETRY_DELAY_MS || 250)
  return Number.isFinite(configured) && configured >= 0 ? Math.min(configured, 5000) : 250
}

async function waitBeforeRetry() {
  const delay = retryDelayMs()
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
}

function hasUsageValue(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function completionFromChatData(data, requestBody) {
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
  const outputText = [
    text,
    reasoning,
    ...(msg.tool_calls || []).map((tc) => tc.function?.arguments || ''),
  ].join('')
  const usage = data.usage || {}
  const hasInputUsage = hasUsageValue(usage.prompt_tokens)
  const hasOutputUsage = hasUsageValue(usage.completion_tokens)
  return {
    content,
    hasTools,
    finishReason: data.choices?.[0]?.finish_reason,
    usage: {
      input_tokens: hasInputUsage ? Number(usage.prompt_tokens) : estimateInputTokens(requestBody),
      output_tokens: hasOutputUsage ? Number(usage.completion_tokens) : estimateTokens(outputText),
    },
    usageSource: {
      input: hasInputUsage ? 'provider' : 'estimate',
      output: hasOutputUsage ? 'provider' : 'estimate',
    },
    upstreamModelId: data?.model,
  }
}

async function handleChat(req, res, ctx, { body, provider, upstreamModel }) {
  const rawMessages = anthropicToOpenAIMessages(body)

  const tools = anthropicToolsToOpenAI(body.tools)
  const wantStream = body.stream === true
  const advertisedModel = body.model || upstreamModel

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)

  async function prepareChatBody(model, { stream }) {
    const messages = rawMessages
    const shape = requestShapeStats(messages, tools)
    const chatBody = {
      model,
      messages,
      stream,
    }
    if (stream && includeStreamUsage) chatBody.stream_options = { include_usage: true }
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

  let lastSummary = ''
  let lastShape = { msgs: 0, tools: 0, images: 0 }
  let includeStreamUsage = wantStream

  // Pass 0, then one same-model retry on transient upstream failures, empty
  // bodies, or an error inside HTTP 200.
  for (let pass = 0; pass < 2; pass++) {
    const activeModel = upstreamModel
    const emptyRetry = pass === 1
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
      const timedOut = isUpstreamTimeout(err)
      ctx.log(`upstream fetch ${timedOut ? 'timeout' : 'failed'}: ${err.message}`)
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
      if (
        pass === 0 &&
        wantStream &&
        includeStreamUsage &&
        upstream.status === 400 &&
        /(?:unknown|unrecognized|unsupported|invalid|not allowed).{0,40}(?:stream_options|include_usage)|(?:stream_options|include_usage).{0,40}(?:unknown|unrecognized|unsupported|invalid|not allowed)/i.test(
          errText,
        )
      ) {
        includeStreamUsage = false
        ctx.log('[compat] upstream rejected stream usage option; retrying without it')
        continue
      }
      if (pass === 0 && isRetryableStatus(upstream.status)) {
        ctx.log(`[retry] ${activeModel} HTTP ${upstream.status}→retry same`)
        await waitBeforeRetry()
        continue
      }
      criticalLog(
        `upstream ${upstream.status} model=${activeModel} msgs=${shape.msgs} tools=${shape.tools} images=${shape.images} max_tokens=${chatBody.max_tokens} bytes=${requestBytes} detail=${lastSummary}`,
      )
      ctx.log?.(`upstream ${upstream.status} detail=${lastSummary}`)
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
        if (pass === 0) {
          ctx.log(`[retry] ${activeModel} body-error→retry same`)
          continue
        }
        return json(res, errCode, {
          type: 'error',
          error: { type: errType, message: `upstream ${errCode}: ${errMsg}` },
        })
      }
      const parsed = completionFromChatData(data, body)
      if (!parsed.content.length) {
        criticalLog(
          `empty upstream completion model=${activeModel} msgs=${shape.msgs} images=${shape.images} finish=${parsed.finishReason || ''}`,
        )
        if (pass === 0) {
          ctx.log(`[retry] ${activeModel} empty→retry same`)
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
      ctx.log(
        `completion usage input_tokens=${parsed.usage.input_tokens}(${parsed.usageSource.input}) output_tokens=${parsed.usage.output_tokens}(${parsed.usageSource.output})`,
      )
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
          usage: {
            input_tokens: estimateInputTokens(body),
            output_tokens: 0,
          },
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
      if (textStarted && !textClosed) return
      sendHeaders()
      closeThinkingBlock()
      textStarted = true
      textClosed = false
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
        if (!delta || thinkingClosed || openedTools.size) return
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
      if (pass === 0) {
        ctx.log(`[retry] ${activeModel} stream-error→retry same`)
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
      if (pass === 0) {
        ctx.log(`[retry] ${activeModel} empty→retry same`)
        continue
      }
      return json(res, 502, {
        type: 'error',
        error: { type: 'api_error', message: 'upstream returned an empty completion' },
      })
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
      const outputUsage = Number(result.usage?.completion_tokens)
      const hasOutputUsage = hasUsageValue(result.usage?.completion_tokens)
      const inputUsage = Number(result.usage?.prompt_tokens)
      const hasInputUsage = hasUsageValue(result.usage?.prompt_tokens)
      const estimatedOutputTokens = estimateTokens(
        [
          result.text,
          result.reasoning,
          ...(result.toolCalls || []).map((tool) => tool.arguments || ''),
        ].join(''),
      )
      writeSse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: finishReason, stop_sequence: null },
        usage: { output_tokens: hasOutputUsage ? outputUsage : estimatedOutputTokens },
      })
      writeSse(res, 'message_stop', { type: 'message_stop' })
      res.end()
      ctx.log(
        `stream done model=${activeModel} text=${result.text?.length || 0} reasoning=${result.reasoning?.length || 0} tools=${result.toolCalls?.length || 0} input_tokens=${estimateInputTokens(body)}(estimated)${hasInputUsage ? ` provider_input_tokens=${inputUsage}` : ''} output_tokens=${hasOutputUsage ? outputUsage : estimatedOutputTokens}${hasOutputUsage ? '' : '(estimated)'}`,
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
      message: lastSummary || `upstream failed (msgs=${lastShape.msgs})`,
    },
  })
}

module.exports = { handleChat }
