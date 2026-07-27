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
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED_HEX]')
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
    const logPath =
      process.env.CLAUDE_NATIVE_LOG || path.join(os.homedir(), 'claude-native-debug.log')
    const sanitized = args.map((a) => {
      if (typeof a === 'string') return sanitizeForLog(a)
      try {
        return sanitizeForLog(JSON.stringify(a))
      } catch {
        return String(a)
      }
    })
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${sanitized.join(' ')}\n`)
  } catch {
    /* ignore */
  }
}

module.exports = { sanitizeForLog, debugLog }
