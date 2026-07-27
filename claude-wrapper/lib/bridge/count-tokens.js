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
    const parsed = JSON.parse(body)
    const messages = parsed.messages || []
    for (const msg of messages) {
      const content = msg.content || ''
      if (typeof content === 'string') {
        inputTokens += estimateTokens(content)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.text) inputTokens += estimateTokens(block.text)
        }
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return json(res, 200, { input_tokens: inputTokens })
}

module.exports = { estimateTokens, handleCountTokens }
