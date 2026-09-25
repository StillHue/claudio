/** Latency probe: TTFB + total per model, tiny prompt. */
const fs = require('fs')
const path = require('path')
const os = require('os')

async function timeModel(key, model) {
  const t0 = Date.now()
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      max_tokens: 32,
      stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) {
    console.log(model, 'HTTP', r.status)
    return
  }
  const reader = r.body.getReader()
  let firstByte = 0
  let firstText = 0
  let bytes = 0
  const dec = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstByte) firstByte = Date.now() - t0
    bytes += value.length
    const chunk = dec.decode(value, { stream: true })
    if (!firstText && /"content":"[^"]/.test(chunk)) firstText = Date.now() - t0
  }
  console.log(
    `${model} ttfb=${firstByte}ms firstText=${firstText}ms total=${Date.now() - t0}ms bytes=${bytes}`,
  )
}

async function main() {
  const envRaw = fs.readFileSync(path.join(os.homedir(), '.claude', '.env'), 'utf8')
  const line = envRaw.split('\n').find((l) => l.trim().startsWith('NVIDIA_API_KEY='))
  const key = line ? line.split('=').slice(1).join('=').trim() : ''
  if (!key) throw new Error('no key')
  for (const m of ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b']) {
    await timeModel(key, m)
  }
}
main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
