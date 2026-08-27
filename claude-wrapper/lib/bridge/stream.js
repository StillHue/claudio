/**
 * OpenAI Chat Completions SSE reader.
 * Normalizes cumulative vs incremental content streams and accumulates
 * tool_call deltas.
 *
 * IMPORTANT: never dedupe short token deltas (e.g. "o", "e", "**").
 * A recentChunks Set used to drop repeated 1–2 char pieces and produced
 * "letra comida" + unmatched `**` in the Claude Code UI.
 */
const { randomUUID } = require('crypto')
const { extractReasoning } = require('./translate')
const { takeDelta } = require('./delta')

async function readOpenAIStream(body, handlers) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let fullText = ''
  let fullReasoning = ''
  /** @type {Map<number, { id: string, name: string, arguments: string }>} */
  const toolAcc = new Map()

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
      if (data === '[DONE]') continue
      let jsonChunk
      try {
        jsonChunk = JSON.parse(data)
      } catch {
        continue
      }
      const choice = jsonChunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}

      if (delta.content) {
        const { text, emit } = takeDelta(fullText, delta.content)
        fullText = text
        if (emit) handlers.onText?.(emit)
      }
      const reasoningDelta = extractReasoning(delta)
      if (reasoningDelta) {
        const { text, emit } = takeDelta(fullReasoning, reasoningDelta)
        fullReasoning = text
        if (emit) handlers.onReasoning?.(emit)
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolAcc.has(idx)) {
            toolAcc.set(idx, {
              id: tc.id || `toolu_${randomUUID().slice(0, 10)}`,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            })
          } else {
            const cur = toolAcc.get(idx)
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.arguments += tc.function.arguments
          }
          handlers.onToolDelta?.(idx, toolAcc.get(idx), tc)
        }
      }
      if (choice.finish_reason) handlers.onFinish?.(choice.finish_reason)
    }
  }

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v),
  }
}

module.exports = { readOpenAIStream, takeDelta }
