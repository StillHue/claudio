/**
 * POST /v1/messages — Anthropic Messages request handler.
 * Translates to OpenAI Chat Completions, calls the upstream provider, and
 * renders the response back as Anthropic JSON or SSE.
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
  mapModel,
  requestShapeStats,
  visibleTextAgainstReasoning,
} = require('./translate')
const { readOpenAIStream } = require('./stream')
const { summarizeUpstreamError, criticalLog } = require('../wrapper/log')
const { randomUUID } = require('crypto')

async function handleMessages(req, res, ctx) {
  const maxBodyBytes = Number(process.env.CLAUDE_NATIVE_MAX_BODY_BYTES || 20 * 1024 * 1024)
  const chunks = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > maxBodyBytes) {
      return json(res, 413, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'request body too large' },
      })
    }
    chunks.push(c)
  }
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return json(res, 400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'invalid JSON body' },
    })
  }

  const provider = ctx.getProvider(body.model)
  const upstreamModel = mapModel(body.model, provider)

  // Remember picker selection as providers.json default (no Claude/Cursor
  // rewrite mid-turn — that reloads the official harness session).
  try {
    const data = typeof ctx.getProvidersData === 'function' ? ctx.getProvidersData() : null
    if (data && provider?.name && upstreamModel) {
      const { persistProvidersDefault } = require('../provider/sync')
      const cfgPath =
        typeof ctx.getProvidersPath === 'function' ? ctx.getProvidersPath() : undefined
      const saved = persistProvidersDefault(data, provider.name, upstreamModel, cfgPath)
      if (saved.changed) {
        ctx.log?.(`persisted default model → ${provider.name}/${upstreamModel}`)
      }
    }
  } catch (err) {
    ctx.log?.(`persist default model skipped: ${err.message}`)
  }

  // Images pass through as OpenAI image_url (MiMo-V2.5 Free accepts them natively).
  const messages = anthropicToOpenAIMessages(body)
  const tools = anthropicToolsToOpenAI(body.tools)
  const stream = body.stream === true
  const shape = requestShapeStats(messages, tools)

  const chatBody = {
    model: upstreamModel,
    messages,
    stream,
  }
  // Reasoning models (e.g. OpenCode big-pickle) burn tokens on `reasoning`
  // before `content`. A low max_tokens yields empty replies / hung UI.
  // But some hosts (Mistral Medium 3.5) hard-cap output at 8192.
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
  } catch {
    /* ignore */
  }

  ctx.log(
    `POST /v1/messages → ${provider.baseUrl} model=${upstreamModel} msgs=${shape.msgs} tools=${shape.tools} toolMsgs=${shape.toolMsgs} images=${shape.images} stream=${stream} max_tokens=${chatBody.max_tokens} bytes=${requestBytes}`,
  )

  const headers = { 'Content-Type': 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  let upstream
  const upstreamTimeoutMs = Number(process.env.CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS || 180000)
  try {
    // fetch() body is a Web ReadableStream (getReader) — not a Node stream (.on).
    // AbortSignal.timeout covers connect + body read for the whole upstream call.
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
        message: timedOut
          ? `upstream timed out after ${upstreamTimeoutMs}ms`
          : `upstream fetch failed: ${err.message}`,
      },
    })
  }

  if (!upstream.ok) {
    // Never leak raw provider bodies to the client. Keep a sanitized snippet
    // in the local debug log so operators can diagnose validation failures.
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
    // Expose OpenCode reasoning as Anthropic thinking (Claude Code Thoughts UI).
    // When content mirrors reasoning exactly, keep thinking for protocol echo and
    // still emit one text block so the main transcript is not empty when Thoughts
    // stay collapsed.
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
    if (!content.length) {
      criticalLog(
        `empty upstream completion model=${upstreamModel} msgs=${shape.msgs} images=${shape.images} finish=${data.choices?.[0]?.finish_reason || ''}`,
      )
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
      content,
      model: advertisedModel,
      stop_reason: finishReasonToStop(data.choices?.[0]?.finish_reason, hasTools),
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
    })
  }

  // SSE Anthropic stream
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
  /** @type {Map<number, number>} openai tool index → anthropic content index */
  const toolBlockIndex = new Map()
  let finishReason = 'end_turn'
  let openedTools = new Set()
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

  // Idempotent: Claude Code persists a text snapshot per content_block_stop.
  // Stopping twice (tool open + stream end) renders the same paragraph twice.
  const closeTextBlock = () => {
    if (!textStarted || textClosed) return
    textClosed = true
    writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
  }

  try {
    const result = await readOpenAIStream(upstream.body, {
      onReasoning(delta) {
        // Map OpenCode/ChatCompletions `reasoning` → Anthropic thinking blocks
        // so Claude Code shows Thoughts / thinking UI.
        if (!delta) return
        ensureThinkingBlock()
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: thinkingIndex,
          delta: { type: 'thinking_delta', thinking: delta },
        })
      },
      onText(delta) {
        ensureTextBlock()
        writeSse(res, 'content_block_delta', {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: delta },
        })
      },
      onToolDelta(openaiIdx, acc, tc) {
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
        finishReason = finishReasonToStop(reason, openedTools.size > 0)
      },
    })

    closeThinkingBlock()

    // No content and no thinking streamed — last-resort text from accumulated reasoning
    if (!textStarted && !openedTools.size && !thinkingStarted && result.reasoning) {
      ensureTextBlock()
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: result.reasoning },
      })
    }

    // Never emit a blank assistant turn into Claude history (becomes content:null → MiMo 400).
    if (!textStarted && !thinkingStarted && openedTools.size === 0) {
      criticalLog(
        `empty upstream stream model=${upstreamModel} msgs=${shape.msgs} images=${shape.images}`,
      )
      const notice =
        '[upstream returned no content — retry the turn; empty replies are not stored as blank assistants]'
      ensureTextBlock()
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text: notice },
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
      `stream done model=${upstreamModel} text=${result.text?.length || 0} reasoning=${result.reasoning?.length || 0} tools=${result.toolCalls?.length || 0}`,
    )
  } catch (err) {
    ctx.log(`stream error: ${err.message}`)
    try {
      writeSse(res, 'error', {
        type: 'error',
        error: { type: 'api_error', message: err.message },
      })
      res.end()
    } catch {
      /* ignore */
    }
  }
}

module.exports = { handleMessages }
