import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const DATA_ROOT =
  process.env.BROWSER_PROXY_DATA_DIR ||
  path.join(HOME, '.openclaude', 'browser-proxy')

export const OPENCLAUDE_DIR = path.join(HOME, '.openclaude')
export const PROXY_HOME = DATA_ROOT
export const CA_DIR = path.join(DATA_ROOT, 'ca')
export const CERT_CACHE_DIR = path.join(DATA_ROOT, 'certs')
export const CONFIG_PATH =
  process.env.BROWSER_PROXY_CONFIG || path.join(OPENCLAUDE_DIR, 'browser-proxy.json')
export const LOG_PATH = path.join(DATA_ROOT, 'proxy.log')

export const DEFAULT_ALLOW_HOSTS = [
  'api.anthropic.com',
  'www.claude.ai',
  'preview.claude.ai',
  'platform.claude.com',
  'claude.ai',
]

/** Hosts we decrypt (MITM). Others CONNECT-tunnel without inspection. */
export const DEFAULT_MITM_HOSTS = ['api.anthropic.com']

export function loadConfig() {
  const defaults = {
    mode: 'local', // 'local' | 'passthrough'
    host: '127.0.0.1',
    port: 18765,
    claudioBin: 'claudio',
    model: null,
    allowHosts: DEFAULT_ALLOW_HOSTS,
    mitmHosts: DEFAULT_MITM_HOSTS,
    interceptPaths: ['/v1/messages'],
    bare: true,
    tools: '',
    logRequests: true,
    // 'openai' = call OPENAI_BASE_URL directly (Fly); 'claudio' = spawn CLI (local)
    bridge: process.env.BRIDGE_MODE || 'claudio',
    openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || process.env.CLAUDIO_BROWSER_PROXY_MODEL || '',
    // Optional Basic proxy auth (required on public Fly)
    proxyUser: process.env.PROXY_USER || '',
    proxyPass: process.env.PROXY_PASS || '',
  }

  let file = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')
      file = JSON.parse(raw)
    }
  } catch (err) {
    console.warn(`[browser-proxy] bad config ${CONFIG_PATH}: ${err.message}`)
  }

  const envMode = process.env.CLAUDIO_BROWSER_PROXY_MODE
  const mode =
    envMode === 'local' || envMode === 'passthrough'
      ? envMode
      : file.mode === 'passthrough' || file.mode === 'local'
        ? file.mode
        : defaults.mode

  const bridge =
    process.env.BRIDGE_MODE ||
    file.bridge ||
    (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL ? 'openai' : defaults.bridge)

  return {
    ...defaults,
    ...file,
    mode,
    bridge,
    port: Number(process.env.CLAUDIO_BROWSER_PROXY_PORT || file.port || defaults.port),
    host: process.env.CLAUDIO_BROWSER_PROXY_HOST || file.host || defaults.host,
    claudioBin:
      process.env.CLAUDIO_BROWSER_PROXY_BIN || file.claudioBin || defaults.claudioBin,
    model:
      process.env.CLAUDIO_BROWSER_PROXY_MODEL ||
      process.env.OPENAI_MODEL ||
      file.model ||
      defaults.model,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || file.openaiBaseUrl || defaults.openaiBaseUrl,
    openaiApiKey: process.env.OPENAI_API_KEY || file.openaiApiKey || defaults.openaiApiKey,
    openaiModel:
      process.env.OPENAI_MODEL ||
      process.env.CLAUDIO_BROWSER_PROXY_MODEL ||
      file.openaiModel ||
      file.model ||
      defaults.openaiModel,
    proxyUser: process.env.PROXY_USER || file.proxyUser || defaults.proxyUser,
    proxyPass: process.env.PROXY_PASS || file.proxyPass || defaults.proxyPass,
  }
}

export function ensureDirs() {
  fs.mkdirSync(CA_DIR, { recursive: true })
  fs.mkdirSync(CERT_CACHE_DIR, { recursive: true })
  fs.mkdirSync(PROXY_HOME, { recursive: true })
}

export function writeDefaultConfigIfMissing() {
  // Skip writing home config on Fly / ephemeral containers
  if (process.env.BROWSER_PROXY_DATA_DIR || process.env.FLY_APP_NAME) return
  ensureDirs()
  if (!fs.existsSync(CONFIG_PATH)) {
    const cfg = {
      mode: 'local',
      host: '127.0.0.1',
      port: 18765,
      claudioBin: 'claudio',
      mitmHosts: DEFAULT_MITM_HOSTS,
      allowHosts: DEFAULT_ALLOW_HOSTS,
      interceptPaths: ['/v1/messages'],
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    console.log(`[browser-proxy] wrote ${CONFIG_PATH}`)
  }
}

export function hostMatches(hostname, patterns) {
  const h = String(hostname || '').toLowerCase()
  return (patterns || []).some(p => {
    const pat = String(p).toLowerCase()
    if (pat.startsWith('*.')) {
      const suffix = pat.slice(1)
      return h.endsWith(suffix) || h === pat.slice(2)
    }
    return h === pat
  })
}

export function checkProxyAuth(req, config) {
  if (!config.proxyUser && !config.proxyPass) return true
  const hdr = req.headers['proxy-authorization'] || req.headers['authorization']
  if (!hdr || typeof hdr !== 'string') return false
  const m = hdr.match(/^Basic\s+(.+)$/i)
  if (!m) return false
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded
    const pass = idx >= 0 ? decoded.slice(idx + 1) : ''
    return user === config.proxyUser && pass === config.proxyPass
  } catch {
    return false
  }
}
