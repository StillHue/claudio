/**
 * Env + path helpers for the Claude native wrapper.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')

/**
 * Load ~/.claude-native/.env (and optional fallbacks) into process.env.
 * Does not overwrite keys already set in the process environment.
 */
function loadNativeEnvFiles() {
  const candidates = [
    path.join(os.homedir(), '.claude-native', '.env'),
    path.join(os.homedir(), '.openclaude', '.env'),
  ]
  let loaded = 0
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const i = t.indexOf('=')
        if (i < 0) continue
        const key = t.slice(0, i).trim()
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
        if (process.env[key]) continue
        let val = t.slice(i + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[key] = val
        loaded += 1
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
  loadNativeEnvFiles,
  wrapperBaseDir,
  getSharedBridgeToken,
}
