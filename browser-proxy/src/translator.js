/**
 * Translate Anthropic Messages request ↔ Claudio print/stream.
 */

function contentToText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  const parts = []
  for (const block of content) {
    if (!block) continue
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (block.type === 'text' && block.text) parts.push(block.text)
    else if (block.type === 'tool_result') {
      const inner = contentToText(block.content)
      parts.push(`[tool_result ${block.tool_use_id || ''}]\n${inner}`)
    } else if (block.type === 'tool_use') {
      parts.push(`[tool_use ${block.name}]\n${JSON.stringify(block.input ?? {})}`)
    } else if (block.type === 'image') {
      parts.push('[image omitted]')
    }
  }
  return parts.join('\n')
}

function systemToText(system) {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map(b => (typeof b === 'string' ? b : b?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return String(system)
}

/**
 * Build a single user prompt for `claudio -p` from Messages body.
 * v1: flatten turns; strip browser-tool noise for chat-first.
 */
export function messagesToPrompt(body) {
  const lines = []
  const sys = systemToText(body.system)
  if (sys) {
    lines.push('## System context (from browser extension)')
    lines.push(sys.slice(0, 12_000))
    lines.push('')
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const msg of messages) {
    const role = msg.role || 'user'
    const text = contentToText(msg.content).trim()
    if (!text) continue
    lines.push(`## ${role}`)
    lines.push(text)
    lines.push('')
  }

  lines.push(
    '## Instruction',
    'Reply as Claude in the browser sidebar. Plain helpful text only.',
    'Do not call tools or emit tool_use XML. Keep the answer concise unless asked otherwise.',
  )
  return lines.join('\n')
}

export function shouldInterceptPath(pathname, interceptPaths) {
  const pathOnly = String(pathname || '').split('?')[0]
  return (interceptPaths || []).some(p => pathOnly === p || pathOnly.startsWith(p + '/'))
}

/**
 * Parse Claudio `--output-format stream-json` lines; yield text chunks.
 */
export function extractTextFromStreamJsonLine(line) {
  const raw = String(line || '').trim()
  if (!raw.startsWith('{')) return null
  let obj
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }

  // Partial message chunks (--include-partial-messages)
  if (obj.type === 'stream_event' && obj.event) {
    const ev = obj.event
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      return ev.delta.text || ''
    }
    if (ev.type === 'content_block_delta' && typeof ev.delta?.text === 'string') {
      return ev.delta.text
    }
  }

  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
    return obj.delta.text || ''
  }

  if (obj.type === 'assistant' && obj.message?.content) {
    return contentToText(obj.message.content)
  }

  if (obj.type === 'result' && typeof obj.result === 'string') {
    return obj.result
  }

  return null
}
