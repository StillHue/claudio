#!/usr/bin/env node
// Minimal stand-in for claudio -p stream-json (smoke tests only)
import readline from 'node:readline'

const args = process.argv.slice(2)
if (!args.includes('-p')) {
  console.error('fake-claudio: expected -p')
  process.exit(2)
}

const prompt = args[args.length - 1] || ''
const reply = prompt.includes('oi') ? 'Olá do Claudio local' : `echo:${prompt.slice(0, 80)}`

const events = [
  {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: reply },
    },
  },
  { type: 'result', result: reply, subtype: 'success' },
]

for (const ev of events) {
  console.log(JSON.stringify(ev))
}
