#!/usr/bin/env node
const assert = require('assert')
const { anthropicToOpenAIMessages } = require('../lib/bridge/translate')

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

console.log('image conversion: OK')
