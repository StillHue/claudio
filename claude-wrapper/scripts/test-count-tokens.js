#!/usr/bin/env node
const assert = require('assert')
const { estimateTokens, estimateInputTokens } = require('../lib/bridge/count-tokens')

assert.ok(estimateTokens('hello world') > 0)

const plain = estimateInputTokens({
  messages: [{ role: 'user', content: 'hello world' }],
})

const withSystem = estimateInputTokens({
  system: 'You are a careful coding agent with a long system prompt. '.repeat(20),
  messages: [{ role: 'user', content: 'hello world' }],
})
assert.ok(withSystem > plain, 'system must increase token estimate')

const withTools = estimateInputTokens({
  messages: [{ role: 'user', content: 'hello world' }],
  tools: [
    {
      name: 'Bash',
      description: 'Run a shell command',
      input_schema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'command to run' } },
      },
    },
  ],
})
assert.ok(withTools > plain, 'tools must increase token estimate')

const withImage = estimateInputTokens({
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'see' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'a'.repeat(4000) },
        },
      ],
    },
  ],
})
assert.ok(withImage > plain, 'images must increase token estimate')

const withToolResult = estimateInputTokens({
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: 'file contents ' + 'x'.repeat(2000),
        },
      ],
    },
  ],
})
assert.ok(withToolResult > plain, 'tool_result must increase token estimate')

console.log('count_tokens hardening: OK')
