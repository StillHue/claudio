/**
 * OpenAI Responses API SSE reader.
 * Normalizes reasoning + output_text deltas into Anthropic thinking/text.
 */
const { takeDelta } = require('./delta')

async function readResponsesStream(body, handlers) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let fullText = ''
  let fullReasoning = ''
  const toolAcc = new Map()
  let finishReason = 'end_turn'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]' || !data) continue
      let evt
      try {
        evt = JSON.parse(data)
      } catch {
        continue
      }

      const type = evt.type || ''

      // Text deltas
      if (type === 'response.output_text.delta') {
        const delta = evt.delta || ''
        if (delta) {
          const { text, emit } = takeDelta(fullText, delta)
          // For reasoning-heavy models, treat first reasoning output correctly
          // output_text.delta is always visible text (not reasoning)
          fullText = text
          if (emit) handlers.onText?.(emit)
        }
        continue
      }

      // Reasoning deltas (some providers emit these as separate events)
      if (
        type === 'response.reasoning_text.delta' ||
        type === 'response.reasoning.delta' ||
        type === 'response.reasoning_summary_text.delta'
      ) {
        const delta = evt.delta || evt.text || ''
        if (delta) {
          const { text, emit } = takeDelta(fullReasoning, delta)
          fullReasoning = text
          if (emit) handlers.onReasoning?.(emit)
        }
        continue
      }

      // Function call deltas
      if (type === 'response.function_call_arguments.delta' || type === 'response.output_item.delta') {
        // Try to extract function call info
        const item = evt.item || evt
        if (item?.type === 'function_call' || evt.delta) {
          const idx = evt.output_index ?? 0
          if (!toolAcc.has(idx)) {
            toolAcc.set(idx, {
              id: item.call_id || item.id || `toolu_${idx}`,
              name: item.name || '',
              arguments: '',
            })
          }
          const cur = toolAcc.get(idx)
          if (evt.delta) cur.arguments += evt.delta
          if (item.arguments) cur.arguments = item.arguments
          if (item.name) cur.name = item.name
          handlers.onToolDelta?.(idx, cur, { function: { name: cur.name, arguments: evt.delta || '' } })
        }
        continue
      }

      if (type === 'response.output_item.added') {
        const item = evt.item
        if (item?.type === 'function_call') {
          const idx = evt.output_index ?? toolAcc.size
          toolAcc.set(idx, {
            id: item.call_id || item.id || `toolu_${idx}`,
            name: item.name || '',
            arguments: item.arguments || '',
          })
          handlers.onToolDelta?.(idx, toolAcc.get(idx), { function: { name: item.name || '', arguments: item.arguments || '' } })
        }
        // reasoning items are handled via encrypted_content at done, not streamed
        continue
      }

      if (type === 'response.output_item.done') {
        const item = evt.item
        if (item?.type === 'function_call') {
          const idx = evt.output_index ?? 0
          const acc = toolAcc.get(idx)
          if (acc && item.arguments) acc.arguments = item.arguments
        }
        // Completed message with full content array
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === 'output_text' && c.text && !fullText.includes(c.text)) {
              // Full text already streamed via deltas; only emit if not yet emitted
              const { emit } = takeDelta(fullText, c.text)
              if (emit && fullText.length === 0) {
                fullText = c.text
                handlers.onText?.(c.text)
              }
            }
          }
        }
        continue
      }

      if (type === 'response.completed' || type === 'response.done') {
        // Check for incomplete due to max_output_tokens
        const resp = evt.response || evt
        if (resp.incomplete_details?.reason === 'max_output_tokens') {
          finishReason = 'max_tokens'
        }
        handlers.onFinish?.(finishReason)
        continue
      }

      if (type === 'response.incomplete') {
        finishReason = 'max_tokens'
        handlers.onFinish?.(finishReason)
        continue
      }

      if (type === 'response.failed' || type === 'response.error') {
        const msg = evt.error?.message || evt.response?.error?.message || 'response failed'
        handlers.onFinish?.('error')
        // Will be handled by outer error path
        continue
      }
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
    finishReason,
  }
}

module.exports = { readResponsesStream }
