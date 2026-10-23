#!/usr/bin/env node
const assert = require('assert')
const http = require('http')
const { startNativeBridge } = require('../native-bridge')

function requestHead(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'HEAD' }, (res) => {
      res.resume()
      res.on('end', () => resolve(res))
    })
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  const envKeys = [
    'CLAUDE_NATIVE_ANTHROPIC_API_KEY',
    'ANTHROPIC_REAL_API_KEY',
    'CLAUDE_NATIVE_BRIDGE_STRICT',
    'CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL',
  ]
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  process.env.CLAUDE_NATIVE_ANTHROPIC_API_KEY = ''
  process.env.ANTHROPIC_REAL_API_KEY = ''
  process.env.CLAUDE_NATIVE_BRIDGE_STRICT = '0'
  delete process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL

  const logs = []
  const bridge = await startNativeBridge({
    log: (message) => logs.push(message),
    getProvider: () => null,
    getProvidersData: () => ({ providers: {} }),
  })

  try {
    const response = await requestHead(`${bridge.url}/api/hello`)
    assert.strictEqual(response.statusCode, 200)
    assert.ok(logs.includes('HEAD /api/hello → 200 (local bridge)'))
    assert.ok(!logs.some((line) => line.includes('proxy-to-anthropic skipped')))
  } finally {
    await bridge.close()
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
  }

  console.log('bridge health endpoint: OK')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
