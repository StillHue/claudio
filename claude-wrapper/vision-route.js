/**
 * Vision routing for text-only upstream models (OpenCode, Cohere, …).
 * Describes Anthropic image blocks via Groq (or compatible) chat/completions,
 * then replaces them with text so the main model never receives image bytes.
 *
 * Env:
 *   GROQ_API_KEY | CLAUDE_CODE_VISION_API_KEY | MANIAC_VISION_API_KEY
 *   CLAUDE_CODE_VISION_BASE_URL | MANIAC_VISION_BASE_URL
 *   CLAUDE_CODE_VISION_MODEL | MANIAC_VISION_MODEL
 *   CLAUDE_CODE_DISABLE_VISION_ROUTE=1 — skip routing
 *   CLAUDE_CODE_VISION_ROUTE=0 — skip routing
 */
const path = require('path')

const DEFAULT_BASE = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'qwen/qwen3.6-27b'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const DESCRIBE_PROMPT = `Voce eh um descritor de imagens para outro modelo de IA que NAO consegue ver imagens.
Descreva a imagem em detalhes exaustivos e objetivos, em portugues brasileiro:
- Se houver texto, codigo, logs ou mensagens de erro: TRANSCREVA tudo literalmente, preservando formatacao.
- Se for uma interface/screenshot: descreva layout, componentes, cores, estados e qualquer valor visivel.
- Se for um diagrama: descreva nos, conexoes e fluxo.
- Se for uma foto: descreva cena, objetos e contexto relevante.
Nao interprete nem responda a pergunta do usuario — apenas descreva o que a imagem contem.`

function visionKey() {
  return (
    process.env.CLAUDE_CODE_VISION_API_KEY ||
    process.env.MANIAC_VISION_API_KEY ||
    process.env.GROQ_API_KEY ||
    ''
  )
}

function visionAvailable() {
  return !!visionKey()
}

function visionEnabled() {
  if (!visionAvailable()) return false
  if (process.env.CLAUDE_CODE_DISABLE_VISION_ROUTE === '1') return false
  if (process.env.CLAUDE_CODE_VISION_ROUTE === '0') return false
  // Native bridge targets text-only providers by default — route when key present
  return true
}

function visionBaseUrl() {
  return (
    process.env.CLAUDE_CODE_VISION_BASE_URL ||
    process.env.MANIAC_VISION_BASE_URL ||
    DEFAULT_BASE
  ).replace(/\/$/, '')
}

function visionModel() {
  return (
    process.env.CLAUDE_CODE_VISION_MODEL ||
    process.env.MANIAC_VISION_MODEL ||
    DEFAULT_MODEL
  )
}

function collectUserText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && b.type === 'text' ? b.text || '' : ''))
    .filter(Boolean)
    .join('\n')
}

function messageHasImage(content) {
  if (!Array.isArray(content)) return false
  for (const b of content) {
    if (b && b.type === 'image') return true
    if (b && b.type === 'tool_result' && Array.isArray(b.content)) {
      if (b.content.some((c) => c && c.type === 'image')) return true
    }
  }
  return false
}

function bodyHasImages(body) {
  for (const msg of body.messages || []) {
    if (messageHasImage(msg?.content)) return true
  }
  return false
}

async function describeBase64Image(data, mediaType, userText) {
  const buf = Buffer.from(data, 'base64')
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB > 4MB)`,
    )
  }
  const mime = mediaType || 'image/png'
  const userContext = userText?.trim()
    ? `Contexto da pergunta do usuario (para voce saber o que priorizar na descricao): "${userText.trim().slice(0, 500)}"`
    : 'Descreva a imagem.'

  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = {
      model: visionModel(),
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: DESCRIBE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userContext },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${data}` },
            },
          ],
        },
      ],
    }
    // Groq-only: hide chain-of-thought in content. Mistral rejects unknown fields.
    if (/groq\.com/i.test(visionBaseUrl())) {
      body.reasoning_format = 'hidden'
    }

    const res = await fetch(`${visionBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${visionKey()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })

    if (res.status === 429 || res.status === 503) {
      lastErr = new Error(`Vision model HTTP ${res.status}`)
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
      continue
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(
        `Vision model HTTP ${res.status}${errText ? `: ${errText.slice(0, 240)}` : ''}`,
      )
    }

    const json = await res.json()
    const raw = json.choices?.[0]?.message?.content || ''
    let description = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (description.startsWith('<think>')) description = ''
    if (!description) throw new Error('Vision model returned an empty description')
    return description
  }
  throw lastErr || new Error('Vision model HTTP 429')
}

async function describeImageBlock(block, userText) {
  const src = block?.source
  if (!src) return '[falha ao ler imagem: missing source]'
  try {
    if (src.type === 'base64' && src.data) {
      return await describeBase64Image(src.data, src.media_type, userText)
    }
    // Refuse URL fetches — prevents SSRF via the local bridge (intranet/metadata).
    // Claude Code pastes images as base64; URL sources are not supported here.
    if (src.type === 'url' && src.url) {
      return '[falha ao ler imagem: url sources disabled (SSRF guard); paste/attach as base64]'
    }
    return '[falha ao ler imagem: unsupported source]'
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'vision request failed'
    const safe =
      msg.startsWith('Vision model HTTP') ||
      msg.startsWith('Image too large') ||
      msg.includes('empty description')
        ? msg
        : 'vision request failed'
    return `[falha ao ler imagem: ${safe}]`
  }
}

function wrapDescription(index, description) {
  return (
    `[image${index}] (descrita via ${visionModel()}):\n${description}`
  )
}

/**
 * Mutate Anthropic Messages body in-place: replace image blocks with text.
 * Returns { routed, count }.
 */
async function routeImagesInBody(body, log = () => {}) {
  if (!visionEnabled() || !bodyHasImages(body)) {
    return { routed: false, count: 0 }
  }

  let count = 0
  let imageIndex = 0

  for (const msg of body.messages || []) {
    if (!msg || !Array.isArray(msg.content)) continue
    const userText = collectUserText(msg.content)
    const next = []
    let replacedHere = 0

    for (const block of msg.content) {
      if (!block) continue

      if (block.type === 'image') {
        imageIndex += 1
        count += 1
        replacedHere += 1
        const desc = await describeImageBlock(block, userText)
        next.push({ type: 'text', text: wrapDescription(imageIndex, desc) })
        continue
      }

      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        const inner = []
        for (const c of block.content) {
          if (c && c.type === 'image') {
            imageIndex += 1
            count += 1
            replacedHere += 1
            const desc = await describeImageBlock(c, userText)
            inner.push({ type: 'text', text: wrapDescription(imageIndex, desc) })
          } else {
            inner.push(c)
          }
        }
        next.push({ ...block, content: inner })
        continue
      }

      next.push(block)
    }

    if (replacedHere > 0) {
      next.push({
        type: 'text',
        text:
          `\n=== IMAGENS ANEXADAS (descritas pelo modelo de visao ${visionModel()}) ===\n` +
          `Voce nao ve as imagens diretamente; use as descricoes acima como se fossem as imagens.\n` +
          `=== FIM DAS IMAGENS ===`,
      })
    }

    msg.content = next
  }

  log(`vision route: described ${count} image(s) via ${visionModel()}`)
  return { routed: count > 0, count }
}

module.exports = {
  visionAvailable,
  visionEnabled,
  visionModel,
  bodyHasImages,
  routeImagesInBody,
}
