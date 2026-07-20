/**
 * Anthropic Messages SSE helpers (chat text only).
 */

export function newMessageId() {
  return `msg_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function writeSse(res, event, data) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function startAnthropicStream(res, { model, messageId }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'x-claudio-browser-proxy': 'local',
  })

  writeSse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })

  writeSse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  })

  writeSse(res, 'ping', { type: 'ping' })
}

export function writeTextDelta(res, text) {
  if (!text) return
  writeSse(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
}

export function endAnthropicStream(res, { stopReason = 'end_turn' } = {}) {
  writeSse(res, 'content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  })
  writeSse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 0 },
  })
  writeSse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

export function anthropicJsonMessage({ model, messageId, text }) {
  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }
}
