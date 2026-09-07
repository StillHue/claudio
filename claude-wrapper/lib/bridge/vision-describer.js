const { createHash } = require('crypto');
const { joinChatUrl } = require('./translate');

const visionCache = new Map();
const MAX_CACHE_SIZE = 100;

const DEFAULT_VISION_MODEL =
  process.env.CLAUDE_NATIVE_VISION_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

const VISION_SYSTEM_PROMPT =
  'Você é um especialista em visão computacional e OCR para desenvolvimento de software.\n' +
  'Analise a imagem enviada minuciosamente e forneça:\n' +
  '1. OCR Exato de todo texto, mensagens de erro, logs ou código visível (em blocos de código formatados);\n' +
  '2. Descrição detalhada da interface (UI), layout, formulários, botões, modais ou telas exibidas;\n' +
  '3. Se for um diagrama, fluxo ou arquitetura, descreva os nós, conexões e etapas em formato estruturado.\n' +
  'Seja direto, técnico e preciso.';

function getImageHash(imageUrl) {
  return createHash('sha256').update(String(imageUrl || '')).digest('hex');
}

async function describeImage(imageUrl, provider, ctx) {
  const hash = getImageHash(imageUrl);
  if (visionCache.has(hash)) {
    ctx.log?.('[vision] cache hit for image (' + hash.slice(0, 10) + ')');
    return visionCache.get(hash);
  }

  const visionModel = provider.visionModel || DEFAULT_VISION_MODEL;
  ctx.log?.('[vision] describing image via ' + visionModel + '...');

  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = 'Bearer ' + provider.apiKey;

  const requestBody = {
    model: visionModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_SYSTEM_PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ],
    max_tokens: 2048,
  };

  try {
    const upstream = await fetch(joinChatUrl(provider.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      ctx.log?.('[vision] upstream error ' + upstream.status + ': ' + errText.slice(0, 200));
      return '[Imagem anexada pelo usuário: não foi possível processar a descrição automática (status HTTP ' + upstream.status + ')]';
    }

    const data = await upstream.json();
    const description = data.choices?.[0]?.message?.content?.trim() || '[Imagem sem conteúdo detectável]';

    if (visionCache.size >= MAX_CACHE_SIZE) {
      const firstKey = visionCache.keys().next().value;
      visionCache.delete(firstKey);
    }
    visionCache.set(hash, description);

    ctx.log?.('[vision] successfully described image (' + description.length + ' chars)');
    return description;
  } catch (err) {
    ctx.log?.('[vision] failed to describe image: ' + err.message);
    return '[Imagem anexada pelo usuário: falha ao extrair descrição visual (' + err.message + ')]';
  }
}

function isOpenRouterProvider(provider) {
  if (!provider) return false
  if (provider.name === 'openrouter') return true
  const base = String(provider.baseUrl || '')
  return /openrouter\.ai/i.test(base)
}

function isVisionUpstreamModel(model) {
  return /vl|vision|omni/i.test(String(model || ''))
}

async function resolveVisionInMessages(messages, provider, ctx, upstreamModel) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let hasImage = false;
  for (const msg of messages) {
    if (Array.isArray(msg?.content)) {
      if (msg.content.some((part) => part && part.type === 'image_url')) {
        hasImage = true;
        break;
      }
    }
  }

  if (!hasImage) return messages;

  // OpenRouter Auto / NVIDIA VL must see real image_url parts.
  if (isOpenRouterProvider(provider) || isVisionUpstreamModel(upstreamModel)) {
    ctx.log?.('[vision] pass-through (images left intact for ' + (upstreamModel || provider?.name || 'provider') + ')')
    return messages
  }

  ctx.log?.('[vision] detected image(s) in conversation, resolving visual descriptions...');

  const resolved = [];
  for (const msg of messages) {
    if (!Array.isArray(msg?.content)) {
      resolved.push(msg);
      continue;
    }

    const newContent = [];
    for (const part of msg.content) {
      if (part && part.type === 'image_url' && part.image_url?.url) {
        const desc = await describeImage(part.image_url.url, provider, ctx);
        newContent.push({
          type: 'text',
          text: '\n[📷 Descrição Visual da Imagem / OCR Extraído]:\n' + desc + '\n',
        });
      } else {
        newContent.push(part);
      }
    }

    resolved.push({
      ...msg,
      content: newContent,
    });
  }

  return resolved;
}

module.exports = {
  describeImage,
  resolveVisionInMessages,
  DEFAULT_VISION_MODEL,
  isVisionUpstreamModel,
};
