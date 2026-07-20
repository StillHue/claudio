/**
 * Bridge Anthropic Messages → OpenAI-compatible chat/completions (Zen, etc.).
 * Used on Fly so we don't need the Claudio CLI binary.
 */
import {
  anthropicJsonMessage,
  endAnthropicStream,
  newMessageId,
  startAnthropicStream,
  writeTextDelta,
} from './anthropic-sse.js'
import { messagesToPrompt } from './translator.js'

function contentToOpenAI(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return content
    .map(b => {
      if (!b) return ''
      if (typeof b === 'string') return b
      if (b.type === 'text') return b.text || ''
      if (b.type === 'tool_result') return `[tool_result] ${contentToOpenAI(b.content)}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toOpenAIMessages(body) {
  const out = []
  if (body.system) {
    const sys =
      typeof body.system === 'string'
        ? body.system
        : Array.isArray(body.system)
          ? body.system.map(b => (typeof b === 'string' ? b : b?.text || '')).join('\n')
          : String(body.system)
    if (sys.trim()) {
      out.push({
        role: 'system',
        content:
          sys.slice(0, 12_000) +
          '\n\nReply as Claude in the browser sidebar. Plain helpful text only. No tools.',
      })
    }
  } else {
    out.push({
      role: 'system',
      content:
        'You are Claude, a helpful AI assistant in the browser sidebar. Plain text only. No tools.',
    })
  }

  for (const msg of body.messages || []) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    const text = contentToOpenAI(msg.content).trim()
    if (!text) continue
    out.push({ role, content: text })
  }

  if (out.length === 1) {
    // only system — shouldn't happen; fall back to flattened prompt
    out.push({ role: 'user', content: messagesToPrompt(body) })
  }
  return out
}

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/$/, '')
  if (b.endsWith('/v1') && path.startsWith('/v1/')) return b.slice(0, -3) + path
  if (b.endsWith('/chat/completions')) return b
  return b + path
}

async function readOpenAIStream(resBody, onDelta) {
  const reader = resBody.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() || ''
    for (const line of parts) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta(delta)
        }
      } catch {
        /* ignore partial */
      }
    }
  }
  return full
}

export async function bridgeMessagesToOpenAI(reqBody, res, config) {
  const base = config.openaiBaseUrl
  const key = config.openaiApiKey
  const model = config.openaiModel || config.model || 'big-pickle'
  if (!base || !key) {
    const msg = 'OPENAI_BASE_URL and OPENAI_API_KEY required for bridge=openai'
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: msg } }))
    return
  }

  const messageId = newMessageId()
  const wantStream = reqBody.stream !== false
  const messages = toOpenAIMessages(reqBody)
  const url = joinUrl(base, '/chat/completions')

  if (config.logRequests) {
    console.log(`[browser-proxy] openai → ${url} model=${model} stream=${wantStream}`)
  }

  const payload = {
    model,
    messages,
    stream: wantStream,
    max_tokens: Math.min(Number(reqBody.max_tokens) || 4096, 8192),
  }

  let upstream
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const msg = `openai fetch failed: ${err.message}`
    console.error(`[browser-proxy] ${msg}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: msg } }))
    return
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    const msg = `openai ${upstream.status}: ${errText.slice(0, 400)}`
    console.error(`[browser-proxy] ${msg}`)
    if (wantStream) {
      startAnthropicStream(res, { model, messageId })
      writeTextDelta(res, `\n\n[${msg}]`)
      endAnthropicStream(res)
    } else {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: msg } }))
    }
    return
  }

  if (wantStream) {
    startAnthropicStream(res, { model, messageId })
    try {
      const full = await readOpenAIStream(upstream.body, chunk => writeTextDelta(res, chunk))
      if (!full) writeTextDelta(res, '(empty response)')
    } catch (err) {
      writeTextDelta(res, `\n\n[stream error: ${err.message}]`)
    }
    endAnthropicStream(res)
    return
  }

  const json = await upstream.json()
  const text = json.choices?.[0]?.message?.content || '(empty response)'
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'x-claudio-browser-proxy': 'openai',
  })
  res.end(JSON.stringify(anthropicJsonMessage({ model, messageId, text })))
}
