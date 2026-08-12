/**
 * Logging helpers for the Claude native wrapper.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

function sanitizeForLog(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(/Bearer\s+\S{8,}/gi, 'Bearer [REDACTED]')
    .replace(/x-api-key[:\s]+\S{8,}/gi, 'x-api-key: [REDACTED]')
    .replace(/api[_-]?key["\s:=]+["']?\S{8,}["']?/gi, 'apiKey: "[REDACTED]"')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]')
    .replace(/nvapi-[a-zA-Z0-9_-]{20,}/g, 'nvapi-[REDACTED]')
    .replace(/gsk_[a-zA-Z0-9]{20,}/g, 'gsk_[REDACTED]')
    .replace(/AQ\.[a-zA-Z0-9_-]{20,}/g, 'AQ.[REDACTED]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[REDACTED_BASE64]')
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[REDACTED_B64]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED_HEX]')
}

/** Extract a short, sanitized diagnostic from an upstream error body. */
function summarizeUpstreamError(errText, maxLen = 200) {
  const raw = String(errText || '').trim()
  if (!raw) return '(empty body)'
  let message = raw
  try {
    const parsed = JSON.parse(raw)
    const err = parsed?.error || parsed
    const parts = []
    if (err?.code) parts.push(`code=${err.code}`)
    if (err?.type) parts.push(`type=${err.type}`)
    if (err?.message) parts.push(String(err.message))
    else if (parsed?.message) parts.push(String(parsed.message))
    if (parts.length) message = parts.join(' ')
  } catch {
    /* keep raw */
  }
  const cleaned = sanitizeForLog(message).replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen - 1) + '…'
}

function appendLogLine(line) {
  try {
    const logPath =
      process.env.CLAUDE_NATIVE_LOG || path.join(os.homedir(), 'claude-native-debug.log')
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* ignore */
  }
}

function debugLog(...args) {
  const debug =
    process.env.CLAUDE_WRAPPER_DEBUG === '1' || process.env.CLAUDIO_WRAPPER_DEBUG === '1'
  if (debug) {
    const sanitized = args.map(sanitizeForLog)
    console.error('[claude-wrapper]', ...sanitized)
  }
  if (!debug) return
  try {
    const sanitized = args.map((a) => {
      if (typeof a === 'string') return sanitizeForLog(a)
      try {
        return sanitizeForLog(JSON.stringify(a))
      } catch {
        return String(a)
      }
    })
    appendLogLine(sanitized.join(' '))
  } catch {
    /* ignore */
  }
}

/** Always write sanitized critical diagnostics (upstream 4xx/5xx, empty completion). */
function criticalLog(...args) {
  const sanitized = args.map((a) => {
    if (typeof a === 'string') return sanitizeForLog(a)
    try {
      return sanitizeForLog(JSON.stringify(a))
    } catch {
      return String(a)
    }
  })
  console.error('[claude-wrapper]', ...sanitized)
  appendLogLine(sanitized.join(' '))
}

module.exports = { sanitizeForLog, summarizeUpstreamError, debugLog, criticalLog }
