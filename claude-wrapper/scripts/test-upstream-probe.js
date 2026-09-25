/** Live upstream probe: checks both nemotron models for empty streams. */
const fs = require('fs')
const path = require('path')
const os = require('os')

async function main() {
  const envRaw = fs.readFileSync(path.join(os.homedir(), '.claude', '.env'), 'utf8')
  const line = envRaw.split('\n').find((l) => l.trim().startsWith('NVIDIA_API_KEY='))
  const key = line ? line.split('=').slice(1).join('=').trim() : ''
  if (!key) throw new Error('no NVIDIA_API_KEY in ~/.claude/.env')

  const models = ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b']
  let fails = 0
  for (const m of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'reply with exactly: pong' }],
          max_tokens: 32,
          stream: true,
        }),
        signal: AbortSignal.timeout(90000),
      })
      if (!r.ok) {
        console.log(m, 'attempt' + attempt, 'HTTP', r.status, (await r.text()).slice(0, 120))
        fails++
        continue
      }
      const t = await r.text()
      let textLen = 0
      for (const mt of t.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)) textLen += mt[1].length
      const toolRefs = (t.match(/tool_calls/g) || []).length
      console.log(
        m, 'attempt' + attempt,
        'bytes=' + t.length, 'textLen=' + textLen, 'toolRefs=' + toolRefs,
      )
      if (textLen === 0 && toolRefs === 0) fails++
    }
  }
  console.log(fails === 0 ? 'PROBE: both models returned content' : `PROBE: ${fails} empty/failed response(s)`)
  process.exit(fails === 0 ? 0 : 2)
}

main().catch((e) => {
  console.error('PROBE FAIL:', e.message)
  process.exit(1)
})
