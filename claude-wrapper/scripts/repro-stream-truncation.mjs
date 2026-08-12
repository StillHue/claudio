#!/usr/bin/env node
/**
 * Capture upstream SSE content deltas and replay through readOpenAIStream
 * to detect truncation / bold-marker damage.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { readOpenAIStream } = require('../lib/bridge/stream')

const providers = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), '.claude-native', 'providers.json'), 'utf8'),
)

async function streamProvider(name, prompt) {
  const p = providers.providers[name]
  if (!p?.apiKey && !(p?.apiKeyEnv && process.env[p.apiKeyEnv])) {
    console.log(`skip ${name}: no key`)
    return null
  }
  const key = p.apiKey || process.env[p.apiKeyEnv]
  const base = String(p.baseUrl || '').replace(/\/$/, '')
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const model = p.model
  console.log(`\n=== ${name} model=${model} ===`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  })
  if (!res.ok) {
    console.log('HTTP', res.status, (await res.text()).slice(0, 200))
    return null
  }

  const rawChunks = []
  const emitted = []
  // Tee: collect raw deltas while feeding reader
  const [a, b] = res.body.tee()
  const reader = a.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const c = j.choices?.[0]?.delta?.content
        if (c) rawChunks.push(c)
      } catch {
        /* ignore */
      }
    }
  }

  // Replay via our adapter using a synthetic stream of the original body... 
  // Instead reconstruct from collected chunks by making a fake SSE body.
  const sse = rawChunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
  const fakeBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse))
      controller.close()
    },
  })

  const result = await readOpenAIStream(fakeBody, {
    onText(d) {
      emitted.push(d)
    },
  })

  const naiveJoin = rawChunks.join('')
  const assembled = result.text
  console.log('raw deltas', rawChunks.length)
  console.log('sample deltas', rawChunks.slice(0, 8).map((c) => JSON.stringify(c)))
  console.log('naiveJoin len', naiveJoin.length)
  console.log('assembled len', assembled.length)
  console.log('match', naiveJoin === assembled)
  if (naiveJoin !== assembled) {
    // find first diff
    let i = 0
    while (i < Math.min(naiveJoin.length, assembled.length) && naiveJoin[i] === assembled[i]) i++
    console.log('first diff at', i)
    console.log('naive around', JSON.stringify(naiveJoin.slice(Math.max(0, i - 20), i + 20)))
    console.log('assem around', JSON.stringify(assembled.slice(Math.max(0, i - 20), i + 20)))
  }
  // Check for eaten letters pattern / unmatched **
  const openBold = (assembled.match(/\*\*/g) || []).length
  console.log('** count', openBold, 'odd?', openBold % 2 === 1)
  console.log('tail', JSON.stringify(assembled.slice(-120)))
  return { naiveJoin, assembled, rawChunks }
}

const prompt =
  'Responda em português com markdown. Use negrito em 5 palavras. ' +
  'Inclua exatamente estas palavras: externo, custo, sede, ajuste, backend. ' +
  '3 frases curtas.'

;(async () => {
  for (const name of ['cohere', 'opencode']) {
    if (!providers.providers[name]) continue
    await streamProvider(name, prompt)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
