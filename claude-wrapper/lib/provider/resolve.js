/**
 * Load providers.json and resolve picker ids → upstream provider/model.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  DISPLAY,
  LEGACY_SLUGS,
  PROVIDER_LABEL,
  providerTag,
  modelSlug,
} = require('./display')

/** Reverse: slug → { provider, model } */
let slugIndexCache = null
let slugIndexCacheKey = null

function buildSlugIndex(providersData) {
  const cacheKey = JSON.stringify({
    active: providersData.active,
    providers: Object.keys(providersData.providers || {}).sort(),
  })
  if (slugIndexCache && slugIndexCacheKey === cacheKey) {
    return slugIndexCache
  }
  const index = new Map()
  const set = (key, provider, model, slug) => {
    if (!key) return
    index.set(String(key).toLowerCase(), { provider, model, slug })
  }

  for (const [name, p] of Object.entries(providersData.providers || {})) {
    const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
    const tag = providerTag(name)
    for (const model of models) {
      const slug = modelSlug(model)
      const full = `anthropic.${tag}.${slug}`
      set(full, name, model, slug)
      set(`${tag}.${slug}`, name, model, slug)
      set(slug, name, model, slug)
      set(`anthropic.${slug}`, name, model, slug)
      // bare upstream id
      set(model, name, model, slug)
      set(`anthropic.${model}`, name, model, slug)
      const shortName = DISPLAY[model]?.name
      if (shortName) {
        set(shortName, name, model, slug)
        set(`anthropic.${shortName}`, name, model, slug)
        set(`${tag}.${shortName}`, name, model, slug)
        set(`anthropic.${tag}.${shortName}`, name, model, slug)
      }
    }
  }
  // Old OpenCode-Zen-* / Cohere-* / bare Anthropic-alias ids still work
  for (const [legacy, model] of Object.entries(LEGACY_SLUGS)) {
    for (const [name, p] of Object.entries(providersData.providers || {})) {
      const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
      if (!models.includes(model)) continue
      const slug = modelSlug(model)
      const tag = providerTag(name)
      set(legacy, name, model, slug)
      set(`anthropic.${legacy}`, name, model, slug)
      set(`${tag}.${legacy}`, name, model, slug)
      set(`anthropic.${tag}.${legacy}`, name, model, slug)
    }
  }
  slugIndexCache = index
  slugIndexCacheKey = cacheKey
  return index
}

function loadProvidersConfig() {
  const rootDir = path.resolve(__dirname, '..', '..')
  const candidates = [
    path.join(rootDir, 'providers.json'),
    path.join(os.homedir(), '.claude-native', 'providers.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'))
        // Invalidate cache when file changes (check mtime + content hash)
        const stat = fs.statSync(p)
        const cacheKey = `${stat.mtimeMs}:${JSON.stringify({
          active: data.active,
          providers: Object.keys(data.providers || {}).sort(),
        })}`
        if (slugIndexCacheKey !== cacheKey) {
          slugIndexCache = null
          slugIndexCacheKey = null
        }
        return { path: p, data }
      }
    } catch {
      /* ignore */
    }
  }
  console.error('[provider-config] WARNING: providers.json not found — configure a provider on first run')
  return {
    path: null,
    data: {
      active: null,
      providers: {},
    },
  }
}

/**
 * Picker id for Claude Code.
 * Claude Code rewrites bare "Auto" to anthropic.openrouter.openrouter-auto.
 * Use that canonical id everywhere and label it "Auto" via modelPicker.
 */
const AUTO_PICKER_ID = 'anthropic.openrouter.openrouter-auto'

function isAutoPickerId(id) {
  if (!id || typeof id !== 'string') return false
  const lower = id.toLowerCase().trim()
  return (
    lower === 'auto' ||
    lower === 'anthropic.auto' ||
    lower === 'claude-auto' ||
    lower === 'openrouter/auto' ||
    lower === 'openrouter/auto-beta' ||
    lower === AUTO_PICKER_ID ||
    lower === 'anthropic.openrouter.auto' ||
    lower === 'anthropic.openrouter.auto-beta' ||
    lower.endsWith('.auto') ||
    lower.endsWith('.openrouter-auto')
  )
}

function modelId(providerName, model) {
  if (model === 'auto' || providerName === 'auto') return AUTO_PICKER_ID
  if (isAutoPickerId(model) || model === 'openrouter/auto' || model === 'openrouter/auto-beta') {
    return AUTO_PICKER_ID
  }
  const tag = providerTag(providerName)
  const slug = modelSlug(model)
  return `anthropic.${tag}.${slug}`
}

function parseModelId(id, providersData) {
  if (!id || typeof id !== 'string') return null

  const lower = id.toLowerCase().trim()
  if (isAutoPickerId(id)) {
    const active = providersData?.active
    if (active && providersData?.providers?.[active]) {
      return { provider: active, model: 'auto' }
    }
    const names = Object.keys(providersData?.providers || {})
    if (names.length) return { provider: names[0], model: 'auto' }
    return { provider: 'auto', model: 'auto' }
  }

  if (providersData) {
    const hit = buildSlugIndex(providersData).get(id.toLowerCase())
    if (hit) return { provider: hit.provider, model: hit.model }
  }

  // anthropic.<providerTag>.<model…>
  if (id.startsWith('anthropic.')) {
    const rest = id.slice('anthropic.'.length)
    if (rest.includes('/')) {
      const [provider, ...modelParts] = rest.split('/')
      if (provider && modelParts.length) return { provider, model: modelParts.join('/') }
    }
    const dot = rest.indexOf('.')
    if (dot > 0 && providersData?.providers) {
      const tag = rest.slice(0, dot)
      const slug = rest.slice(dot + 1)
      for (const [name] of Object.entries(providersData.providers)) {
        if (providerTag(name) === tag || name === tag) {
          // Prefer DISPLAY reverse / exact model id
          for (const [upstream, meta] of Object.entries(DISPLAY)) {
            if (meta.slug === slug && providersData.providers[name]?.models?.includes(upstream)) {
              return { provider: name, model: upstream }
            }
          }
          const models = providersData.providers[name].models || []
          if (models.includes(slug)) return { provider: name, model: slug }
          return { provider: name, model: slug }
        }
      }
    }
  }

  // native/opencode/big-pickle or opencode/big-pickle
  const parts = id.split('/').filter(Boolean)
  if (parts.length >= 2) {
    if (parts[0] === 'native' && parts.length >= 3) {
      return { provider: parts[1], model: parts.slice(2).join('/') }
    }
    if (!parts[0].startsWith('claude') && !/^(opus|sonnet|haiku|fable|anthropic)$/i.test(parts[0])) {
      return { provider: parts[0], model: parts.slice(1).join('/') }
    }
  }
  return null
}

function listCatalogEntries(providersData) {
  const providers = providersData?.providers || {}
  const active = providersData?.active
  const activeEntry = (active && providers[active]) || providers[Object.keys(providers)[0]] || null
  const autoProvider = active || Object.keys(providers)[0] || 'auto'
  const autoDescription = activeEntry
    ? `Auto — routes vision, coding, and complexity across ${autoProvider} models`
    : 'Auto — pick a provider on first run, then routes across its models'
  return [
    {
      id: AUTO_PICKER_ID,
      provider: autoProvider,
      model: 'auto',
      display_name: 'Auto',
      description: autoDescription,
      baseUrl: activeEntry?.baseUrl || '',
      apiKeyEnv: activeEntry?.apiKeyEnv || '',
    },
  ]
}

function resolveApiKey(p) {
  if (process.env.CLAUDE_NATIVE_API_KEY) return process.env.CLAUDE_NATIVE_API_KEY
  if (p.apiKey) return p.apiKey
  if (p.apiKeyEnv && process.env[p.apiKeyEnv]) return process.env[p.apiKeyEnv]
  return ''
}

/**
 * Resolve upstream provider for a Claude Code requested model id.
 * Prefer exact catalog hits; else active provider default.
 */
function resolveProvider(providersData, requestedModel) {
  const providers = providersData.providers || {}
  const active =
    providersData.active && providers[providersData.active]
      ? providersData.active
      : Object.keys(providers)[0]
  const parsed = parseModelId(requestedModel, providersData)

  let name = active
  let p = providers[active]
  let upstreamModel = null

  if (parsed && providers[parsed.provider]) {
    name = parsed.provider
    p = providers[parsed.provider]
    upstreamModel = parsed.model === 'auto' ? null : parsed.model
  } else if (requestedModel) {
    // bare model name match across providers
    for (const [n, cand] of Object.entries(providers)) {
      const models = Array.isArray(cand.models) && cand.models.length ? cand.models : [cand.model]
      if (models.includes(requestedModel)) {
        name = n
        p = cand
        upstreamModel = requestedModel
        break
      }
    }
  }

  if (!p) {
    throw new Error(`Provider "${name}" not found in providers.json`)
  }

  const models = Array.isArray(p.models) && p.models.length ? p.models : [p.model]
  if (upstreamModel === 'auto') {
    upstreamModel = p.model || models[0]
  }
  if (!upstreamModel) {
    // Claude built-in aliases → size heuristic within active provider
    const lower = String(requestedModel || '').toLowerCase()
    if (/haiku|fast|lite|mini|small/.test(lower) && models[0]) {
      upstreamModel = models.find((m) => /mini|fast|lite|pickle|mimo/.test(m)) || models[0]
    } else if (/opus|ultra|max|pro/.test(lower)) {
      upstreamModel =
        models.find((m) => /ultra|max|deepseek|nemotron|command-a/.test(m)) || p.model || models[0]
    } else {
      upstreamModel = p.model || models[0]
    }
  }

  // Env force only when no specific catalog model was selected
  if (!parsed && !models.includes(requestedModel)) {
    if (process.env.CLAUDE_NATIVE_MODEL) upstreamModel = process.env.CLAUDE_NATIVE_MODEL
  }

  const apiKey = resolveApiKey(p)
  const baseUrl = (
    process.env.CLAUDE_NATIVE_BASE_URL ||
    p.baseUrl ||
    'https://integrate.api.nvidia.com/v1'
  ).replace(/\/$/, '')
  // Per-model format override (e.g. muse-spark → responses), else provider default
  const format =
    (p.modelFormats && p.modelFormats[upstreamModel]) || p.format || 'chat'

  return {
    ...p,
    name,
    baseUrl,
    model: upstreamModel,
    models,
    apiKey,
    format,
    smallModel: p.smallModel || models[0] || p.model,
    bigModel: p.bigModel || p.model || models[models.length - 1],
  }
}

/** Anthropic-shaped /v1/models payload for gateway discovery. */
function buildAnthropicModelsList(providersData) {
  const entries = listCatalogEntries(providersData)
  const data = entries.map((e, i) => ({
    type: 'model',
    id: e.id,
    display_name: e.display_name,
    description: e.description || '',
    created_at: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }))
  return {
    data,
    has_more: false,
    first_id: data[0]?.id || null,
    last_id: data[data.length - 1]?.id || null,
  }
}

module.exports = {
  buildSlugIndex,
  loadProvidersConfig,
  AUTO_PICKER_ID,
  isAutoPickerId,
  modelId,
  parseModelId,
  listCatalogEntries,
  resolveApiKey,
  resolveProvider,
  buildAnthropicModelsList,
}
