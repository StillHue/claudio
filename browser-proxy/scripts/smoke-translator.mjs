import assert from 'node:assert/strict'
import {
  extractTextFromStreamJsonLine,
  messagesToPrompt,
  shouldInterceptPath,
} from '../src/translator.js'

assert.equal(shouldInterceptPath('/v1/messages', ['/v1/messages']), true)
assert.equal(shouldInterceptPath('/v1/messages?beta=true', ['/v1/messages']), true)
assert.equal(shouldInterceptPath('/v1/models', ['/v1/messages']), false)

const prompt = messagesToPrompt({
  system: 'sys',
  messages: [{ role: 'user', content: 'oi' }],
})
assert.match(prompt, /oi/)
assert.match(prompt, /sys/)

assert.equal(
  extractTextFromStreamJsonLine(
    JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Olá' },
    }),
  ),
  'Olá',
)

assert.equal(
  extractTextFromStreamJsonLine(
    JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'x' },
      },
    }),
  ),
  'x',
)

console.log('translator smoke ok')
