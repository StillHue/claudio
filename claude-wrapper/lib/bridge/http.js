/**
 * Small HTTP helpers shared by the native Anthropic→OpenAI bridge.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')

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

module.exports = {
  json,
  writeSse,
  newMessageId,
  expectedBridgeToken,
}
