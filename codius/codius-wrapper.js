#!/usr/bin/env node
const { spawn, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { startBridge } = require('./codius-bridge')

const CODEX_CONFIG = path.join(os.homedir(), '.codex', 'config.toml')
const CODEX_BINARY_DETECT = [
  path.join(os.homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin'),
]
const PROVIDERS_PATH = path.join(os.homedir(), '.claude-native', 'providers.json')
const PORT = parseInt(process.env.CODIUS_PORT || '4890', 10)

function findCodexBinary() {
  try {
    const dirs = fs.readdirSync(CODEX_BINARY_DETECT[0])
    const bins = dirs
      .map((d) => path.join(CODEX_BINARY_DETECT[0], d, 'codex.exe'))
      .filter(fs.existsSync)
    bins.sort().reverse()
    return bins[0] || null
  } catch {
    return null
  }
}

function patchCodexConfig(bridgeUrl) {
  try {
    let raw = fs.readFileSync(CODEX_CONFIG, 'utf8')

    const hasBaseUrl = /^\[.*proxy|base_url|api_base/i.test(raw)
    if (!hasBaseUrl) {
      const inject = `\n\n# codius: local proxy\n[proxy]\nbase_url = "${bridgeUrl}"\n`
      raw += inject
      fs.writeFileSync(CODEX_CONFIG, raw, 'utf8')
      console.log(`patched ${CODEX_CONFIG} → proxy.base_url = ${bridgeUrl}`)
    }
  } catch (err) {
    console.error(`could not patch Codex config: ${err.message}`)
  }
}

function detectEnvVars() {
  const env = { ...process.env }

  if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
    env.HTTPS_PROXY = `http://127.0.0.1:${PORT}`
    env.HTTP_PROXY = `http://127.0.0.1:${PORT}`
    env.NO_PROXY = 'localhost,127.0.0.1,.local'
  }

  return env
}

function diagnose() {
  console.log('\ncodius — Codex wrapper')
  console.log('=====================')
  console.log()

  const binary = findCodexBinary()
  if (binary) {
    console.log(`codex binary: ${binary}`)
  } else {
    console.log('codex binary: not found')
  }

  console.log(`codex config: ${fs.existsSync(CODEX_CONFIG) ? CODEX_CONFIG : 'not found'}`)

  const providers = (() => {
    try { return JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf8')) } catch { return null }
  })()
  if (providers) {
    const active = providers.active || 'opencode'
    const p = providers.providers?.[active]
    console.log(`provider: ${active} → ${p?.baseUrl || '?'} (model: ${p?.model || '?'})`)
  } else {
    console.log('provider: not configured')
  }

  console.log(`bridge port: ${PORT}`)
  console.log()
}

function runBridgeAndExit() {
  const bridge = startBridge()
  console.log(`codius bridge: http://127.0.0.1:${PORT}`)
  console.log('Press Ctrl+C to stop')
}

function showHelp() {
  console.log(`
codius — Codex OpenAI API wrapper

USAGE
  codius bridge       Start the proxy bridge on port ${PORT}
  codius launch       Launch Codex with proxy
  codius status       Show diagnostics
  codius config       Patch Codex config to use proxy
  codius help         Show this help

ENV
  CODIUS_PORT         Bridge port (default: ${PORT})
  CODIUS_DEBUG=1      Verbose logs

Requires ~/.claude-native/providers.json (shared with claude-wrapper).
`)
}

const cmd = process.argv[2]

if (cmd === 'bridge' || cmd === 'start') {
  diagnose()
  runBridgeAndExit()
} else if (cmd === 'launch') {
  diagnose()
  const binary = findCodexBinary()
  if (!binary) {
    console.error('Codex binary not found')
    process.exit(1)
  }

  const bridge = startBridge()
  const env = detectEnvVars()

  const child = spawn(binary, process.argv.slice(3), {
    stdio: 'inherit',
    env,
    windowsHide: true,
  })

  child.on('exit', (code) => {
    bridge.close()
    process.exit(code ?? 0)
  })
} else if (cmd === 'config') {
  patchCodexConfig(`http://127.0.0.1:${PORT}`)
} else if (cmd === 'status' || cmd === 'diagnose') {
  diagnose()
} else {
  showHelp()
}
