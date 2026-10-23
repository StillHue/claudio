#!/usr/bin/env node






const { spawn } = require('child_process')
const path = require('path')
const {
  isNodeBinary,
  parseOfficialLaunch,
  selectLaunchTarget,
} = require('./lib/wrapper/launch')
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
const { openProviderSetup } = require('./provider-ui')
const {
  loadNativeEnvFiles,
  getSharedBridgeToken,
} = require('./lib/wrapper/env')
const {
  quarantineClaudeLoginCredentials,
  restoreClaudeLoginCredentials,
} = require('./lib/wrapper/credentials')

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

  const { command, userArgs } = selectLaunchTarget({
    fromExt,
    rawArgs,
    preferredPath: preferred?.path,
    bundled,
  })

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



  const lowerArgs = userArgs.map((a) => String(a).toLowerCase())
  const hasArg = (...names) => names.some((n) => lowerArgs.includes(n))
  const isVersion = hasArg('--version', '-v', 'version')
  const isHelp = hasArg('--help', '-h', 'help')
  const isDoctor = hasArg('doctor')
  const isAuth = hasArg('auth', 'login', 'logout', 'signup')
  const isPassthrough = isVersion || isHelp || isDoctor || isAuth
  const skipSettingsSync = isPassthrough

  let provider = null
  try {
    provider = resolveProvider(providersCfg.data)
  } catch {
    provider = null
  }
  const useBridge = !isPassthrough && !!(provider && provider.apiKey)

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
  } else if (!isPassthrough) {


    try {
      const fs = require('fs')
      const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json')
      const raw = fs.readFileSync(settingsPath, 'utf8')
      const settings = JSON.parse(raw)
      if (settings.enforceAvailableModels) {
        settings.enforceAvailableModels = false
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
        debugLog('cleared stale enforceAvailableModels (no provider key)')
      }
    } catch {

    }
    debugLog('native mode — no provider API key, opening setup page')
    await openProviderSetup({ log: (...a) => debugLog(...a) })
    return
  } else {
    debugLog(`native mode — passthrough (no provider API key) binary=${command}`)
  }


  debugLog(
    `spawn ${command} argc=${userArgs.length} first=${String(userArgs[0] || '').startsWith('-') ? userArgs[0] : '[prompt]'}`,
  )

  const env = { ...process.env }
  if (useBridge && bridge) {
    env.ANTHROPIC_BASE_URL = bridge.url
    env.CLAUDE_CODE_SKIP_API_KEY_CHECK = process.env.CLAUDE_CODE_SKIP_API_KEY_CHECK || '1'
    env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY =
      process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY || '1'



    if (!env.CLAUDE_CODE_AUTO_MODE_SERVER) {
      env.CLAUDE_CODE_AUTO_MODE_SERVER = '0'
    }
    const bridgeToken = getSharedBridgeToken()
    quarantineClaudeLoginCredentials()
    env.ANTHROPIC_AUTH_TOKEN = bridgeToken
    delete env.ANTHROPIC_API_KEY
    if (!env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT) {
      env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
    }


    delete env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL
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

  if (useBridge && bridge) {
    debugLog(
      `child auth env: apiKey=${env.ANTHROPIC_API_KEY ? 'set' : 'unset'} ` +
        `authToken=${env.ANTHROPIC_AUTH_TOKEN ? 'set' : 'unset'} baseUrl=local`,
    )
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

              }
              resolve()
            }, 5000)
            child.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
          })
        } catch {

        }
      }
      if (useBridge) restoreClaudeLoginCredentials()
      if (!bridge) return
      try {
        await bridge.close()
      } catch {

      }
    })()
    return shutdownPromise
  }

  const onSignal = async () => {
    try {
      child.kill()
    } catch {

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
debugLog(`argv0=${String(rawArgs[0] || '').startsWith('-') ? rawArgs[0] : '[prompt]'}`)

runNative(rawArgs).catch((err) => {
  console.error('[claude-wrapper] failed:', err.message)
  process.exit(1)
})
