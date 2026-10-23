#!/usr/bin/env node
const assert = require('assert')
const { Readable } = require('stream')

function sseBody(events) {
  const chunks = events.map((event) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index === chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[index++])
    },
  })
}

function requestBody(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.headers = {}
  req.method = 'POST'
  req.url = '/v1/messages'
  return req
}

function responseRecorder() {
  let statusCode = 0
  let output = ''
  return {
    res: {
      writeHead(status) {
        statusCode = status
      },
      write(chunk) {
        output += chunk
        return true
      },
      end(chunk) {
        if (chunk) output += chunk
      },
    },
    result() {
      return { statusCode, output }
    },
  }
}

function parseSse(output) {
  return output
    .split('\n\n')
    .map((frame) => {
      const event = frame.match(/^event: (.+)$/m)?.[1]
      const data = frame.match(/^data: (.+)$/m)?.[1]
      if (!event || !data) return null
      return { event, data: JSON.parse(data) }
    })
    .filter(Boolean)
}

async function main() {
  const { handleMessages } = require('../lib/bridge/messages')
  const calls = []
  const replies = [
    sseBody([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_readme',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'README.md"}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9 } },
      '[DONE]',
    ]),
    sseBody([
      { choices: [{ delta: { content: 'The README says hello.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 150, completion_tokens: 6 } },
      '[DONE]',
    ]),
    {
      ok: false,
      status: 400,
      async text() {
        return '{"error":"unsupported stream_options"}'
      },
    },
    sseBody([
      { choices: [{ delta: { content: 'Fallback answer.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      '[DONE]',
    ]),
  ]
  const previousFetch = global.fetch
  const logs = []
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    const reply = replies.shift()
    return reply && typeof reply === 'object' && 'ok' in reply
      ? reply
      : { ok: true, body: reply }
  }

  const provider = {
    name: 'test',
    baseUrl: 'https://provider.invalid/v1',
    model: 'test-model',
    apiKey: 'test-key',
  }
  const ctx = {
    getProvider: () => provider,
    getProvidersData: () => null,
    log: (message) => logs.push(message),
  }

  try {
    const firstBody = {
      model: 'anthropic.test.test-model',
      max_tokens: 128,
      stream: true,
      tool_choice: { type: 'any' },
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
      messages: [{ role: 'user', content: 'Read the README.' }],
    }
    const firstResponse = responseRecorder()
    await handleMessages(requestBody(firstBody), firstResponse.res, ctx)
    const first = firstResponse.result()
    assert.strictEqual(first.statusCode, 200)
    const firstEvents = parseSse(first.output)
    const toolStart = firstEvents.find((event) => event.event === 'content_block_start' && event.data.content_block.type === 'tool_use')
    assert.ok(toolStart, 'tool call must become an Anthropic tool_use block')
    assert.strictEqual(toolStart.data.content_block.id, 'call_readme')
    assert.strictEqual(toolStart.data.content_block.name, 'read_file')
    const argumentDeltas = firstEvents
      .filter((event) => event.event === 'content_block_delta' && event.data.delta.type === 'input_json_delta')
      .map((event) => event.data.delta.partial_json)
    assert.strictEqual(argumentDeltas.join(''), '{"path":"README.md"}')
    assert.strictEqual(
      firstEvents.find((event) => event.event === 'message_delta').data.delta.stop_reason,
      'tool_use',
    )
    assert.ok(
      firstEvents.find((event) => event.event === 'message_start').data.message.usage.input_tokens > 0,
      'streamed input usage must have a non-zero estimate before upstream usage arrives',
    )
    assert.strictEqual(firstEvents.find((event) => event.event === 'message_delta').data.usage.output_tokens, 9)
    assert.deepStrictEqual(calls[0].body.stream_options, { include_usage: true })

    const secondResponse = responseRecorder()
    await handleMessages(
      requestBody({
        model: 'anthropic.test.test-model',
        max_tokens: 128,
        stream: true,
        messages: [
          { role: 'user', content: 'Read the README.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_readme',
                name: 'read_file',
                input: { path: 'README.md' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_readme',
                content: 'The README says hello.',
              },
            ],
          },
        ],
      }),
      secondResponse.res,
      ctx,
    )
    const second = secondResponse.result()
    assert.strictEqual(second.statusCode, 200)
    assert.ok(parseSse(second.output).some((event) => event.event === 'content_block_delta' && event.data.delta.text === 'The README says hello.'))
    const followupMessages = calls[1].body.messages
    assert.strictEqual(followupMessages[1].tool_calls[0].id, 'call_readme')
    assert.strictEqual(followupMessages[2].role, 'tool')
    assert.strictEqual(followupMessages[2].tool_call_id, 'call_readme')
    assert.strictEqual(followupMessages[2].content, 'The README says hello.')

    const fallbackResponse = responseRecorder()
    await handleMessages(
      requestBody({
        model: 'anthropic.test.test-model',
        max_tokens: 128,
        stream: true,
        messages: [{ role: 'user', content: 'Answer briefly.' }],
      }),
      fallbackResponse.res,
      ctx,
    )
    const fallbackEvents = parseSse(fallbackResponse.result().output)
    assert.strictEqual(fallbackResponse.result().statusCode, 200)
    assert.deepStrictEqual(calls[2].body.stream_options, { include_usage: true })
    assert.strictEqual(calls[3].body.stream_options, undefined)
    assert.ok(
      fallbackEvents.find((event) => event.event === 'message_delta').data.usage.output_tokens > 0,
      'missing upstream usage must produce a non-zero estimated output count',
    )
    assert.ok(logs.includes('[compat] upstream rejected stream usage option; retrying without it'))
  } finally {
    global.fetch = previousFetch
  }

  console.log('bridge tool cycle and stream usage: OK')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
