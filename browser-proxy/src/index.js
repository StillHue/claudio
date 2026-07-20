#!/usr/bin/env node
import fs from 'node:fs'
import {
  CONFIG_PATH,
  loadConfig,
  writeDefaultConfigIfMissing,
  LOG_PATH,
} from './config.js'
import { createProxyServer } from './proxy.js'

function parseArgs(argv) {
  const out = { mode: null, port: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mode' && argv[i + 1]) out.mode = argv[++i]
    else if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i])
    else if (a === '--passthrough') out.mode = 'passthrough'
    else if (a === '--local') out.mode = 'local'
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function help() {
  console.log(`claudio-browser-proxy — MITM for official Claude extension → Claudio

Usage:
  node src/index.js [--local|--passthrough] [--mode local|passthrough] [--port N]

Config:  ${CONFIG_PATH}
  mode: local (Claudio) | passthrough (Anthropic)

Health:  GET http://127.0.0.1:<port>/health
Toggle:  POST http://127.0.0.1:<port>/mode  {"mode":"local"|"passthrough"}

Env:
  CLAUDIO_BROWSER_PROXY_MODE
  CLAUDIO_BROWSER_PROXY_PORT
  CLAUDIO_BROWSER_PROXY_BIN
  CLAUDIO_BROWSER_PROXY_MODEL
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    help()
    process.exit(0)
  }

  writeDefaultConfigIfMissing()
  const config = loadConfig()
  if (args.mode) config.mode = args.mode
  if (args.port) config.port = args.port

  // Fly / cloud defaults
  if (process.env.FLY_APP_NAME) {
    config.host = process.env.CLAUDIO_BROWSER_PROXY_HOST || '0.0.0.0'
    if (!process.env.BRIDGE_MODE) config.bridge = 'openai'
  }

  if (config.bridge === 'openai' && (!config.openaiApiKey || !config.openaiBaseUrl)) {
    console.warn(
      '[browser-proxy] bridge=openai but OPENAI_API_KEY / OPENAI_BASE_URL missing — set fly secrets',
    )
  }
  if (process.env.FLY_APP_NAME && !config.proxyUser) {
    console.warn(
      '[browser-proxy] WARNING: public Fly proxy without PROXY_USER/PROXY_PASS — set secrets',
    )
  }

  const { server, ca } = createProxyServer(config)

  // tee simple log
  try {
    const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' })
    const orig = console.log
    console.log = (...xs) => {
      orig(...xs)
      try {
        logStream.write(xs.map(String).join(' ') + '\n')
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  server.listen(config.port, config.host, () => {
    console.log(`[browser-proxy] listening on http://${config.host}:${config.port}`)
    console.log(`[browser-proxy] mode=${config.mode} bridge=${config.bridge}`)
    console.log(`[browser-proxy] CA cert: ${ca.certPath}`)
    console.log(`[browser-proxy] health: http://${config.host}:${config.port}/health`)
    console.log(`[browser-proxy] CA download: http://${config.host}:${config.port}/ca.crt`)
    if (!process.env.FLY_APP_NAME) {
      console.log(`[browser-proxy] config: ${CONFIG_PATH}`)
    }
  })

  const shutdown = () => {
    console.log('[browser-proxy] shutting down')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
