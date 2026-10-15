/** Focused test: fallback cascade wiring (messages.js -> messages-chat.js). */
const assert = require('assert')

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
const textChunk = (t, finish) => ({
  choices: [{ delta: { content: t }, finish_reason: finish || null }],
})

async function main() {
  const attempted = []
  const realFetch = global.fetch
  global.fetch = async (url, { body }) => {
    const { model } = JSON.parse(body)
    attempted.push(model)
    // Generic provider-agnostic path: first routed model succeeds.
    return {
      ok: true,
      body: sseBody([textChunk('hello from ' + model), textChunk('', 'stop')]),
    }
  }

  const { handleMessages } = require('../lib/bridge/messages')
  const { AUTO_PICKER_ID } = require('../lib/provider/resolve')
  const payload = JSON.stringify({
    model: AUTO_PICKER_ID,
    max_tokens: 64,
    stream: true,
    messages: [{ role: 'user', content: 'say hi' }],
  })
  const { Readable } = require('stream')
  const req = Readable.from([Buffer.from(payload)])
  req.headers = {}
  req.method = 'POST'
  req.url = '/v1/messages'

  let out = ''
  const res = {
    writeHead() {},
    write(c) {
      out += c
      return true
    },
    end() {},
  }
  await handleMessages(req, res, {
    getProvider: () => {
      throw new Error('should not hit concrete path')
    },
    getProvidersData: () => require('../lib/provider/resolve').loadProvidersConfig().data,
    getProvidersPath: () => require('../lib/provider/resolve').loadProvidersConfig().path,
    log: () => {},
  })
  global.fetch = realFetch

  console.log('attempted:', JSON.stringify(attempted))
  assert(attempted.length >= 1, 'must attempt at least one upstream model')
  assert(
    attempted.every((m) => m.startsWith('nvidia/')),
    'all attempts stay within the active provider catalog',
  )
  assert(out.includes('hello from'), 'content must surface on success')
  console.log('provider-agnostic wiring: OK')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
