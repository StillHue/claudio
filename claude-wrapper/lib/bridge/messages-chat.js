/**
 * Chat Completions handler (OpenAI /chat/completions).
 * Extracted from messages.js for SRP.
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
const { resolveVisionInMessages } = require('./vision-describer')
const { autoPruneMessages } = require('./prune')
const { randomUUID } = require('crypto')

async function handleChat(req, res, ctx, { body, provider, upstreamModel }) {
  const rawMessages = anthropicToOpenAIMessages(body)
  const messagesWithVision = await resolveVisionInMessages(rawMessages, provider, ctx)
  const pruneResult = autoPruneMessages(messagesWithVision)
  const messages = pruneResult.messages
  if (pruneResult.pruned) {
    ctx.log?.(
      `[micro-compact] pruned payload from ${(pruneResult.beforeBytes / 1024).toFixed(1)} KB → ${(pruneResult.afterBytes / 1024).toFixed(1)} KB`,
    )
  }
  const tools = anthropicToolsToOpenAI(body.tools)
  const stream = body.stream === true
  const shape = requestShapeStats(messages, tools)

  const chatBody = {
    model: upstreamModel,
    messages,
    stream,
  }
  const requestedMax = body.max_tokens != null ? Number(body.max_tokens) : 0
  const outputCap = maxOutputTokensCap(provider, upstreamModel)
  const floor = Math.min(8192, outputCap)
  chatBody.max_tokens = Math.min(outputCap, Math.max(requestedMax || 0, floor))
  if (body.temperature != null) chatBody.temperature = body.temperature
  if (body.top_p != null) chatBody.top_p = body.top_p
  if (body.stop_sequences) chatBody.stop = body.stop_sequences
  if (tools) {
    chatBody.tools = tools
    chatBody.tool_choice = mapToolChoice(body.tool_choice)
  }

  let requestBytes = 0
  try {
    requestBytes = Buffer.byteLength(JSON.stringify(chatBody), 'utf8')
  } catch { /* ignore */ }

  ctx.log(
    `POST /v1/messages → ${provider.baseUrl} model=${upstreamModel} msgs=${shape.msgs} tools=${shape.tools} toolMsgs=${shape.toolMsgs} images=${shape.images} stream=${stream} max_tokens=${chatBody.max_tokens} bytes=${requestBytes}`,
  )

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  let upstream
  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)
  try {
    upstream = await fetch(joinChatUrl(provider.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || /aborted|timeout/i.test(String(err?.message || err))
    ctx.log(`upstream fetch ${timedOut ? 'timeout' : 'failed'}: ${err.message}`)
    return json(res, timedOut ? 504 : 502, {
      type: 'error',
      error: {
        type: 'api_error',
        message: timedOut ? `upstream timed out after ${upstreamTimeoutMs}ms` : `upstream fetch failed: ${err.message}`,
      },
    })
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    const summary = summarizeUpstreamError(errText)
    criticalLog(
      `upstream ${upstream.status} model=${upstreamModel} msgs=${shape.msgs} tools=${shape.tools} images=${shape.images} max_tokens=${chatBody.max_tokens} bytes=${requestBytes} detail=${summary}`,
    )
    ctx.log?.(`upstream ${upstream.status} detail=${summary}`)
    return json(res, upstream.status, {
      type: 'error',
      error: { type: 'api_error', message: `upstream HTTP ${upstream.status}` },
    })
  }

  const messageId = newMessageId()
  const advertisedModel = body.model || upstreamModel

  if (!stream) {
    const data = await upstream.json()
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
        try { input = JSON.parse(tc.function?.arguments || '{}') } catch { input = { raw: tc.function?.arguments || '' } }
        content.push({ type: 'tool_use', id: tc.id || `toolu_${randomUUID().slice(0, 10)}`, name: tc.function?.name || 'unknown', input })
      }
    }
    const hasTools = (msg.tool_calls || []).length > 0
    if (!content.length) {
      criticalLog(`empty upstream completion model=${upstreamModel} msgs=${shape.msgs} images=${shape.images} finish=${data.choices?.[0]?.finish_reason || ''}`)
      return json(res, 502, {
        type: 'error',
        error: { type: 'api_error', message: 'upstream returned an empty completion (refusing to poison session history)' },
      })
    }
    return json(res, 200, {
      id: messageId, type: 'message', role: 'assistant', content, model: advertisedModel,
      stop_reason: finishReasonToStop(data.choices?.[0]?.finish_reason, hasTools), stop_sequence: null,
      usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 },
    })
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  writeSse(res, 'message_start', {
    type: 'message_start',
    message: { id: messageId, type: 'message', role: 'assistant', content: [], model: advertisedModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
  })

  let textStarted = false, textIndex = 0, textClosed = false
  let thinkingStarted = false, thinkingIndex = 0, thinkingClosed = false
  const toolBlockIndex = new Map()
  let finishReason = 'end_turn'
  let openedTools = new Set()
  let nextIndex = 0

  const ensureThinkingBlock = () => {
    if (thinkingStarted) return
    thinkingStarted = true; thinkingIndex = nextIndex++
    writeSse(res, 'content_block_start', { type: 'content_block_start', index: thinkingIndex, content_block: { type: 'thinking', thinking: '' } })
  }
  const closeThinkingBlock = () => {
    if (!thinkingStarted || thinkingClosed) return
    thinkingClosed = true; writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: thinkingIndex })
  }
  const ensureTextBlock = () => {
    if (textStarted) return
    closeThinkingBlock(); textStarted = true; textIndex = nextIndex++
    writeSse(res, 'content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } })
  }
  const closeTextBlock = () => {
    if (!textStarted || textClosed) return
    textClosed = true; writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
  }

  try {
    const result = await readOpenAIStream(upstream.body, {
      onReasoning(delta) { if (!delta) return; ensureThinkingBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: thinkingIndex, delta: { type: 'thinking_delta', thinking: delta } }) },
      onText(delta) { ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: delta } }) },
      onToolDelta(openaiIdx, acc, tc) {
        closeThinkingBlock(); if (!openedTools.size) closeTextBlock()
        if (!openedTools.has(openaiIdx)) { const idx = nextIndex++; toolBlockIndex.set(openaiIdx, idx); openedTools.add(openaiIdx); writeSse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: acc.id, name: acc.name || tc.function?.name || 'unknown', input: {} } }) }
        const idx = toolBlockIndex.get(openaiIdx); const argDelta = tc.function?.arguments
        if (argDelta) writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: argDelta } })
      },
      onFinish(reason) { finishReason = finishReasonToStop(reason, openedTools.size > 0) },
    })

    closeThinkingBlock()
    if (!textStarted && !openedTools.size && !thinkingStarted && result.reasoning) {
      ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: result.reasoning } })
    }
    if (!textStarted && !thinkingStarted && openedTools.size === 0) {
      criticalLog(`empty upstream stream model=${upstreamModel} msgs=${shape.msgs} images=${shape.images}`)
      const notice = '[upstream returned no content — retry the turn; empty replies are not stored as blank assistants]'
      ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: notice } })
    }
    closeTextBlock()
    for (const [, idx] of [...toolBlockIndex.entries()].sort((a, b) => a[1] - b[1])) writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: idx })
    if (openedTools.size > 0) finishReason = 'tool_use'
    writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: finishReason, stop_sequence: null }, usage: { output_tokens: 0 } })
    writeSse(res, 'message_stop', { type: 'message_stop' })
    res.end()
    ctx.log(`stream done model=${upstreamModel} text=${result.text?.length || 0} reasoning=${result.reasoning?.length || 0} tools=${result.toolCalls?.length || 0}`)
  } catch (err) {
    ctx.log(`stream error: ${err.message}`)
    try { writeSse(res, 'error', { type: 'error', error: { type: 'api_error', message: err.message } }); res.end() } catch { /* ignore */ }
  }
}

module.exports = { handleChat }
