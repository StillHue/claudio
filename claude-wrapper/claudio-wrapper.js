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
const { debugLog } = require('./lib/wrapper/log')
const {
  loadVisionEnvFiles,
  wrapperBaseDir,
  getSharedBridgeToken,
} = require('./lib/wrapper/env')
const {
  quarantineClaudeLoginCredentials,
  restoreClaudeLoginCredentials,
} = require('./lib/wrapper/credentials')

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
    // Quarantine BEFORE injecting tokens so /login cannot win the race.
    quarantineClaudeLoginCredentials()
    // With login aside, set both headers to the bridge token so Claude
    // presents a matching x-api-key and/or Bearer to the local bridge.
    env.ANTHROPIC_API_KEY = bridgeToken
    env.ANTHROPIC_AUTH_TOKEN = bridgeToken
    // Default open on loopback: Claude often presents /login OAuth instead of
    // our token → 401 and every slash (including /provider) looks "dead".
    // Opt into strict shared-token auth with CLAUDE_NATIVE_BRIDGE_STRICT=1
    // (and unset CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL).
    if (process.env.CLAUDE_NATIVE_BRIDGE_STRICT === '1') {
      delete env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL
    } else {
      env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL =
        process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL || '1'
    }
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_BASE
    delete env.OPENAI_MODEL
    delete env.CLAUDE_CODE_USE_OPENAI
    delete env.CLAUDE_CODE_USE_BEDROCK
    delete env.CLAUDE_CODE_USE_VERTEX
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_LOG
  }

  const child = spawn(command, userArgs, {
    stdio: 'inherit',
    env,
    windowsHide: true,
  })

  let shutdownPromise = null
  const shutdown = async () => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      // Wait for child to exit first (with timeout)
      if (child && !child.exitCode) {
        try {
          child.kill('SIGTERM')
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              try { child.kill('SIGKILL') } catch {}
              resolve()
            }, 5000)
            child.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
          })
        } catch {
          /* ignore */
        }
      }
      if (useBridge) restoreClaudeLoginCredentials()
      if (!bridge) return
      try {
        await bridge.close()
      } catch {
        /* ignore */
      }
    })()
    return shutdownPromise
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
