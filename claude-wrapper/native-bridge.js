/**
 * Anthropic Messages API → OpenAI Chat Completions bridge (with tool_use).
 *
 * Claude Code speaks /v1/messages (+ SSE). Most third-party providers speak
 * /v1/chat/completions. This local server sits in the middle so the official
 * Claude Code harness stays intact — only inference is redirected.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
const { buildAnthropicModelsList } = require('./provider-config')
const {
  bodyHasImages,
  routeImagesInBody,
  visionEnabled,
  visionAvailable,
} = require('./vision-route')

const BRIDGE_TOKEN_FILE = path.join(os.homedir(), '.claude-native', 'bridge.token')

/** Prefer on-disk shared token so sibling wrappers never disagree with in-memory start token. */
function expectedBridgeToken(fallback) {
  try {
    if (fs.existsSync(BRIDGE_TOKEN_FILE)) {
      const t = fs.readFileSync(BRIDGE_TOKEN_FILE, 'utf8').trim()
      if (t.length >= 32) return t
    }
  } catch {
    /* ignore */
  }
  return fallback || ''
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function newMessageId() {
  return `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function systemToText(system) {
  if (system == null) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === 'string' ? b : b?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return String(system)
}

function contentBlockToText(block) {
  if (block == null) return ''
  if (typeof block === 'string') return block
  if (block.type === 'text') return block.text || ''
  if (block.type === 'tool_result') {
    const c = block.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map(contentBlockToText).join('\n')
    return JSON.stringify(c ?? '')
  }
  if (block.type === 'image' && block.source) {
    // Prefer base64 only — never instruct upstream to fetch arbitrary URLs (SSRF)
    if (block.source.type === 'base64' && block.source.data) {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`,
        },
      }
    }
    return '[image omitted: non-base64 source]'
  }
  return ''
}

/** Anthropic messages → OpenAI chat messages (incl. tool_use / tool_result). */
function anthropicToOpenAIMessages(body) {
  const out = []
  const sys = systemToText(body.system)
  if (sys.trim()) out.push({ role: 'system', content: sys })

  for (const msg of body.messages || []) {
    if (!msg) continue
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    const content = msg.content

    if (typeof content === 'string') {
      out.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) {
      out.push({ role, content: String(content ?? '') })
      continue
    }

    if (role === 'assistant') {
      const textParts = []
      const toolCalls = []
      for (const block of content) {
        if (!block) continue
        if (block.type === 'text' && block.text) textParts.push(block.text)
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `toolu_${randomUUID().slice(0, 8)}`,
            type: 'function',
            function: {
              name: block.name || 'unknown',
              arguments:
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input ?? {}),
            },
          })
        }
      }
      const assistant = { role: 'assistant', content: textParts.join('\n') || null }
      if (toolCalls.length) assistant.tool_calls = toolCalls
      out.push(assistant)
      continue
    }

    // user — may mix text + tool_result (+ images)
    const toolResults = content.filter((b) => b && b.type === 'tool_result')
    const other = content.filter((b) => b && b.type !== 'tool_result')

    for (const tr of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id || tr.id || '',
        content:
          typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map((c) => (typeof c === 'string' ? c : c?.text || JSON.stringify(c))).join('\n')
              : JSON.stringify(tr.content ?? ''),
      })
    }

    if (other.length) {
      const parts = other.map(contentBlockToText).filter((p) => p !== '' && p != null)
      const hasVision = parts.some((p) => typeof p === 'object')
      if (hasVision) {
        const openaiParts = []
        for (const p of parts) {
          if (typeof p === 'string') openaiParts.push({ type: 'text', text: p })
          else openaiParts.push(p)
        }
        out.push({ role: 'user', content: openaiParts })
      } else {
        const text = parts.map(String).join('\n').trim()
        if (text) out.push({ role: 'user', content: text })
      }
    }
  }

  return out
}

function anthropicToolsToOpenAI(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined
  return tools
    .filter((t) => t && t.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
      },
    }))
}

function mapToolChoice(choice) {
  if (!choice || choice === 'auto') return 'auto'
  if (choice === 'any' || choice === 'required') return 'required'
  if (choice === 'none') return 'none'
  if (typeof choice === 'object' && choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } }
  }
  return 'auto'
}

function joinChatUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (b.endsWith('/v1')) return `${b}/chat/completions`
  return `${b}/chat/completions`
}

function mapModel(requested, provider) {
  // resolveProvider already picked the upstream model id
  if (provider?.model) return provider.model
  return requested || 'deepseek-v4-flash-free'
}

function extractReasoning(msgOrDelta) {
  if (!msgOrDelta || typeof msgOrDelta !== 'object') return ''
  if (typeof msgOrDelta.reasoning === 'string' && msgOrDelta.reasoning) return msgOrDelta.reasoning
  if (typeof msgOrDelta.reasoning_content === 'string' && msgOrDelta.reasoning_content) {
    return msgOrDelta.reasoning_content
  }
  const details = msgOrDelta.reasoning_details
  if (Array.isArray(details)) {
    return details
      .map((d) => (typeof d?.text === 'string' ? d.text : typeof d?.content === 'string' ? d.content : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function extractMessageText(msg) {
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

async function readOpenAIStream(body, handlers) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let fullText = ''
  let fullReasoning = ''
  /** @type {Map<number, { id: string, name: string, arguments: string }>} */
  const toolAcc = new Map()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      let jsonChunk
      try {
        jsonChunk = JSON.parse(data)
      } catch {
        continue
      }
      const choice = jsonChunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}
      if (delta.content) {
        const chunk = delta.content
        // Cumulative streams only: each event is the full text so far.
        // Do NOT use endsWith() — overlapping legitimate suffixes get dropped
        // and Claude Code can stall waiting for content that never arrives.
        if (chunk.length > fullText.length && chunk.startsWith(fullText)) {
          const inc = chunk.slice(fullText.length)
          fullText = chunk
          if (inc) handlers.onText?.(inc)
        } else if (chunk === fullText && chunk.length >= 16) {
          /* exact full-buffer re-emit */
        } else {
          fullText += chunk
          handlers.onText?.(chunk)
        }
      }
      const reasoningDelta = extractReasoning(delta)
      if (reasoningDelta) {
        fullReasoning += reasoningDelta
        handlers.onReasoning?.(reasoningDelta)
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolAcc.has(idx)) {
            toolAcc.set(idx, {
              id: tc.id || `toolu_${randomUUID().slice(0, 10)}`,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            })
          } else {
            const cur = toolAcc.get(idx)
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.arguments += tc.function.arguments
          }
          handlers.onToolDelta?.(idx, toolAcc.get(idx), tc)
        }
      }
      if (choice.finish_reason) handlers.onFinish?.(choice.finish_reason)
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
  }
}

function finishReasonToStop(reason, hasTools) {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

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
      const { persistProvidersDefault } = require('./provider-config')
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
      ctx.log('images present but GROQ_API_KEY / CLAUDE_CODE_VISION_API_KEY not set')
      return json(res, 400, {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message:
            'Images attached but vision routing is off. Set GROQ_API_KEY (or CLAUDE_CODE_VISION_API_KEY) so the bridge can describe images for text-only models.',
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
  const requestedMax = body.max_tokens != null ? Number(body.max_tokens) : 0
  chatBody.max_tokens = Math.max(requestedMax || 0, 8192)
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
    const errText = await upstream.text()
    ctx.log(`upstream ${upstream.status}: ${errText.slice(0, 400)}`)
    return json(res, upstream.status, {
      type: 'error',
      error: { type: 'api_error', message: errText.slice(0, 800) },
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

function handleCountTokens(req, res) {
  // Cheap stub — Claude Code uses this for UI estimates.
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    json(res, 200, { input_tokens: 0 })
  })
}

/**
 * @param {{ getProvider: (model?: string) => any, getProvidersData?: () => any, log?: Function, token?: string, host?: string, port?: number }} opts
 */
function startNativeBridge(opts) {
  const log = opts.log || (() => {})
  const token = opts.token || ''
  const host = opts.host || '127.0.0.1'
  const port = opts.port || 0

  // Shared-token gate: on when STRICT=1 and OPEN_LOCAL is not set.
  // Default (OPEN_LOCAL from wrapper): skip token check — loopback + Origin only.
  const openLocal =
    process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL === '1' ||
    process.env.CLAUDE_NATIVE_BRIDGE_STRICT !== '1'
  const maxBodyBytes = Number(process.env.CLAUDE_NATIVE_MAX_BODY_BYTES || 20 * 1024 * 1024)

  const server = http.createServer(async (req, res) => {
    // No browser CORS — this bridge is for the local Claude Code CLI only
    if (req.method === 'OPTIONS') {
      return json(res, 403, {
        type: 'error',
        error: { type: 'permission_error', message: 'CORS preflight not allowed' },
      })
    }

    // Block cross-origin browser calls (CSRF / accidental public→loopback)
    const origin = String(req.headers.origin || '')
    if (origin && origin !== 'null') {
      return json(res, 403, {
        type: 'error',
        error: { type: 'permission_error', message: 'browser origin not allowed' },
      })
    }

    if (token && !openLocal) {
      const auth = req.headers.authorization || ''
      const xKey = String(req.headers['x-api-key'] || '')
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      const expected = expectedBridgeToken(token)
      const ok =
        (xKey && xKey === expected) || (bearer && bearer === expected)
      if (!ok) {
        log(
          `401 bridge auth: xApiKeyLen=${xKey.length} bearerLen=${bearer.length} expectedLen=${expected.length}`,
        )
        return json(res, 401, {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid bridge token' },
        })
      }
    }

    const contentLength = Number(req.headers['content-length'] || 0)
    if (contentLength > maxBodyBytes) {
      return json(res, 413, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'request body too large' },
      })
    }

    const url = new URL(req.url || '/', `http://${host}`)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return json(res, 200, { ok: true, service: 'claude-native-bridge' })
    }

    // Gateway model discovery (CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1)
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      const data = opts.getProvidersData
        ? buildAnthropicModelsList(opts.getProvidersData())
        : { data: [], has_more: false, first_id: null, last_id: null }
      log(`GET ${path} → ${data.data?.length || 0} model(s)`)
      return json(res, 200, data)
    }

    if (req.method === 'GET' && (path.startsWith('/v1/models/') || path.startsWith('/models/'))) {
                  const id = path.startsWith('/v1/models/')
                    ? decodeURIComponent(path.slice('/v1/models/'.length))
                    : decodeURIComponent(path.slice('/models/'.length))
      const data = opts.getProvidersData
        ? buildAnthropicModelsList(opts.getProvidersData())
        : { data: [] }
      const found = (data.data || []).find((m) => m.id === id)
      if (!found) {
        return json(res, 404, {
          type: 'error',
          error: { type: 'not_found_error', message: `model ${id} not found` },
        })
      }
      return json(res, 200, found)
    }

    if (req.method === 'POST' && (path === '/v1/messages' || path === '/messages')) {
      return handleMessages(req, res, {
        getProvider: opts.getProvider,
        getProvidersData: opts.getProvidersData,
        getProvidersPath: opts.getProvidersPath,
        log,
      })
    }

    if (req.method === 'POST' && (path === '/v1/messages/count_tokens' || path === '/messages/count_tokens')) {
      return handleCountTokens(req, res)
    }

    return json(res, 404, {
      type: 'error',
      error: { type: 'not_found_error', message: `no route ${req.method} ${path}` },
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const url = `http://${host}:${actualPort}`
      log(`native bridge listening on ${url}`)
      resolve({
        url,
        port: actualPort,
        close: () =>
          new Promise((resClose, rej) => {
            server.close((err) => (err ? rej(err) : resClose()))
          }),
      })
    })
  })
}

module.exports = {
  startNativeBridge,
  anthropicToOpenAIMessages,
  anthropicToolsToOpenAI,
}
