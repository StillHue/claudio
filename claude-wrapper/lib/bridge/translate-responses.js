/**
 * Anthropic Messages ↔ OpenAI Responses API translation helpers.
 *
 * The Responses API uses `input` (string | array of items) instead of
 * `messages`, and returns `output: [{type:"message"|"reasoning", ...}]`.
 * This module converts Anthropic's format to/from Responses.
 */

function systemToText(system) {
  if (system == null) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === 'string' ? b : b?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return String(system)
}

function contentBlockToText(block) {
  if (block == null) return ''
  if (typeof block === 'string') return block
  if (block.type === 'text') return block.text || ''
  if (block.type === 'tool_result') {
    const c = block.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map(contentBlockToText).join('\n')
    return JSON.stringify(c ?? '')
  }
  return ''
}

/**
 * Convert Anthropic messages body → Responses API `input`.
 * Returns a string (simple) or array of {role, content} items.
 * For tool-heavy turns we keep array form.
 */
function anthropicToResponsesInput(body) {
  const sys = systemToText(body.system)
  const items = []

  // System as developer instruction prefix (Responses uses `instructions`)
  // We return it separately so caller can set `instructions` field.
  // But also handle it here as first input item if no instructions field used.
  void sys

  for (const msg of body.messages || []) {
    if (!msg) continue
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    const content = msg.content

    if (typeof content === 'string') {
      if (role === 'assistant' && !content) continue
      items.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) {
      const text = String(content ?? '')
      if (role === 'assistant' && !text) continue
      items.push({ role, content: text })
      continue
    }

    if (role === 'assistant') {
      const textParts = []
      const toolCalls = []
      for (const block of content) {
        if (!block) continue
        if (block.type === 'text' && block.text) textParts.push(block.text)
        if (block.type === 'tool_use') {
          toolCalls.push({
            type: 'function_call',
            call_id: block.id || '',
            name: block.name || 'unknown',
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          })
        }
      }
      const text = textParts.join('\n')
      if (text) items.push({ role: 'assistant', content: text })
      for (const tc of toolCalls) items.push(tc)
      continue
    }

    // user — may contain text + tool_result + images
    const toolResults = content.filter((b) => b && b.type === 'tool_result')
    const other = content.filter((b) => b && b.type !== 'tool_result')

    for (const tr of toolResults) {
      const callId = tr.tool_use_id || tr.id || ''
      if (!callId) continue
      const flat = typeof tr.content === 'string' ? tr.content : Array.isArray(tr.content) ? tr.content.map(contentBlockToText).join('\n') : JSON.stringify(tr.content ?? '')
      items.push({
        type: 'function_call_output',
        call_id: callId,
        output: flat || '[empty tool result]',
      })
    }

    if (other.length) {
      const texts = other.map(contentBlockToText).filter(Boolean)
      // Filter out image_url objects — Responses API handles them differently
      const textOnly = texts.filter((p) => typeof p === 'string')
      if (textOnly.length) {
        const text = textOnly.map(String).join('\n').trim()
        if (text) items.push({ role: 'user', content: text })
      }
      // Image parts as input_image items (if any)
      for (const p of texts) {
        if (typeof p === 'object' && p?.type === 'image_url') {
          items.push({
            role: 'user',
            content: [{ type: 'input_image', image_url: p.image_url.url }],
          })
        }
      }
    }
  }

  return { items, instructions: sys }
}

function anthropicToolsToResponses(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined
  return tools
    .filter((t) => t && t.name)
    .map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
    }))
}

function joinResponsesUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/$/, '')
  if (b.endsWith('/responses')) return b
  if (b.endsWith('/v1')) return `${b}/responses`
  return `${b}/responses`
}

function joinChatUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (b.endsWith('/v1')) return `${b}/chat/completions`
  return `${b}/chat/completions`
}

module.exports = {
  systemToText,
  anthropicToResponsesInput,
  anthropicToolsToResponses,
  joinResponsesUrl,
  joinChatUrl,
}
