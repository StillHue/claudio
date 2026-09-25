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
    if (model.includes('ultra')) {
      // ultra returns empty stream (the bug scenario)
      return { ok: true, body: sseBody([]) }
    }
    // super returns content
    return {
      ok: true,
      body: sseBody([textChunk('hello from super'), textChunk('', 'stop')]),
    }
  }

  const { handleMessages } = require('../lib/bridge/messages')
  const payload = JSON.stringify({
    model: 'anthropic.mistral.mistral-code-latest',
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
  assert.deepStrictEqual(
    attempted,
    ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-ultra-550b-a55b'],
    'single-model cascade: one same-model retry, then honest notice',
  )
  assert(!attempted.includes('nvidia/nemotron-3-super-120b-a12b'), 'no fallback model')
  assert(out.includes('upstream returned no content'), 'notice must surface when all attempts are empty')
  console.log('single-model wiring: OK')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
