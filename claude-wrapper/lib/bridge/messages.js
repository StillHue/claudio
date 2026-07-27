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
} = require('./translate')
const { readOpenAIStream } = require('./stream')
const { randomUUID } = require('crypto')
const {
  bodyHasImages,
  routeImagesInBody,
  visionEnabled,
  visionAvailable,
} = require('../../vision-route')

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

  // Text-only providers (OpenCode/Cohere) reject image_url → describe via Groq first
  if (bodyHasImages(body)) {
    if (visionEnabled()) {
      try {
        await routeImagesInBody(body, ctx.log)
      } catch (err) {
        ctx.log(`vision route failed: ${err.message}`)
        return json(res, 502, {
          type: 'error',
          error: {
            type: 'api_error',
            message: `vision routing failed: ${err.message}`,
          },
        })
      }
    } else if (!visionAvailable()) {
      ctx.log('images present but CLAUDE_CODE_VISION_API_KEY not set')
      return json(res, 400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Images attached but vision routing is off. Set CLAUDE_CODE_VISION_API_KEY so the bridge can describe images for text-only models.',
        },
      })
    } else {
      // Key present but routing disabled — strip bytes so upstream doesn't 400
      for (const msg of body.messages || []) {
        if (!Array.isArray(msg.content)) continue
        msg.content = msg.content.map((b) =>
          b && b.type === 'image'
            ? {
                type: 'text',
                text: '[imagem anexada — vision routing desabilitado (CLAUDE_CODE_DISABLE_VISION_ROUTE)]',
              }
            : b,
        )
      }
    }
  }

  const messages = anthropicToOpenAIMessages(body)
  const tools = anthropicToolsToOpenAI(body.tools)
  const stream = body.stream === true

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

  ctx.log(
    `POST /v1/messages → ${provider.baseUrl} model=${upstreamModel} msgs=${messages.length} tools=${tools?.length || 0} stream=${stream} max_tokens=${chatBody.max_tokens}`,
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
    // Never leak raw provider error bodies to the client. Log only the status
    // and the (redacted) body length so operators can still diagnose.
    const errText = await upstream.text().catch(() => '')
    ctx.log(`upstream ${upstream.status} (error body ${errText.length} bytes, redacted)`)
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
    const text = extractMessageText(msg)
    // Expose OpenCode reasoning as Anthropic thinking (Claude Code Thoughts UI)
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
    // Dedupe: if we added both thinking and text=reasoning, that's intentional for UI
    const finalContent = content.length ? content : [{ type: 'text', text: '' }]
    return json(res, 200, {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: finalContent,
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
        if (textStarted && !openedTools.size) {
          writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
        }
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

    if (textStarted) {
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: textIndex })
    }
    for (const [, idx] of [...toolBlockIndex.entries()].sort((a, b) => a[1] - b[1])) {
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: idx })
    }

    if (!textStarted && !thinkingStarted && openedTools.size === 0) {
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
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
