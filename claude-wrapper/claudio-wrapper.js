#!/usr/bin/env node
/**
 * Process wrapper for the official Claude Code VS Code / Cursor extension.
 *
 * Modes (CLAUDE_WRAPPER_MODE):
 *   native  — keep official Claude Code harness; only swap inference via local
 *             Anthropic Messages → Chat Completions bridge (default when the
 *             extension passes its bundled claude.exe / cli.js).
 *   claudio — replace Claude Code with the Claudio CLI (legacy).
 *
 * Configured via: claudeCode.claudeProcessWrapper
 *
 * On Windows, point the setting at claudio-wrapper.exe (bun --compile), not
 * .cmd — Node spawn() of .cmd without shell yields EINVAL.
 *
 * Security: never spawn with shell:true + forwarded argv (command injection).
 */
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { randomUUID } = require('crypto')
const { startNativeBridge } = require('./native-bridge')
const {
  loadProvidersConfig,
  resolveProvider,
  syncDefaultModel,
} = require('./provider-config')

const VISION_ENV_KEYS = [
  'GROQ_API_KEY',
  'CLAUDE_CODE_VISION_API_KEY',
  'MANIAC_VISION_API_KEY',
  'CLAUDE_CODE_VISION_BASE_URL',
  'MANIAC_VISION_BASE_URL',
  'CLAUDE_CODE_VISION_MODEL',
  'MANIAC_VISION_MODEL',
  'CLAUDE_CODE_VISION_ROUTE',
  'CLAUDE_CODE_DISABLE_VISION_ROUTE',
]

/** Load vision keys from .env files into process.env (do not override existing). */
function loadVisionEnvFiles() {
  const candidates = [
    path.join(os.homedir(), '.claude-native', '.env'),
    path.join(os.homedir(), '.openclaude', '.env'),
    path.join(os.homedir(), 'maniac-agent', '.env'),
    path.join('C:', 'Users', os.userInfo().username, 'maniac-agent', '.env'),
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
        if (!VISION_ENV_KEYS.includes(key)) continue
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
    return __dirname
  }
  return execDir
}

function debugLog(...args) {
  const debug =
    process.env.CLAUDE_WRAPPER_DEBUG === '1' || process.env.CLAUDIO_WRAPPER_DEBUG === '1'
  if (debug) {
    console.error('[claude-wrapper]', ...args)
  }
  // Only persist logs when debug is on — avoids writing provider errors every turn
  if (!debug) return
  try {
    const logPath = process.env.CLAUDE_NATIVE_LOG || path.join(os.homedir(), 'claude-native-debug.log')
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`,
    )
  } catch {
    /* ignore */
  }
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

function resolveClaudioEntry() {
  const baseDir = wrapperBaseDir()

  const local = path.join(baseDir, '..', 'cli', 'bin', 'claudio')
  if (path.isAbsolute(local) && fs.existsSync(local)) return local

  const candidates = []
  const globalBins = (prefix) => {
    if (!prefix || !path.isAbsolute(prefix)) return
    candidates.push(path.join(prefix, 'node_modules', '@gaburieuru', 'claudio', 'bin', 'claudio'))
    candidates.push(path.join(prefix, 'node_modules', 'claudio', 'bin', 'claudio'))
  }

  if (process.env.APPDATA && path.isAbsolute(process.env.APPDATA)) {
    globalBins(path.join(process.env.APPDATA, 'npm'))
  }

  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    }).trim()
    globalBins(prefix)
  } catch {
    // ignore
  }

  for (const c of candidates) {
    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c
  }
  return null
}

function isNodeBinary(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const base = path.basename(filePath).toLowerCase()
  return base === 'node' || base === 'node.exe'
}

function isExtensionClaudeLauncher(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  if (!path.isAbsolute(filePath)) return false
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/cli.js') && normalized.includes('claude')) return true
  if (/claude-code|native-binary/i.test(normalized)) return true
  const base = path.basename(normalized)
  if (base === 'claude' || base === 'claude.exe') return true
  return false
}

/** Strip the extension's bundled [node, cli.js] or native binary prefix. */
function stripExtensionLauncher(argv) {
  const args = argv.slice()
  if (args.length === 0) return args

  if (isNodeBinary(args[0]) && args.length >= 2 && isExtensionClaudeLauncher(args[1])) {
    return args.slice(2)
  }

  if (isExtensionClaudeLauncher(args[0])) {
    return args.slice(1)
  }

  return args
}

/** Keep official Claude binary + user args. */
function parseOfficialLaunch(argv) {
  const args = argv.slice()
  if (args.length === 0) return null

  if (isNodeBinary(args[0]) && args.length >= 2 && isExtensionClaudeLauncher(args[1])) {
    return { command: args[0], args: args.slice(1) }
  }

  if (isExtensionClaudeLauncher(args[0])) {
    return { command: args[0], args: args.slice(1) }
  }

  return null
}

function findBundledClaudeExe() {
  const home = os.homedir()
  const extensionsRoot = path.join(home, '.cursor', 'extensions')
  if (!fs.existsSync(extensionsRoot)) return null
  let dirs = []
  try {
    dirs = fs
      .readdirSync(extensionsRoot)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
  } catch {
    return null
  }
  for (const d of dirs) {
    const candidates = [
      path.join(extensionsRoot, d, 'resources', 'native-binary', 'claude.exe'),
      path.join(extensionsRoot, d, 'resources', 'native-binaries', `win32-${process.arch}`, 'claude.exe'),
      path.join(extensionsRoot, d, 'resources', 'claude-code', 'cli.js'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        if (c.endsWith('cli.js')) {
          const node = resolveNodeBinary()
          if (!node) continue
          return { command: node, args: [c] }
        }
        return { command: c, args: [] }
      }
    }
  }
  return null
}

function resolveNodeBinary() {
  if (isNodeBinary(process.execPath)) {
    return process.execPath
  }

  const fromEnv = process.env.NODE_BINARY || process.env.npm_node_execpath
  if (fromEnv && path.isAbsolute(fromEnv) && fs.existsSync(fromEnv)) {
    return fromEnv
  }

  if (process.platform === 'win32') {
    const guesses = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
    ]
    for (const g of guesses) {
      if (g && fs.existsSync(g)) return g
    }
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['node'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && path.isAbsolute(l) && fs.existsSync(l))
    if (out) return out
  } catch {
    // fall through
  }

  return null
}

function detectMode(rawArgs) {
  const forced = (process.env.CLAUDE_WRAPPER_MODE || process.env.CLAUDIO_MODE || '').toLowerCase()
  if (forced === 'native' || forced === 'proxy') return 'native'
  if (forced === 'claudio' || forced === 'legacy') return 'claudio'
  // Auto: official launcher in argv → native; otherwise Claudio
  if (parseOfficialLaunch(rawArgs) || findBundledClaudeExe()) return 'native'
  return 'claudio'
}

function attachChild(child) {
  child.on('exit', (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exit(1)
      }
    }
    process.exit(code ?? 0)
  })
  child.on('error', (err) => {
    console.error('[claude-wrapper] failed to start child:', err.message)
    process.exit(1)
  })
}

async function runNative(rawArgs) {
  loadVisionEnvFiles()
  const parsed = parseOfficialLaunch(rawArgs) || findBundledClaudeExe()
  if (!parsed) {
    console.error(
      '[claude-wrapper] native mode: Claude Code binary not found.\n' +
        'Install the official Claude Code Cursor extension, or set CLAUDE_WRAPPER_MODE=claudio.',
    )
    process.exit(1)
  }

  // When we found bundled binary ourselves, remaining argv are user args
  let userArgs = []
  if (parseOfficialLaunch(rawArgs)) {
    userArgs = parsed.args
  } else {
    userArgs = stripExtensionLauncher(rawArgs)
  }

  const providersCfg = loadProvidersConfig()
  // Short-lived `auth status` (and similar) must not touch settings.json —
  // Cursor spawns it beside the stream-json session; a rewrite reloads Claude.
  const isEphemeral =
    userArgs.includes('auth') ||
    userArgs.some((a) => a === '--version' || a === '-v' || a === 'version')
  const synced = isEphemeral
    ? { path: null, ids: [], changed: false }
    : syncDefaultModel(providersCfg.data)
  if (synced.changed) {
    debugLog(
      `synced default model ${synced.model} → claude=${synced.claude?.path || 'n/a'} cursor=${synced.cursor?.path || 'n/a'}`,
    )
  }
  const provider = resolveProvider(providersCfg.data)
  if (!provider.apiKey) {
    console.error(
      `[claude-wrapper] native mode: missing API key (set ${provider.apiKeyEnv || 'OPENAI_API_KEY'} or CLAUDE_NATIVE_API_KEY).`,
    )
    process.exit(1)
  }

  const bridgeToken = getSharedBridgeToken()
  const bridge = await startNativeBridge({
    token: bridgeToken,
    log: (...a) => debugLog(...a),
    getProvider: (requested) => resolveProvider(providersCfg.data, requested),
    getProvidersData: () => providersCfg.data,
    getProvidersPath: () => providersCfg.path,
  })

  debugLog(
    `native mode — provider=${provider.name} model=${provider.model} bridge=${bridge.url} config=${providersCfg.path || 'builtin'} settings=${synced.path || 'n/a'} models=${synced.ids?.length || 0} vision=${process.env.GROQ_API_KEY || process.env.CLAUDE_CODE_VISION_API_KEY ? 'on' : 'off'}`,
  )
  debugLog(`spawn ${parsed.command} ${userArgs.join(' ')}`)

  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: bridge.url,
    CLAUDE_CODE_SKIP_API_KEY_CHECK: process.env.CLAUDE_CODE_SKIP_API_KEY_CHECK || '1',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:
      process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY || '1',
  }
  // Force shared bridge key (must match native-bridge token check)
  env.ANTHROPIC_API_KEY = bridgeToken
  env.ANTHROPIC_AUTH_TOKEN = bridgeToken
  // Don't leak Claudio/OpenAI routing into official Claude Code (it must use Anthropic bridge)
  delete env.OPENAI_BASE_URL
  delete env.OPENAI_API_BASE
  delete env.OPENAI_MODEL
  delete env.CLAUDE_CODE_USE_OPENAI
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ANTHROPIC_LOG

  const child = spawn(parsed.command, userArgs, {
    stdio: 'inherit',
    env,
    windowsHide: true,
  })

  const shutdown = async () => {
    try {
      await bridge.close()
    } catch {
      /* ignore */
    }
  }
  child.on('exit', async (code, signal) => {
    await shutdown()
    if (signal) {
      try {
        process.kill(process.pid, signal)
      } catch {
        process.exit(1)
      }
    }
    process.exit(code ?? 0)
  })
  child.on('error', async (err) => {
    await shutdown()
    console.error('[claude-wrapper] failed to start Claude Code:', err.message)
    process.exit(1)
  })
}

function runClaudio(rawArgs) {
  const args = stripExtensionLauncher(rawArgs)
  const entry = resolveClaudioEntry()
  if (!entry) {
    console.error(
      '[claudio-wrapper] could not find Claudio binary.\n' +
        'Install globally: npm install -g @gaburieuru/claudio@latest',
    )
    process.exit(1)
  }

  if (process.env.CLAUDIO_WRAPPER_DEBUG === '1') {
    console.error(`[claudio-wrapper] using ${entry}`)
  }

  const nodeBinary = resolveNodeBinary()
  if (!nodeBinary) {
    console.error(
      '[claudio-wrapper] could not find node.exe to launch Claudio.\n' +
        'Ensure Node.js is on PATH, or set NODE_BINARY to an absolute node path.',
    )
    process.exit(1)
  }

  const child = spawn(nodeBinary, [entry, ...args], {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  })
  attachChild(child)
}

const rawArgs = process.argv.slice(2)
const mode = detectMode(rawArgs)
debugLog(`mode=${mode} argv0=${rawArgs[0] || ''}`)

if (mode === 'native') {
  runNative(rawArgs).catch((err) => {
    console.error('[claude-wrapper] native failed:', err.message)
    process.exit(1)
  })
} else {
  runClaudio(rawArgs)
}
