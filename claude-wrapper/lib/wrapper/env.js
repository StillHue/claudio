/**
 * Env + path helpers for the Claude native wrapper.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')

const VISION_ENV_KEYS = [
  'CLAUDE_CODE_VISION_API_KEY',
  'MANIAC_VISION_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'CLAUDE_CODE_VISION_BASE_URL',
  'MANIAC_VISION_BASE_URL',
  'CLAUDE_CODE_VISION_MODEL',
  'MANIAC_VISION_MODEL',
  'CLAUDE_CODE_VISION_ROUTE',
  'CLAUDE_CODE_DISABLE_VISION_ROUTE',
]

/** Load vision keys from .env — ~/.claude-native/.env wins over inherited process.env. */
function loadVisionEnvFiles() {
  const candidates = [
    path.join(os.homedir(), '.claude-native', '.env'),
    path.join(os.homedir(), '.openclaude', '.env'),
    path.join(os.homedir(), 'maniac-agent', '.env'),
    path.join('C:', 'Users', os.userInfo().username, 'maniac-agent', '.env'),
  ]
  let loaded = 0
  const primaryKeys = new Set()
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const isPrimary = file === candidates[0]
      const text = fs.readFileSync(file, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const i = t.indexOf('=')
        if (i < 0) continue
        const key = t.slice(0, i).trim()
        if (!VISION_ENV_KEYS.includes(key)) continue
        if (!isPrimary && (process.env[key] || primaryKeys.has(key))) continue
        let val = t.slice(i + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[key] = val
        loaded += 1
        if (isPrimary) primaryKeys.add(key)
      }
    } catch {
      /* ignore */
    }
  }
  return loaded
}

/**
 * Bun --compile embeds scripts under a virtual __dirname. Prefer the
 * directory of the running .exe so sibling files resolve.
 */
function wrapperBaseDir() {
  const execDir = path.dirname(process.execPath)
  const base = path.basename(process.execPath).toLowerCase()
  if (base.startsWith('claudio-wrapper') && base.endsWith('.exe')) {
    return execDir
  }
  if (typeof __dirname === 'string' && __dirname.length > 0) {
    // When required from lib/wrapper, climb to package root.
    const here = path.resolve(__dirname, '..', '..')
    if (fs.existsSync(path.join(here, 'claudio-wrapper.js'))) return here
    return __dirname
  }
  return execDir
}

/** Stable token shared by sibling wrapper processes (auth status + stream-json). */
function getSharedBridgeToken() {
  const dir = path.join(os.homedir(), '.claude-native')
  const file = path.join(dir, 'bridge.token')
  try {
    fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim()
      if (existing.length >= 32) return existing
    }
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    fs.writeFileSync(file, token, { mode: 0o600 })
    return token
  } catch {
    return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  }
}

module.exports = {
  VISION_ENV_KEYS,
  loadVisionEnvFiles,
  wrapperBaseDir,
  getSharedBridgeToken,
}
