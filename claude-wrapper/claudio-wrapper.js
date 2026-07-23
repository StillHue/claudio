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
const {
  resolveLatestOfficialClaude,
  preferLatestOfficial,
} = require('./resolve-official-claude')

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

/**
 * Claude Code warns when both ANTHROPIC_AUTH_TOKEN and /login managed key exist,
 * and often presents the login key to ANTHROPIC_BASE_URL → bridge 401.
 *
 * While bridged: always move ~/.claude/.credentials.json aside (every spawn).
 * Keep the backup outside ~/.claude so Claude Code cannot still "see" a login.
 * Restore is opt-in (CLAUDE_NATIVE_RESTORE_LOGIN=1).
 */
const CLAUDE_CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json')
const CLAUDE_CREDENTIALS_BAK = path.join(
  os.homedir(),
  '.claude-native',
  'login-credentials.bak.json',
)
/** Legacy bak path (same folder as credentials) — migrate away so Claude stops detecting login. */
const CLAUDE_CREDENTIALS_BAK_LEGACY = path.join(
  os.homedir(),
  '.claude',
  '.credentials.json.claudio-bridge',
)
const CRED_QUARANTINE_REF = path.join(os.homedir(), '.claude-native', 'credentials-quarantine.ref')

function quarantineClaudeLoginCredentials() {
  const dir = path.join(os.homedir(), '.claude-native')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  // Migrate legacy bak out of ~/.claude/
  try {
    if (fs.existsSync(CLAUDE_CREDENTIALS_BAK_LEGACY)) {
      if (!fs.existsSync(CLAUDE_CREDENTIALS_BAK)) {
        fs.renameSync(CLAUDE_CREDENTIALS_BAK_LEGACY, CLAUDE_CREDENTIALS_BAK)
      } else {
        fs.unlinkSync(CLAUDE_CREDENTIALS_BAK_LEGACY)
      }
      debugLog('migrated legacy credentials bak out of ~/.claude')
    }
  } catch (err) {
    debugLog(`legacy bak migrate failed: ${err.message}`)
  }
  // Always remove live login creds when present (do not gate on refcount).
  // Safe order: move live → tmp, then replace bak (never delete bak before live is safe).
  if (fs.existsSync(CLAUDE_CREDENTIALS)) {
    const tmp = CLAUDE_CREDENTIALS_BAK + '.tmp'
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      fs.renameSync(CLAUDE_CREDENTIALS, tmp)
      try {
        if (fs.existsSync(CLAUDE_CREDENTIALS_BAK)) fs.unlinkSync(CLAUDE_CREDENTIALS_BAK)
      } catch {
        /* keep tmp as bak below */
      }
      fs.renameSync(tmp, CLAUDE_CREDENTIALS_BAK)
      debugLog('quarantined ~/.claude/.credentials.json → ~/.claude-native/')
    } catch (err) {
      // Never delete the only remaining copy. Try to put live creds back.
      try {
        if (fs.existsSync(tmp) && !fs.existsSync(CLAUDE_CREDENTIALS)) {
          fs.renameSync(tmp, CLAUDE_CREDENTIALS)
        }
      } catch {
        /* ignore */
      }
      debugLog(`credentials quarantine failed (live preserved if possible): ${err.message}`)
    }
  }
  let n = 0
  try {
    n = parseInt(fs.readFileSync(CRED_QUARANTINE_REF, 'utf8').trim(), 10) || 0
  } catch {
    n = 0
  }
  try {
    fs.writeFileSync(CRED_QUARANTINE_REF, String(n + 1), { mode: 0o600 })
  } catch {
    /* ignore */
  }
}

function restoreClaudeLoginCredentials() {
  let n = 1
  try {
    n = parseInt(fs.readFileSync(CRED_QUARANTINE_REF, 'utf8').trim(), 10) || 1
  } catch {
    n = 1
  }
  n = Math.max(0, n - 1)
  if (n === 0) {
    try {
      fs.unlinkSync(CRED_QUARANTINE_REF)
    } catch {
      /* ignore */
    }
  } else {
    try {
      fs.writeFileSync(CRED_QUARANTINE_REF, String(n), { mode: 0o600 })
    } catch {
      /* ignore */
    }
  }
  // Default: keep /login quarantined while using custom providers.
  if (process.env.CLAUDE_NATIVE_RESTORE_LOGIN !== '1') return
  if (n !== 0) return
  try {
    if (fs.existsSync(CLAUDE_CREDENTIALS_BAK) && !fs.existsSync(CLAUDE_CREDENTIALS)) {
      fs.renameSync(CLAUDE_CREDENTIALS_BAK, CLAUDE_CREDENTIALS)
      debugLog('restored ~/.claude/.credentials.json')
    }
  } catch (err) {
    debugLog(`credentials restore failed: ${err.message}`)
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
  const latest = resolveLatestOfficialClaude()
  if (!latest) return null
  return { command: latest.path, args: [], version: latest.version }
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
  // Default: official Claude Code harness whenever a binary exists.
  if (parseOfficialLaunch(rawArgs) || resolveLatestOfficialClaude()) return 'native'
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
  const fromExt = parseOfficialLaunch(rawArgs)
  const offeredPath =
    fromExt && !isNodeBinary(fromExt.command) ? fromExt.command : fromExt?.args?.[0]
  const preferred = preferLatestOfficial(
    offeredPath && String(offeredPath).endsWith('.exe')
      ? offeredPath
      : offeredPath && !String(offeredPath).endsWith('cli.js')
        ? offeredPath
        : null,
  )
  const bundled = findBundledClaudeExe()

  let command = preferred?.path || bundled?.command || null
  let userArgs = []
  if (fromExt) {
    // Extension may pass [claude.exe, ...args] or [node, cli.js, ...args]
    if (isNodeBinary(fromExt.command)) {
      // Prefer native binary over node+cli.js when we have one
      userArgs = fromExt.args.slice(1) // drop cli.js
      if (!command) {
        command = fromExt.command
        userArgs = fromExt.args
      }
    } else {
      userArgs = fromExt.args
      if (!command) command = fromExt.command
    }
  } else {
    userArgs = stripExtensionLauncher(rawArgs)
    if (!command && bundled) command = bundled.command
  }

  if (!command) {
    console.error(
      '[claude-wrapper] native mode: Claude Code binary not found.\n' +
        'Install with: irm https://claude.ai/install.ps1 | iex\n' +
        'Or install the Claude Code Cursor extension.\n' +
        'Legacy fork: CLAUDE_WRAPPER_MODE=claudio',
    )
    process.exit(1)
  }

  if (preferred?.replaced) {
    debugLog(
      `using official claude ${preferred.version?.raw || '?'} from ${preferred.path}` +
        (offeredPath ? ` (extension offered ${offeredPath})` : ''),
    )
  }

  const providersCfg = loadProvidersConfig()
  const isEphemeral =
    userArgs.includes('auth') ||
    userArgs.some((a) => a === '--version' || a === '-v' || a === 'version')

  let provider = null
  try {
    provider = resolveProvider(providersCfg.data)
  } catch {
    provider = null
  }
  // --version / auth: never start bridge (fast, no settings rewrite)
  const useBridge = !isEphemeral && !!(provider && provider.apiKey)

  let bridge = null
  let synced = { path: null, ids: [], changed: false }
  if (useBridge) {
    if (!isEphemeral) {
      synced = syncDefaultModel(providersCfg.data)
      if (synced.changed) {
        debugLog(
          `synced default model ${synced.model} → claude=${synced.claude?.path || 'n/a'} cursor=${synced.cursor?.path || 'n/a'}`,
        )
      }
    }
    const bridgeToken = getSharedBridgeToken()
    bridge = await startNativeBridge({
      token: bridgeToken,
      log: (...a) => debugLog(...a),
      getProvider: (requested) => resolveProvider(providersCfg.data, requested),
      getProvidersData: () => providersCfg.data,
      getProvidersPath: () => providersCfg.path,
    })
    debugLog(
      `native mode — provider=${provider.name} model=${provider.model} bridge=${bridge.url} binary=${command}`,
    )
  } else {
    debugLog(`native mode — passthrough (no provider API key) binary=${command}`)
  }

  debugLog(`spawn ${command} ${userArgs.join(' ')}`)

  const env = { ...process.env }
  if (useBridge && bridge) {
    env.ANTHROPIC_BASE_URL = bridge.url
    env.CLAUDE_CODE_SKIP_API_KEY_CHECK = process.env.CLAUDE_CODE_SKIP_API_KEY_CHECK || '1'
    env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY =
      process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY || '1'
    const bridgeToken = getSharedBridgeToken()
    // Only x-api-key — setting ANTHROPIC_AUTH_TOKEN triggers Claude's
    // "/login managed key" conflict and it may send the OAuth bearer instead.
    // Bridge accepts matching x-api-key even if a stale Bearer is also sent.
    env.ANTHROPIC_API_KEY = bridgeToken
    delete env.ANTHROPIC_AUTH_TOKEN
    // Optional escape hatch if login key still wins on some builds:
    if (process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL === '1') {
      env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL = '1'
    }
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_BASE
    delete env.OPENAI_MODEL
    delete env.CLAUDE_CODE_USE_OPENAI
    delete env.CLAUDE_CODE_USE_BEDROCK
    delete env.CLAUDE_CODE_USE_VERTEX
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_LOG
    quarantineClaudeLoginCredentials()
  }

  const child = spawn(command, userArgs, {
    stdio: 'inherit',
    env,
    windowsHide: true,
  })

  const shutdown = async () => {
    if (useBridge) restoreClaudeLoginCredentials()
    if (!bridge) return
    try {
      await bridge.close()
    } catch {
      /* ignore */
    }
  }

  const onSignal = async () => {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    await shutdown()
    process.exit(1)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  child.on('exit', async (code, signal) => {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
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
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
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
