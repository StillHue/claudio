#!/usr/bin/env node
const assert = require('assert')
const {
  anthropicToOpenAIMessages,
  supportsDirectVision,
} = require('../lib/bridge/translate')

assert.strictEqual(
  supportsDirectVision('mimo-v2.5-free'),
  true,
  'MiMo-V2.5 Free must receive images directly',
)
assert.strictEqual(
  supportsDirectVision('deepseek-v4-flash-free'),
  false,
  'DeepSeek Flash must retain the external vision fallback',
)
assert.strictEqual(
  supportsDirectVision('mimo-v2.5-pro'),
  false,
  'MiMo-V2.5 Pro is text-only',
)

const messages = anthropicToOpenAIMessages({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Leia esta imagem' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'aGVsbG8=',
          },
        },
      ],
    },
  ],
})

assert.deepStrictEqual(messages[0].content, [
  { type: 'text', text: 'Leia esta imagem' },
  {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,aGVsbG8=' },
  },
])

console.log('MiMo direct vision capability and image conversion: OK')
