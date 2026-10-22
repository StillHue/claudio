/** Stream-error-in-200 (e.g. Nvidia 503 overloaded) must surface the real status, not the empty notice. */
const assert = require('assert')
const { Readable } = require('stream')

function sseBody(events) {
  const enc = new TextEncoder()
  const chunks = events.map((e) => enc.encode(`data: ${JSON.stringify(e)}\n\n`))
  let i = 0
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: chunks[i++] }
        },
      }
    },
  }
}

async function main() {
  const attempted = []
  const realFetch = global.fetch
  global.fetch = async (url, { body }) => {
    const { model } = JSON.parse(body)
    attempted.push(model)
    return {
      ok: true,
      body: sseBody([
        { error: { message: 'Service temporarily overloaded', type: 'service_unavailable', code: 503 } },
      ]),
    }
  }

  const { handleMessages } = require('../lib/bridge/messages')
  const { resolveProvider, loadProvidersConfig } = require('../lib/provider/resolve')
  const providers = loadProvidersConfig()
  const payload = JSON.stringify({
    model: providers.data.providers[providers.data.active].model,
    max_tokens: 64,
    stream: true,
    messages: [{ role: 'user', content: 'say hi' }],
  })
  const req = Readable.from([Buffer.from(payload)])
  req.headers = {}
  req.method = 'POST'
  req.url = '/v1/messages'

  let status = 0
  let out = ''
  const res = {
    writeHead(s) {
      status = s
    },
    write(c) {
      out += c
      return true
    },
    end(c) {
      if (c) out += c
    },
  }
  await handleMessages(req, res, {
    getProvider: (model) => resolveProvider(providers.data, model),
    getProvidersData: () => require('../lib/provider/resolve').loadProvidersConfig().data,
    getProvidersPath: () => require('../lib/provider/resolve').loadProvidersConfig().path,
    log: () => {},
  })
  global.fetch = realFetch

  console.log('attempted:', JSON.stringify(attempted), 'status:', status)
  assert(attempted.length >= 1, 'must attempt at least one upstream model')
  assert(
    attempted.every((m) => m.startsWith('nvidia/')),
    'all attempts stay within the active provider catalog',
  )
  assert.strictEqual(status, 503, 'real upstream status must propagate')
  assert(out.includes('Service temporarily overloaded'), 'real message must propagate')
  assert(!out.includes('upstream returned no content'), 'empty notice must NOT appear')
  console.log('stream-error wiring: OK')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
