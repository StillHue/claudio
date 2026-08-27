/**
 * Responses API handler (OpenAI /responses) — e.g. muse-spark.
 */
const { json, writeSse, newMessageId } = require('./http')
const { anthropicToResponsesInput, anthropicToolsToResponses, joinResponsesUrl } = require('./translate-responses')
const { readResponsesStream } = require('./stream-responses')
const { summarizeUpstreamError, criticalLog } = require('../wrapper/log')
const { finishReasonToStop, maxOutputTokensCap } = require('./translate')
const { randomUUID } = require('crypto')

async function handleResponses(req, res, ctx, { body, provider, upstreamModel }) {
  const { items: inputItems, instructions } = anthropicToResponsesInput(body)
  const stream = body.stream === true
  const shape = { msgs: inputItems.length, tools: body.tools?.length || 0, toolMsgs: 0, images: 0 }

  const requestedMax = body.max_tokens != null ? Number(body.max_tokens) : 0
  const outputCap = maxOutputTokensCap(provider, upstreamModel)
  const floor = Math.min(8192, outputCap)
  const maxOutputTokens = Math.min(outputCap, Math.max(requestedMax || 0, floor))

  const responsesBody = {
    model: upstreamModel,
    input: inputItems,
    stream,
    max_output_tokens: maxOutputTokens,
  }
  if (instructions) responsesBody.instructions = instructions
  const tools = anthropicToolsToResponses(body.tools)
  if (tools) {
    responsesBody.tools = tools
    const tc = body.tool_choice
    if (tc && typeof tc === 'object' && tc.type === 'tool' && tc.name) responsesBody.tool_choice = { type: 'function', function: { name: tc.name } }
    else if (tc === 'any' || tc === 'required') responsesBody.tool_choice = 'required'
    else if (tc === 'none') responsesBody.tool_choice = 'none'
    else responsesBody.tool_choice = 'auto'
  }
  if (body.temperature != null) responsesBody.temperature = body.temperature
  if (body.top_p != null) responsesBody.top_p = body.top_p
  responsesBody.reasoning = { effort: 'low', summary: 'auto' }

  let requestBytes = 0
  try { requestBytes = Buffer.byteLength(JSON.stringify(responsesBody), 'utf8') } catch { /* ignore */ }

  ctx.log(`POST /v1/messages [responses] → ${provider.baseUrl} model=${upstreamModel} items=${shape.msgs} tools=${shape.tools} stream=${stream} max_output_tokens=${maxOutputTokens} bytes=${requestBytes}`)

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)
  let upstream
  try {
    upstream = await fetch(joinResponsesUrl(provider.baseUrl), {
      method: 'POST', headers, body: JSON.stringify(responsesBody), signal: AbortSignal.timeout(upstreamTimeoutMs),
    })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || /aborted|timeout/i.test(String(err?.message || err))
    ctx.log(`upstream fetch ${timedOut ? 'timeout' : 'failed'}: ${err.message}`)
    return json(res, timedOut ? 504 : 502, { type: 'error', error: { type: 'api_error', message: timedOut ? `upstream timed out after ${upstreamTimeoutMs}ms` : `upstream fetch failed: ${err.message}` } })
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    const summary = summarizeUpstreamError(errText)
    criticalLog(`upstream ${upstream.status} [responses] model=${upstreamModel} items=${shape.msgs} tools=${shape.tools} max_output_tokens=${maxOutputTokens} bytes=${requestBytes} detail=${summary}`)
    ctx.log?.(`upstream ${upstream.status} detail=${summary}`)
    return json(res, upstream.status, { type: 'error', error: { type: 'api_error', message: `upstream HTTP ${upstream.status}` } })
  }

  const messageId = newMessageId()
  const advertisedModel = body.model || upstreamModel

  if (!stream) {
    const data = await upstream.json()
    const output = Array.isArray(data.output) ? data.output : []
    const content = []; let textAcc = ''; let reasoningAcc = ''; const toolCalls = []
    for (const item of output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) if (c.type === 'output_text' && c.text) textAcc += c.text
      } else if (item.type === 'reasoning') {
        if (Array.isArray(item.summary)) for (const s of item.summary) if (s.text) reasoningAcc += s.text
      } else if (item.type === 'function_call') {
        let input = {}; try { input = JSON.parse(item.arguments || '{}') } catch { input = { raw: item.arguments || '' } }
        toolCalls.push({ id: item.call_id || item.id || `toolu_${randomUUID().slice(0, 10)}`, name: item.name || 'unknown', input })
      }
    }
    if (reasoningAcc) content.push({ type: 'thinking', thinking: reasoningAcc })
    if (textAcc) content.push({ type: 'text', text: textAcc })
    else if (reasoningAcc) content.push({ type: 'text', text: reasoningAcc })
    for (const tc of toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
    if (!content.length) {
      criticalLog(`empty responses completion model=${upstreamModel} items=${shape.msgs}`)
      return json(res, 502, { type: 'error', error: { type: 'api_error', message: 'upstream returned an empty completion (refusing to poison session history)' } })
    }
    const hasTools = toolCalls.length > 0
    const stopReason = data.incomplete_details ? 'max_tokens' : hasTools ? 'tool_use' : 'end_turn'
    return json(res, 200, {
      id: messageId, type: 'message', role: 'assistant', content, model: advertisedModel, stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 },
    })
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  writeSse(res, 'message_start', { type: 'message_start', message: { id: messageId, type: 'message', role: 'assistant', content: [], model: advertisedModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })

  let textStarted = false, textIndex = 0, textClosed = false
  let thinkingStarted = false, thinkingIndex = 0, thinkingClosed = false
  const toolBlockIndex = new Map()
  let finishReason = 'end_turn'
  let openedTools = new Set()
  let nextIndex = 0

  const ensureThinkingBlock = () => { if (thinkingStarted) return; thinkingStarted = true; thinkingIndex = nextIndex++; writeSse(res, 'content_block_start', { type: 'content_block_start', index: thinkingIndex, content_block: { type: 'thinking', thinking: '' } }) }
  const closeThinkingBlock = () => { if (!thinkingStarted || thinkingClosed) return; thinkingClosed = true; writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: thinkingIndex }) }
  const ensureTextBlock = () => { if (textStarted) return; closeThinkingBlock(); textStarted = true; textIndex = nextIndex++; writeSse(res, 'content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } }) }
  const closeTextBlock = () => { if (!textStarted || textClosed) return; textClosed = true; writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex }) }

  try {
    const result = await readResponsesStream(upstream.body, {
      onReasoning(delta) { if (!delta) return; ensureThinkingBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: thinkingIndex, delta: { type: 'thinking_delta', thinking: delta } }) },
      onText(delta) { ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: delta } }) },
      onToolDelta(openaiIdx, acc, tc) {
        closeThinkingBlock(); if (!openedTools.size) closeTextBlock()
        if (!openedTools.has(openaiIdx)) { const idx = nextIndex++; toolBlockIndex.set(openaiIdx, idx); openedTools.add(openaiIdx); writeSse(res, 'content_block_start', { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: acc.id, name: acc.name || tc.function?.name || 'unknown', input: {} } }) }
        const idx = toolBlockIndex.get(openaiIdx); const argDelta = tc.function?.arguments
        if (argDelta) writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: argDelta } })
      },
      onFinish(reason) { if (reason === 'max_tokens') finishReason = 'max_tokens'; else finishReason = finishReasonToStop(reason, openedTools.size > 0) },
    })

    closeThinkingBlock()
    if (!textStarted && !openedTools.size && !thinkingStarted && result.reasoning) {
      ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: result.reasoning } })
    }
    if (!textStarted && !thinkingStarted && openedTools.size === 0) {
      criticalLog(`empty responses stream model=${upstreamModel} items=${shape.msgs}`)
      const notice = '[upstream returned no content — retry the turn; empty replies are not stored as blank assistants]'
      ensureTextBlock(); writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: notice } })
    }
    closeTextBlock()
    for (const [, idx] of [...toolBlockIndex.entries()].sort((a, b) => a[1] - b[1])) writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: idx })
    if (openedTools.size > 0) finishReason = 'tool_use'
    writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: finishReason, stop_sequence: null }, usage: { output_tokens: 0 } })
    writeSse(res, 'message_stop', { type: 'message_stop' })
    res.end()
    ctx.log(`stream done [responses] model=${upstreamModel} text=${result.text?.length || 0} reasoning=${result.reasoning?.length || 0} tools=${result.toolCalls?.length || 0}`)
  } catch (err) {
    ctx.log(`stream error [responses]: ${err.message}`)
    try { writeSse(res, 'error', { type: 'error', error: { type: 'api_error', message: err.message } }); res.end() } catch { /* ignore */ }
  }
}

module.exports = { handleResponses }
