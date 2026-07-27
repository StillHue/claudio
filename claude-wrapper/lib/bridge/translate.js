/**
 * Anthropic Messages ↔ OpenAI Chat Completions translation helpers.
 */
const { randomUUID } = require('crypto')

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
  if (block.type === 'image' && block.source) {
    // Prefer base64 only — never instruct upstream to fetch arbitrary URLs (SSRF)
    if (block.source.type === 'base64' && block.source.data) {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}`,
        },
      }
    }
    return '[image omitted: non-base64 source]'
  }
  return ''
}

/** Anthropic messages → OpenAI chat messages (incl. tool_use / tool_result). */
function anthropicToOpenAIMessages(body) {
  const out = []
  const sys = systemToText(body.system)
  if (sys.trim()) out.push({ role: 'system', content: sys })

  for (const msg of body.messages || []) {
    if (!msg) continue
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    const content = msg.content

    if (typeof content === 'string') {
      out.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) {
      out.push({ role, content: String(content ?? '') })
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
            id: block.id || `toolu_${randomUUID().slice(0, 8)}`,
            type: 'function',
            function: {
              name: block.name || 'unknown',
              arguments:
                typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input ?? {}),
            },
          })
        }
      }
      const assistant = { role: 'assistant', content: textParts.join('\n') || null }
      if (toolCalls.length) assistant.tool_calls = toolCalls
      out.push(assistant)
      continue
    }

    // user — may mix text + tool_result (+ images)
    const toolResults = content.filter((b) => b && b.type === 'tool_result')
    const other = content.filter((b) => b && b.type !== 'tool_result')

    for (const tr of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: tr.tool_use_id || tr.id || '',
        content:
          typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map((c) => (typeof c === 'string' ? c : c?.text || JSON.stringify(c))).join('\n')
              : JSON.stringify(tr.content ?? ''),
      })
    }

    if (other.length) {
      const parts = other.map(contentBlockToText).filter((p) => p !== '' && p != null)
      const hasVision = parts.some((p) => typeof p === 'object')
      if (hasVision) {
        const openaiParts = []
        for (const p of parts) {
          if (typeof p === 'string') openaiParts.push({ type: 'text', text: p })
          else openaiParts.push(p)
        }
        out.push({ role: 'user', content: openaiParts })
      } else {
        const text = parts.map(String).join('\n').trim()
        if (text) out.push({ role: 'user', content: text })
      }
    }
  }

  return out
}

function anthropicToolsToOpenAI(tools) {
  if (!Array.isArray(tools) || !tools.length) return undefined
  return tools
    .filter((t) => t && t.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || t.parameters || { type: 'object', properties: {} },
      },
    }))
}

function mapToolChoice(choice) {
  if (!choice || choice === 'auto') return 'auto'
  if (choice === 'any' || choice === 'required') return 'required'
  if (choice === 'none') return 'none'
  if (typeof choice === 'object' && choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } }
  }
  return 'auto'
}

function joinChatUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/$/, '')
  if (b.endsWith('/chat/completions')) return b
  if (b.endsWith('/v1')) return `${b}/chat/completions`
  return `${b}/chat/completions`
}

/**
 * Max completion tokens the upstream will accept.
 * Claude Code often asks for 32k; Mistral Medium/Devstral/Codestral hard-cap at 8192.
 * OpenCode Zen and most OpenAI-compat hosts still allow much higher.
 */
function maxOutputTokensCap(provider, upstreamModel) {
  const name = String(provider?.name || '').toLowerCase()
  const base = String(provider?.baseUrl || '').toLowerCase()
  const model = String(upstreamModel || '').toLowerCase()
  const envCap = Number(process.env.CLAUDE_NATIVE_MAX_OUTPUT_TOKENS || 0)
  if (envCap > 0) return envCap

  if (
    name === 'mistral' ||
    name.startsWith('mistral') ||
    base.includes('mistral.ai') ||
    /^(mistral-|codestral|devstral|magistral|ministral)/.test(model)
  ) {
    return 8192
  }
  // Cohere compatibility endpoint is also conservative on several SKUs
  if (name === 'cohere' || base.includes('cohere.com')) {
    return 8192
  }
  // OpenCode Zen / Alibaba / Groq-style: keep room for reasoning + tools
  return 32000
}

function mapModel(requested, provider) {
  // resolveProvider already picked the upstream model id
  if (provider?.model) return provider.model
  return requested || 'deepseek-v4-flash-free'
}

function extractReasoning(msgOrDelta) {
  if (!msgOrDelta || typeof msgOrDelta !== 'object') return ''
  if (typeof msgOrDelta.reasoning === 'string' && msgOrDelta.reasoning) return msgOrDelta.reasoning
  if (typeof msgOrDelta.reasoning_content === 'string' && msgOrDelta.reasoning_content) {
    return msgOrDelta.reasoning_content
  }
  const details = msgOrDelta.reasoning_details
  if (Array.isArray(details)) {
    return details
      .map((d) => (typeof d?.text === 'string' ? d.text : typeof d?.content === 'string' ? d.content : ''))
      .filter(Boolean)
      .join('')
  }
  return ''
}

function extractMessageText(msg) {
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function finishReasonToStop(reason, hasTools) {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

module.exports = {
  systemToText,
  contentBlockToText,
  anthropicToOpenAIMessages,
  anthropicToolsToOpenAI,
  mapToolChoice,
  extractReasoning,
  extractMessageText,
  finishReasonToStop,
  joinChatUrl,
  maxOutputTokensCap,
  mapModel,
}
