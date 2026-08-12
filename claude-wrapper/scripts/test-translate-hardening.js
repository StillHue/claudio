#!/usr/bin/env node
/** Regression: empty assistants, reasoning echo, tool-image handling. */
const assert = require('assert')
const { anthropicToOpenAIMessages } = require('../lib/bridge/translate')

// Blank assistant history must not become content: null (MiMo 400).
{
  const out = anthropicToOpenAIMessages({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: '' }] },
      { role: 'user', content: 'continue' },
    ],
  })
  const asst = out.find((m) => m.role === 'assistant')
  assert.ok(!asst || asst.content !== null, 'blank assistant must not be content:null')
  if (asst) assert.strictEqual(typeof asst.content, 'string')
}

// Completely empty assistant turns are omitted.
{
  const out = anthropicToOpenAIMessages({
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [] },
      { role: 'user', content: 'continue' },
    ],
  })
  assert.ok(!out.some((m) => m.role === 'assistant'), 'empty assistant should be omitted')
}

// Thinking must round-trip as reasoning_content.
{
  const out = anthropicToOpenAIMessages({
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan steps' },
          { type: 'text', text: 'done' },
        ],
      },
    ],
  })
  const asst = out.find((m) => m.role === 'assistant')
  assert.strictEqual(asst.content, 'done')
  assert.strictEqual(asst.reasoning_content, 'plan steps')
}

// Thinking-only + tool_use: null content is OK only with tool_calls + reasoning.
{
  const out = anthropicToOpenAIMessages({
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'need tool' },
          { type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    ],
  })
  const asst = out.find((m) => m.role === 'assistant')
  assert.strictEqual(asst.reasoning_content, 'need tool')
  assert.ok(asst.tool_calls?.length === 1)
  assert.strictEqual(asst.content, null)
}

// Tool-result images: string marker on tool + image_url on following user message.
{
  const out = anthropicToOpenAIMessages({
    messages: [
      { role: 'user', content: 'read png' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_img', name: 'Read', input: { file: 'a.png' } }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_img',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
              },
            ],
          },
        ],
      },
    ],
  })
  const tool = out.find((m) => m.role === 'tool')
  assert.ok(tool, 'tool message required')
  assert.strictEqual(typeof tool.content, 'string')
  assert.ok(!tool.content.includes('aGVsbG8='), 'must not dump base64 into tool content')
  assert.ok(tool.content.includes('[image'), 'should keep a short marker')
  const imgUser = out.find(
    (m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === 'image_url'),
  )
  assert.ok(imgUser, 'tool images must be forwarded as user image_url')
  assert.deepStrictEqual(imgUser.content.find((p) => p.type === 'image_url'), {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,aGVsbG8=' },
  })
}

// Orphan tool_result with empty tool_use_id is skipped.
{
  const out = anthropicToOpenAIMessages({
    messages: [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: '', content: 'x' }],
      },
    ],
  })
  assert.ok(!out.some((m) => m.role === 'tool'), 'empty tool_call_id must be skipped')
}

console.log('translate hardening: OK')
