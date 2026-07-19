/**
 * Vision routing for text-only main models (OpenCode Zen, Grok, Llama, etc.).
 *
 * Same idea as Maniac: describe attached images with a Groq (or compatible)
 * vision model, then inject the text descriptions into the user prompt so the
 * main coding model never receives image bytes.
 *
 * Env (any of these work — Maniac names accepted for shared .env):
 *   CLAUDE_CODE_VISION_API_KEY | MANIAC_VISION_API_KEY | GROQ_API_KEY
 *   CLAUDE_CODE_VISION_BASE_URL | MANIAC_VISION_BASE_URL
 *   CLAUDE_CODE_VISION_MODEL    | MANIAC_VISION_MODEL
 *   CLAUDE_CODE_VISION_ROUTE=1  — force routing even for unknown models
 *   CLAUDE_CODE_DISABLE_VISION_ROUTE=1 — never route
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import {
  findModelDescriptorForApiNameWithRoute,
  isVisionSupported,
} from './visionUtils.js'
import { getMainLoopModel } from './model/model.js'
import { resolveRouteIdFromBaseUrl } from '../integrations/index.js'

const VISION_BASE_URL =
  process.env.CLAUDE_CODE_VISION_BASE_URL ||
  process.env.MANIAC_VISION_BASE_URL ||
  'https://api.groq.com/openai/v1'

const VISION_MODEL =
  process.env.CLAUDE_CODE_VISION_MODEL ||
  process.env.MANIAC_VISION_MODEL ||
  'qwen/qwen3.6-27b'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

export function visionDescribeAvailable(): boolean {
  return !!(
    process.env.CLAUDE_CODE_VISION_API_KEY ||
    process.env.MANIAC_VISION_API_KEY ||
    process.env.GROQ_API_KEY
  )
}

function resolveVisionKey(): string {
  const key =
    process.env.CLAUDE_CODE_VISION_API_KEY ||
    process.env.MANIAC_VISION_API_KEY ||
    process.env.GROQ_API_KEY ||
    ''
  if (!key) {
    throw new Error(
      'Vision routing requires GROQ_API_KEY (or CLAUDE_CODE_VISION_API_KEY / MANIAC_VISION_API_KEY)',
    )
  }
  return key
}

/**
 * Route pasted images through a vision model when the main loop model
 * cannot see images (or is an unknown OpenAI-compat model — fail-open in
 * isVisionSupported would otherwise skip routing and blow up later).
 */
export function shouldRouteImagesThroughVisionDescribe(
  model?: string,
): boolean {
  if (!visionDescribeAvailable()) return false
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_VISION_ROUTE)) return false
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_VISION_ROUTE)) return false

  if (isEnvTruthy(process.env.CLAUDE_CODE_VISION_ROUTE)) return true

  const target = model ?? getMainLoopModel()
  const routeId =
    resolveRouteIdFromBaseUrl(process.env.OPENAI_BASE_URL) ?? undefined
  const descriptor = findModelDescriptorForApiNameWithRoute(target, routeId)

  if (descriptor?.capabilities?.supportsVision === true) return false
  if (descriptor?.capabilities?.supportsVision === false) return true

  // Unknown model: route for OpenAI-compat / third-party (Claudio's usual path).
  // Anthropic first-party without USE_OPENAI keeps native image blocks.
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_MISTRAL) ||
    isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB) ||
    !isVisionSupported(target, { routeId, baseUrl: process.env.OPENAI_BASE_URL })
  )
}

const DESCRIBE_PROMPT = `Voce eh um descritor de imagens para outro modelo de IA que NAO consegue ver imagens.
Descreva a imagem em detalhes exaustivos e objetivos, em portugues brasileiro:
- Se houver texto, codigo, logs ou mensagens de erro: TRANSCREVA tudo literalmente, preservando formatacao.
- Se for uma interface/screenshot: descreva layout, componentes, cores, estados e qualquer valor visivel.
- Se for um diagrama: descreva nos, conexoes e fluxo.
- Se for uma foto: descreva cena, objetos e contexto relevante.
Nao interprete nem responda a pergunta do usuario — apenas descreva o que a imagem contem.`

export type ImageDescription = {
  path: string
  description: string
}

export async function describeImage(
  imagePath: string,
  userText?: string,
): Promise<string> {
  const apiKey = resolveVisionKey()
  const stat = statSync(imagePath)
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB > 4MB): ${imagePath}`,
    )
  }

  const ext = extname(imagePath).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) throw new Error(`Unsupported image type "${ext}": ${imagePath}`)

  const b64 = readFileSync(imagePath).toString('base64')
  const userContext = userText?.trim()
    ? `Contexto da pergunta do usuario (para voce saber o que priorizar na descricao): "${userText.trim()}"`
    : 'Descreva a imagem.'

  const res = await fetch(`${VISION_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.2,
      max_tokens: 4096,
      reasoning_format: 'hidden',
      messages: [
        { role: 'system', content: DESCRIBE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: userContext },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  })

  if (!res.ok) {
    // Do not forward provider error bodies into the agent prompt (injection surface).
    throw new Error(`Vision model HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content || ''
  let description = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (description.startsWith('<think>')) description = ''
  if (!description) throw new Error('Vision model returned an empty description')
  return description
}

export async function describeImages(
  imagePaths: string[],
  userText?: string,
): Promise<ImageDescription[]> {
  const results: ImageDescription[] = []
  for (const p of imagePaths) {
    try {
      results.push({ path: p, description: await describeImage(p, userText) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      // Keep failure text short and free of provider response bodies.
      const safe =
        msg.startsWith('Vision model HTTP') ||
        msg.startsWith('Image too large') ||
        msg.startsWith('Unsupported image') ||
        msg.includes('Vision routing requires') ||
        msg.includes('empty description')
          ? msg
          : 'vision request failed'
      results.push({ path: p, description: `[falha ao ler imagem: ${safe}]` })
    }
  }
  return results
}

export function buildVisionAugmentedMessage(
  message: string,
  descriptions: ImageDescription[],
): string {
  if (descriptions.length === 0) return message
  const blocks = descriptions
    .map(
      (d, i) =>
        `[image${i + 1}] (${basename(d.path)}):\n${d.description}`,
    )
    .join('\n\n')
  return `${message}\n\n=== IMAGENS ANEXADAS (descritas pelo modelo de visao ${VISION_MODEL}) ===\nVoce nao ve as imagens diretamente; use as descricoes abaixo como se fossem as imagens.\n\n${blocks}\n=== FIM DAS IMAGENS ===`
}

export function getVisionModelLabel(): string {
  return VISION_MODEL
}

/** Persist a base64 image to a temp file so describeImage can read it. */
export function writeTempImageFromBase64(
  data: string,
  mediaType = 'image/png',
): string {
  // Rough pre-decode size guard (~4/3 base64 expansion).
  if (data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64) {
    throw new Error(
      `Image too large (base64 exceeds ~${MAX_IMAGE_BYTES / 1024 / 1024}MB limit)`,
    )
  }
  const buf = Buffer.from(data, 'base64')
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB > 4MB)`,
    )
  }
  const ext =
    mediaType === 'image/jpeg' || mediaType === 'image/jpg'
      ? '.jpg'
      : mediaType === 'image/webp'
        ? '.webp'
        : mediaType === 'image/gif'
          ? '.gif'
          : '.png'
  const dir = join(tmpdir(), 'claudio-vision')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  writeFileSync(file, buf)
  return file
}
