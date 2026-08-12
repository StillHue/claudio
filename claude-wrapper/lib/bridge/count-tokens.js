/**
 * /v1/messages/count_tokens — cheap heuristic token estimate for the
 * Claude Code UI. Bounded by CLAUDE_NATIVE_MAX_BODY_BYTES (default 20MB).
 */
const { json } = require('./http')

function estimateTokens(text) {
  // Better estimation: 4 chars/token for English, 2-3 for code, 1-2 for CJK
  if (!text) return 0
  const hasCode = /[{}\[\];=<>]/.test(text)
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(text)
  if (hasCJK) return Math.ceil(text.length / 1.5)
  if (hasCode) return Math.ceil(text.length / 3)
  return Math.ceil(text.length / 4)
}

/** Rough image cost: ~1 token per 32 base64 chars, floor 85 (OpenAI-ish heuristic). */
function estimateImageTokens(data) {
  const n = String(data || '').length
  if (!n) return 85
  return Math.max(85, Math.ceil(n / 32))
}

function estimateBlockTokens(block) {
  if (!block) return 0
  if (typeof block === 'string') return estimateTokens(block)
  if (block.type === 'text') return estimateTokens(block.text || '')
  if (block.type === 'thinking') return estimateTokens(block.thinking || '')
  if (block.type === 'image' && block.source?.data) {
    return estimateImageTokens(block.source.data)
  }
  if (block.type === 'tool_use') {
    return (
      estimateTokens(block.name || '') +
      estimateTokens(
        typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
      )
    )
  }
  if (block.type === 'tool_result') {
    const c = block.content
    if (typeof c === 'string') return estimateTokens(c)
    if (Array.isArray(c)) return c.reduce((sum, part) => sum + estimateBlockTokens(part), 0)
    return estimateTokens(JSON.stringify(c ?? ''))
  }
  if (block.text) return estimateTokens(block.text)
  return 0
}

function estimateInputTokens(parsed) {
  if (!parsed || typeof parsed !== 'object') return 0
  let inputTokens = 0

  if (parsed.system != null) {
    if (typeof parsed.system === 'string') inputTokens += estimateTokens(parsed.system)
    else if (Array.isArray(parsed.system)) {
      for (const b of parsed.system) inputTokens += estimateBlockTokens(b)
    } else {
      inputTokens += estimateTokens(String(parsed.system))
    }
  }

  for (const msg of parsed.messages || []) {
    if (!msg) continue
    const content = msg.content
    if (typeof content === 'string') {
      inputTokens += estimateTokens(content)
    } else if (Array.isArray(content)) {
      for (const block of content) inputTokens += estimateBlockTokens(block)
    } else if (content != null) {
      inputTokens += estimateTokens(String(content))
    }
  }

  for (const tool of parsed.tools || []) {
    if (!tool) continue
    inputTokens += estimateTokens(tool.name || '')
    inputTokens += estimateTokens(tool.description || '')
    inputTokens += estimateTokens(JSON.stringify(tool.input_schema || tool.parameters || {}))
  }

  return inputTokens
}

async function handleCountTokens(req, res) {
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

  const body = Buffer.concat(chunks).toString('utf8')
  let inputTokens = 0
  try {
    inputTokens = estimateInputTokens(JSON.parse(body))
  } catch {
    /* ignore parse errors */
  }
  return json(res, 200, { input_tokens: inputTokens })
}

module.exports = {
  estimateTokens,
  estimateImageTokens,
  estimateInputTokens,
  handleCountTokens,
}
