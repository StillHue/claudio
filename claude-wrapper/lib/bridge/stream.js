/**
 * OpenAI Chat Completions SSE reader.
 * Normalizes cumulative vs incremental content streams and accumulates
 * tool_call deltas.
 */
const { randomUUID } = require('crypto')
const { extractReasoning } = require('./translate')

async function readOpenAIStream(body, handlers) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let fullText = ''
  let fullReasoning = ''
  let streamMode = null
  const recentChunks = new Set()
  const MAX_RECENT_CHUNKS = 10
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
        const chunk = delta.content
        if (!fullText) {
          fullText = chunk
          handlers.onText?.(chunk)
        } else if (streamMode === 'cumulative') {
          if (chunk.length > fullText.length && chunk.startsWith(fullText)) {
            const inc = chunk.slice(fullText.length)
            fullText = chunk
            if (inc) handlers.onText?.(inc)
          } else {
            streamMode = 'incremental'
            fullText += chunk
            handlers.onText?.(chunk)
          }
        } else if (streamMode === 'incremental') {
          // Normalize whitespace for comparison to catch duplicated chunks
          const normalizedChunk = chunk.replace(/\s+/g, ' ').trim()
          if (!recentChunks.has(normalizedChunk)) {
            recentChunks.add(normalizedChunk)
            if (recentChunks.size > MAX_RECENT_CHUNKS) {
              const first = recentChunks.values().next().value
              recentChunks.delete(first)
            }
            // Incremental: each chunk is a new delta — accumulate, never replace.
            fullText += chunk
            handlers.onText?.(chunk)
          }
        } else {
          const looksCumulative =
            chunk.length > fullText.length &&
            chunk.startsWith(fullText) &&
            chunk.length >= fullText.length * 2
          if (looksCumulative) {
            streamMode = 'cumulative'
            const inc = chunk.slice(fullText.length)
            fullText = chunk
            if (inc) handlers.onText?.(inc)
          } else {
            streamMode = 'incremental'
            fullText += chunk
            handlers.onText?.(chunk)
          }
        }
      }
      const reasoningDelta = extractReasoning(delta)
      if (reasoningDelta) {
        fullReasoning += reasoningDelta
        handlers.onReasoning?.(reasoningDelta)
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

module.exports = { readOpenAIStream }
