/** Capture a raw empty upstream response to inspect its structure. */
const fs = require('fs')
const path = require('path')
const os = require('os')

async function once(key, withTools) {
  const tools = withTools
    ? Array.from({ length: 200 }, (_, i) => ({
        type: 'function',
        function: {
          name: `tool_${i}`,
          description: `test tool number ${i} that does something useful for the agent workflow`,
          parameters: { type: 'object', properties: { arg: { type: 'string' } } },
        },
      }))
    : undefined
  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      max_tokens: 32000,
      stream: true,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  })
  const t = await r.text()
  return { status: r.status, bytes: t.length, text: t }
}

async function main() {
  const envRaw = fs.readFileSync(path.join(os.homedir(), '.claude', '.env'), 'utf8')
  const key = envRaw.split('\n').find((l) => l.trim().startsWith('NVIDIA_API_KEY=')).split('=').slice(1).join('=').trim()
  for (const withTools of [false, true]) {
    console.log(`=== withTools=${withTools} ===`)
    for (let i = 1; i <= 6; i++) {
      const res = await once(key, withTools)
      let textLen = 0
      for (const m of res.text.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)) textLen += m[1].length
      const finish = [...res.text.matchAll(/"finish_reason":("[^"]*"|null)/g)].map((m) => m[1]).join(',')
      console.log(`try${i}: status=${res.status} bytes=${res.bytes} textLen=${textLen} finish=[${finish}]`)
      if (textLen === 0 && res.bytes < 2000) {
        console.log('--- RAW EMPTY BODY ---')
        console.log(res.text)
        console.log('--- END ---')
        break
      }
    }
  }
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
