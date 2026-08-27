#!/usr/bin/env node
/**
 * Process wrapper for official Claude Code (CLI / Cursor / VS Code).
 *
 * Keeps Anthropic's harness; swaps inference via a local
 * Anthropic Messages → OpenAI Chat Completions bridge.
 *
 * Configure: claudeCode.claudeProcessWrapper → this .exe (not .cmd on Windows).
 * Security: never spawn with shell:true + forwarded argv.
 */
const { spawn } = require('child_process')
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
  loadNativeEnvFiles,
  getSharedBridgeToken,
} = require('./lib/wrapper/env')
const {
  quarantineClaudeLoginCredentials,
  restoreClaudeLoginCredentials,
} = require('./lib/wrapper/credentials')

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

async function runNative(rawArgs) {
  loadNativeEnvFiles()
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
    if (isNodeBinary(fromExt.command)) {
      userArgs = fromExt.args.slice(1)
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
      '[claude-wrapper] Claude Code binary not found.\n' +
        'Install with: irm https://claude.ai/install.ps1 | iex\n' +
        'Or install the Claude Code Cursor/VS Code extension.',
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
  const isVersion =
    userArgs.some((a) => a === '--version' || a === '-v' || a === 'version')
  const isAuth = userArgs.includes('auth')
  const skipSettingsSync = isVersion || isAuth

  let provider = null
  try {
    provider = resolveProvider(providersCfg.data)
  } catch {
    provider = null
  }
  const useBridge = !isVersion && !!(provider && provider.apiKey)

  let bridge = null
  let synced = { path: null, ids: [], changed: false }
  if (useBridge) {
    if (!skipSettingsSync) {
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
      `native mode — provider=${provider.name} model=${provider.model} bridge=${bridge.url} binary=${command}` +
        (isAuth ? ' (auth)' : ''),
    )
  } else if (!isVersion && !isAuth) {
    // First-run: no provider/apiKey → show Third party providers instead of passthrough
    debugLog(`native mode — no provider API key, showing Third party providers`)
    try {
      const { showThirdPartyProviders } = require('./lib/provider/third-party-ui')
      const ok = await showThirdPartyProviders()
      process.exit(ok ? 0 : 1)
    } catch (err) {
      console.error('[claude-wrapper] No provider configured.')
      console.error('  Providers: OpenCode Zen (OPENCODE_API_KEY), Nvidia (NVIDIA_API_KEY), or OpenAI Compatible (OPENAI_API_KEY)')
      console.error('  Set the API key in claude-wrapper/.env or run: node lib/provider/third-party-ui.js')
      process.exit(1)
    }
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
    quarantineClaudeLoginCredentials()
    env.ANTHROPIC_API_KEY = bridgeToken
    delete env.ANTHROPIC_AUTH_TOKEN
    if (!env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT) {
      env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
    }
    if (process.env.CLAUDE_NATIVE_BRIDGE_STRICT === '1') {
      delete env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL
    } else {
      env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL =
        process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL || '1'
    }
    delete env.OPENAI_BASE_URL
    delete env.OPENAI_API_BASE
    delete env.OPENAI_MODEL
    delete env.OPENAI_HOST
    delete env.OPENAI_API_KEY
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
      if (child && !child.exitCode) {
        try {
          child.kill('SIGTERM')
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              try {
                child.kill('SIGKILL')
              } catch {
                /* ignore */
              }
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

const rawArgs = process.argv.slice(2)
debugLog(`argv0=${rawArgs[0] || ''}`)

runNative(rawArgs).catch((err) => {
  console.error('[claude-wrapper] failed:', err.message)
  process.exit(1)
})
