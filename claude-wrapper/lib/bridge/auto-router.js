/**
 * Provider-agnostic Auto router.
 * Picks among the active provider's catalog (like Cursor Auto), using
 * heuristics for vision / hard / coding / fast. Cascade stays within that
 * provider's models (upgrade quality on failure — never invent another vendor).
 */
const { resolveProvider, resolveApiKey, loadProvidersConfig } = require('../provider/resolve')
const { loadNativeEnvFiles } = require('../wrapper/env')

loadNativeEnvFiles()

function isAutoModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return (
    lower === 'auto' ||
    lower === 'anthropic.auto' ||
    lower === 'claude-auto' ||
    lower === 'auto-router' ||
    lower === 'openrouter/auto' ||
    lower === 'openrouter/auto-beta' ||
    lower === 'anthropic.openrouter.openrouter-auto' ||
    lower === 'anthropic.openrouter.auto' ||
    lower === 'anthropic.openrouter.auto-beta' ||
    lower.endsWith('.auto') ||
    lower.endsWith('.openrouter-auto')
  )
}

function isOpenRouterModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return lower.startsWith('openrouter/')
}

function isVisionModel(modelName) {
  return /vl|vision|omni|llava|pixtral|gemini-.*flash|gpt-4o/i.test(String(modelName || ''))
}

function partLooksLikeImage(part) {
  if (!part || typeof part !== 'object') return false
  if (part.type === 'image' || part.type === 'image_url') return true
  if (part.source?.type === 'base64' || part.source?.media_type) return true
  return false
}

function bodyHasImages(body) {
  const messages = body?.messages
  if (!Array.isArray(messages)) return false
  for (const msg of messages) {
    const content = msg?.content
    if (Array.isArray(content) && content.some(partLooksLikeImage)) return true
  }
  return false
}

function extractUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const chunks = []
  for (let i = messages.length - 1; i >= 0 && chunks.length < 3; i--) {
    const msg = messages[i]
    if (msg?.role !== 'user') continue
    const content = msg.content
    if (typeof content === 'string') {
      chunks.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part === 'string') chunks.push(part)
      else if (part?.type === 'text' && part.text) chunks.push(String(part.text))
    }
  }
  return chunks.join('\n')
}

/**
 * Heuristic tier: vision | hard | coding | fast
 */
function classifyTier(body) {
  if (bodyHasImages(body)) return 'vision'

  const text = extractUserText(body)
  const tools = Array.isArray(body?.tools) ? body.tools.length : 0
  const lower = text.toLowerCase()
  const trimmed = text.trim()

  const hardHints =
    /architect|refactor|migra|debug\b|root.?cause|raciocin|analis[ae]|complex|design system|trade.?off|investigate|deep.?dive|ultra\b|codebase|reposit[oó]rio|\brepo\b|claude\.md|explor[ae]|arquitet|estrutura do projeto|mapear o (projeto|repo)/
  if (hardHints.test(lower) || text.length > 4000) return 'hard'

  if (tools > 0) return 'coding'

  const chitchat =
    /^(oi+|ol[aá]|hey+|hi+|hello|obrigad[oa]|thanks|thank you|valeu|ok+|okay|tudo bem\??|bom dia|boa tarde|boa noite|tmj|vlw)[\s!.?😂🙏]*$/i
  if (chitchat.test(trimmed)) return 'fast'

  return 'coding'
}

/**
 * Score a model id for role affinity (provider-agnostic naming heuristics).
 */
function scoreModelRoles(modelId) {
  const m = String(modelId || '').toLowerCase()
  const vision = isVisionModel(m) ? 3 : 0

  let hard = 0
  if (/ultra|opus|405b|670b|480b|550b|r1\b|o1\b|o3\b|gpt-4\.1(?!-mini)|claude-4|sonnet-4|max\b|pro(?!-mini)|command-a|deepseek-v3|big-pickle/.test(m)) {
    hard = 3
  } else if (/120b|70b|72b|123b/.test(m)) {
    hard = 2
  }

  let coding = 0
  if (/super|coder|sonnet|gpt-4o(?!-mini)|large|32b|qwen2\.5-coder|devstral|codestral|muse-spark|mimo/.test(m)) {
    coding = 3
  } else if (/120b|70b|instruct/.test(m)) {
    coding = 2
  } else if (!vision) {
    coding = 1
  }

  let fast = 0
  if (/lightning|flash|mini|nano(?!-omni)|haiku|lite|small|8b|7b|3\.5|hy3|laguna|gpt-4o-mini/.test(m)) {
    fast = 3
  } else if (/30b|20b|12b/.test(m) && !/ultra|super/.test(m)) {
    fast = 2
  }

  // Overall quality for cascade ordering (higher = stronger).
  const quality = hard * 100 + coding * 10 + (vision ? 5 : 0) - fast
  return { id: modelId, vision, hard, coding, fast, quality }
}

function listProviderModels(entry) {
  if (!entry) return []
  const models = Array.isArray(entry.models) && entry.models.length
    ? entry.models.slice()
    : entry.model
      ? [entry.model]
      : []
  // Exclude meta Auto / openrouter auto from the pool when we are selecting concretely.
  return models.filter((m) => m && !isAutoModel(m) && m !== 'openrouter/auto' && m !== 'openrouter/auto-beta')
}

function pickBest(scored, role) {
  if (!scored.length) return null
  const sorted = scored.slice().sort((a, b) => {
    const da = a[role] || 0
    const db = b[role] || 0
    if (db !== da) return db - da
    return b.quality - a.quality
  })
  // Prefer models that actually match the role when any do.
  const matched = sorted.filter((s) => (s[role] || 0) > 0)
  return (matched[0] || sorted[0]).id
}

/**
 * Map catalog → role slots. Env overrides still work when set.
 */
function rolesFromCatalog(models, envPrefix = 'AUTO') {
  const scored = models.map(scoreModelRoles)
  const env = (role, fallback) => {
    const key = `${envPrefix}_${role.toUpperCase()}_MODEL`
    return process.env[key] || process.env[`NVIDIA_AUTO_${role.toUpperCase()}_MODEL`] || fallback
  }

  const hard = env('hard', pickBest(scored, 'hard'))
  const coding = env('coding', pickBest(scored, 'coding') || hard)
  const fast = env('fast', pickBest(scored, 'fast') || coding)
  const vision = env('vision', pickBest(scored, 'vision') || coding)
  const light = env('light', pickBest(scored, 'fast') || fast)

  return { vision, fast, coding, hard, light, scored }
}

function modelForTier(tier, roles) {
  switch (tier) {
    case 'vision':
      return roles.vision
    case 'hard':
      return roles.hard
    case 'fast':
      return roles.fast
    case 'light':
      return roles.light
    case 'coding':
      return roles.coding
    default: {
      const _exhaustive = tier
      void _exhaustive
      return roles.coding
    }
  }
}

function uniqModels(list) {
  const out = []
  const seen = new Set()
  for (const m of list) {
    if (!m || seen.has(m)) continue
    seen.add(m)
    out.push(m)
  }
  return out
}

/**
 * Build quality-preserving cascade within the provider catalog.
 * Coding/hard: stronger models first, peer as fallback (no jumping to a weak flash).
 */
function buildFallbackCascade(tier, roles) {
  const byQuality = (roles.scored || [])
    .slice()
    .sort((a, b) => b.quality - a.quality)
    .map((s) => s.id)

  const primary = modelForTier(tier, roles)

  if (tier === 'vision') {
    return uniqModels([primary, roles.coding, roles.hard, ...byQuality])
  }
  if (tier === 'fast') {
    return uniqModels([primary, roles.coding, roles.hard, ...byQuality])
  }
  if (tier === 'hard') {
    return uniqModels([primary, roles.coding, ...byQuality])
  }
  // coding (default): coding → hard (upgrade), then other catalog models by quality
  return uniqModels([primary, roles.hard, ...byQuality])
}

function shouldRetryUpstream(status, err) {
  if (err) {
    const name = err?.name || ''
    const msg = String(err?.message || err)
    return name === 'TimeoutError' || /aborted|timeout|econnreset|fetch failed/i.test(msg)
  }
  return status === 429 || status === 503 || status === 502 || status === 504 || status === 410
}

function getActiveProviderEntry(data) {
  const active = data?.active
  const providers = data?.providers || {}
  if (active && providers[active]) return { name: active, entry: providers[active] }
  const names = Object.keys(providers)
  if (names.length === 1) return { name: names[0], entry: providers[names[0]] }
  // Prefer any provider that has an API key configured.
  for (const name of names) {
    if (resolveApiKey(providers[name])) return { name, entry: providers[name] }
  }
  return { name: active || names[0] || null, entry: active ? providers[active] : providers[names[0]] }
}

/**
 * OpenRouter catalog that only lists openrouter/auto → use OpenRouter Auto Router upstream.
 */
function shouldUseOpenRouterAuto(name, entry, catalog) {
  if (name !== 'openrouter') return false
  if (isOpenRouterModel(entry?.model) && /auto/.test(String(entry.model))) return true
  if (!catalog.length && /auto/.test(String(entry?.model || ''))) return true
  return false
}

function buildOpenRouterPlugins(modelName) {
  const model = String(modelName || 'openrouter/auto')
  const plugin = {
    id: model.includes('beta') ? 'auto-beta-router' : 'auto-router',
  }
  const cost = (process.env.OPENROUTER_COST_TIER || process.env.AUTO_ROUTER_COST_TIER || '')
    .toLowerCase()
    .trim()
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(cost)) plugin.cost_tier = cost
  const allowed = (process.env.OPENROUTER_ALLOWED_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.length) plugin.allowed_models = allowed
  return [plugin]
}

function routeAutoModel(body, providersData, ctx) {
  const data = providersData || loadProvidersConfig().data
  const { name, entry } = getActiveProviderEntry(data)
  if (!name || !entry) {
    throw new Error('No provider configured in providers.json — run first-run setup or set a provider')
  }

  const apiKey = resolveApiKey(entry)
  if (!apiKey) {
    const envName = entry.apiKeyEnv || 'API key'
    throw new Error(`${envName} is not configured — set it in the wrapper .env or ~/.claude-native/.env`)
  }

  const catalog = listProviderModels(entry)

  // Special case: OpenRouter Auto as the only/default model → pass through.
  if (shouldUseOpenRouterAuto(name, entry, catalog)) {
    const upstreamModel = entry.model?.includes('beta') ? 'openrouter/auto-beta' : 'openrouter/auto'
    const resolved = resolveProvider(data, upstreamModel)
    const provider = {
      ...resolved,
      name: 'openrouter',
      baseUrl: entry.baseUrl || resolved.baseUrl,
      apiKey,
      format: entry.format || 'chat',
    }
    const openRouterPlugins = buildOpenRouterPlugins(upstreamModel)
    ctx?.log?.(`[auto-router] openrouter passthrough model=${upstreamModel}`)
    return {
      provider,
      upstreamModel,
      upstreamFormat: provider.format || 'chat',
      tier: 'openrouter',
      fallbackCascade: [upstreamModel],
      openRouterPlugins,
    }
  }

  if (!catalog.length) {
    throw new Error(
      `Provider "${name}" has no models in providers.json — add a models[] list for Auto routing`,
    )
  }

  const roles = rolesFromCatalog(catalog)
  const tier = classifyTier(body)
  const cascade = buildFallbackCascade(tier, roles)
  const upstreamModel = cascade[0]

  const resolved = resolveProvider(data, upstreamModel)
  const provider = {
    ...resolved,
    name,
    baseUrl: entry.baseUrl || resolved.baseUrl,
    apiKey,
    format: entry.format || resolved.format || 'chat',
    visionModel: entry.visionModel || roles.vision,
  }

  ctx?.log?.(
    `[auto-router] provider=${name} tier=${tier} model=${upstreamModel} cascade=${cascade.join(' → ')}`,
  )

  return {
    provider,
    upstreamModel,
    upstreamFormat: provider.format || 'chat',
    tier,
    fallbackCascade: cascade,
    openRouterPlugins: [],
  }
}

async function routeAutoModelAsync(body, providersData, ctx) {
  return routeAutoModel(body, providersData, ctx)
}

/** @deprecated kept for call-site compatibility */
function buildAutoRouterPlugins(modelName) {
  return buildOpenRouterPlugins(modelName)
}

/** @deprecated NVIDIA-specific helper — use rolesFromCatalog */
function defaultModels() {
  return rolesFromCatalog([
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3-ultra-550b-a55b',
    'nvidia/nemotron-3-nano-30b-a3b',
  ])
}

module.exports = {
  isAutoModel,
  isOpenRouterModel,
  isVisionModel,
  bodyHasImages,
  classifyTier,
  scoreModelRoles,
  listProviderModels,
  rolesFromCatalog,
  buildFallbackCascade,
  modelForTier,
  defaultModels,
  shouldRetryUpstream,
  getActiveProviderEntry,
  buildAutoRouterPlugins,
  routeAutoModel,
  routeAutoModelAsync,
}
