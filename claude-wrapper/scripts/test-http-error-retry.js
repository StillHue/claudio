/** Transient HTTP upstream errors get one same-model retry before surfacing. */
const assert = require('assert')
const { Readable } = require('stream')

function requestBody(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.headers = {}
  req.method = 'POST'
  req.url = '/v1/messages'
  return req
}

function responseRecorder() {
  let statusCode = 0
  let output = ''
  return {
    res: {
      writeHead(status) {
        statusCode = status
      },
      write(chunk) {
        output += chunk
        return true
      },
      end(chunk) {
        if (chunk) output += chunk
      },
    },
    result() {
      return { statusCode, output }
    },
  }
}

async function main() {
  const { handleMessages } = require('../lib/bridge/messages')
  const { resolveProvider, loadProvidersConfig } = require('../lib/provider/resolve')
  const providers = loadProvidersConfig()
  const attempts = []
  const previousFetch = global.fetch
  const previousDelay = process.env.CLAUDE_NATIVE_RETRY_DELAY_MS
  process.env.CLAUDE_NATIVE_RETRY_DELAY_MS = '0'

  global.fetch = async (url, options) => {
    attempts.push(JSON.parse(options.body))
    if (attempts.length === 1) {
      return {
        ok: false,
        status: 500,
        async text() {
          return '{"error":{"message":"Failed to generate completions"}}'
        },
      }
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: { role: 'assistant', content: 'Recovered.' },
              finish_reason: 'stop',
            },
          ],
        }
      },
    }
  }

  try {
    const body = {
      model: providers.data.providers[providers.data.active].model,
      max_tokens: 64,
      stream: false,
      messages: [{ role: 'user', content: 'say hi' }],
    }
    const recorder = responseRecorder()
    await handleMessages(requestBody(body), recorder.res, {
      getProvider: (model) => resolveProvider(providers.data, model),
      getProvidersData: () => providers.data,
      getProvidersPath: () => providers.path,
      log: () => {},
    })
    const result = recorder.result()
    assert.strictEqual(attempts.length, 2, '500 must be retried once')
    assert.strictEqual(result.statusCode, 200, 'successful retry must return 200')
    assert(result.output.includes('Recovered.'), 'successful retry response must be returned')
  } finally {
    global.fetch = previousFetch
    if (previousDelay === undefined) delete process.env.CLAUDE_NATIVE_RETRY_DELAY_MS
    else process.env.CLAUDE_NATIVE_RETRY_DELAY_MS = previousDelay
  }

  console.log('HTTP error retry: OK')
}

main().catch((error) => {
  console.error('FAIL:', error.message)
  process.exit(1)
})
