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

function imagePartFromSource(source) {
  if (!source || source.type !== 'base64' || !source.data) return null
  return {
    type: 'image_url',
    image_url: {
      url: `data:${source.media_type || 'image/png'};base64,${source.data}`,
    },
  }
}

/** Flatten tool_result content: string for role=tool + optional image parts for a follow-up user msg. */
function flattenToolResultContent(content) {
  const images = []
  if (typeof content === 'string') {
    return { text: content, images }
  }
  if (!Array.isArray(content)) {
    return { text: JSON.stringify(content ?? ''), images }
  }
  const texts = []
  for (const c of content) {
    if (!c) continue
    if (typeof c === 'string') {
      texts.push(c)
      continue
    }
    if (c.type === 'text' && c.text) {
      texts.push(c.text)
      continue
    }
    if (c.type === 'image') {
      const part = imagePartFromSource(c.source)
      if (part) {
        images.push(part)
        texts.push('[image from tool — see following user message]')
      } else {
        texts.push('[image omitted: non-base64 source]')
      }
      continue
    }
    texts.push(typeof c.text === 'string' ? c.text : JSON.stringify(c))
  }
  return { text: texts.join('\n'), images }
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
      // Preserve empty string (not null) so history never becomes invalid for MiMo.
      if (role === 'assistant' && !content) continue
      out.push({ role, content })
      continue
    }
    if (!Array.isArray(content)) {
      const text = String(content ?? '')
      if (role === 'assistant' && !text) continue
      out.push({ role, content: text })
      continue
    }

    if (role === 'assistant') {
      const textParts = []
      const thinkingParts = []
      const toolCalls = []
      for (const block of content) {
        if (!block) continue
        if (block.type === 'text' && block.text) textParts.push(block.text)
        if (block.type === 'thinking' && block.thinking) thinkingParts.push(block.thinking)
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
      const text = textParts.join('\n')
      const reasoning = thinkingParts.join('\n')
      if (!text && !reasoning && !toolCalls.length) continue

      // content:null is only valid when tool_calls are present.
      const assistant = {
        role: 'assistant',
        content: text || (toolCalls.length ? null : ''),
      }
      if (reasoning) assistant.reasoning_content = reasoning
      if (toolCalls.length) assistant.tool_calls = toolCalls
      out.push(assistant)
      continue
    }

    // user — may mix text + tool_result (+ images)
    const toolResults = content.filter((b) => b && b.type === 'tool_result')
    const other = content.filter((b) => b && b.type !== 'tool_result')
    const pendingImages = []

    for (const tr of toolResults) {
      const toolCallId = tr.tool_use_id || tr.id || ''
      if (!toolCallId) continue
      const flat = flattenToolResultContent(tr.content)
      for (const img of flat.images) pendingImages.push(img)
      out.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: flat.text || '[empty tool result]',
      })
    }

    if (pendingImages.length) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Images returned by tools:' },
          ...pendingImages,
        ],
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

/** Models whose OpenAI-compatible endpoint accepts image_url content directly. */
function supportsDirectVision(upstreamModel) {
  return String(upstreamModel || '').toLowerCase() === 'mimo-v2.5-free'
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

/**
 * Prefer a single visible paragraph when the model mirrors reasoning into content
 * or prefixes the answer with the full reasoning string.
 */
function visibleTextAgainstReasoning(reasoning, text) {
  const r = String(reasoning || '')
  const t = String(text || '')
  if (!t) return ''
  if (!r) return t
  if (t === r) return t
  if (t.startsWith(r)) {
    const rest = t.slice(r.length).replace(/^\s+/, '')
    return rest || t
  }
  return t
}

function finishReasonToStop(reason, hasTools) {
  if (hasTools || reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  return 'end_turn'
}

/** Count image_url parts + rough JSON size for request diagnostics. */
function requestShapeStats(messages, tools) {
  let images = 0
  let toolMsgs = 0
  for (const m of messages || []) {
    if (m?.role === 'tool') toolMsgs += 1
    if (Array.isArray(m?.content)) {
      for (const p of m.content) {
        if (p?.type === 'image_url') images += 1
      }
    }
  }
  return {
    msgs: (messages || []).length,
    tools: tools?.length || 0,
    toolMsgs,
    images,
  }
}

module.exports = {
  systemToText,
  contentBlockToText,
  anthropicToOpenAIMessages,
  anthropicToolsToOpenAI,
  mapToolChoice,
  extractReasoning,
  extractMessageText,
  visibleTextAgainstReasoning,
  finishReasonToStop,
  joinChatUrl,
  maxOutputTokensCap,
  mapModel,
  supportsDirectVision,
  requestShapeStats,
  flattenToolResultContent,
}
