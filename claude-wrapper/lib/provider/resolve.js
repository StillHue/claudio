/**
 * Load providers.json and resolve picker ids → upstream provider/model.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { providerTag, modelSlug, PICKER_LABEL, PICKER_DESCRIPTION } = require('./display')

/** Reverse: slug → { provider, model } */
let slugIndexCache = null
let slugIndexCacheKey = null

function buildSlugIndex(providersData) {
  const cacheKey = JSON.stringify(providersData?.providers || {})
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
    path.join(rootDir, 'providers.example.json'),
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

function modelId(providerName, model) {
  return `anthropic.${providerTag(providerName)}.${modelSlug(model)}`
}

function parseModelId(id, providersData) {
  if (!id || typeof id !== 'string') return null

  if (providersData) {
    const hit = buildSlugIndex(providersData).get(id.toLowerCase())
    if (hit) return { provider: hit.provider, model: hit.model }
  }

  if (id.startsWith('anthropic.') && providersData?.providers) {
    const rest = id.slice('anthropic.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const tag = rest.slice(0, dot)
      const slug = rest.slice(dot + 1)
      for (const [name, p] of Object.entries(providersData.providers)) {
        if (providerTag(name) !== tag && name !== tag) continue
        const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
        for (const model of models) {
          if (model === slug || modelSlug(model) === slug) return { provider: name, model }
        }
      }
    }
  }

  const parts = id.split('/').filter(Boolean)
  if (parts.length >= 2 && providersData?.providers?.[parts[0]]) {
    return { provider: parts[0], model: parts.slice(1).join('/') }
  }
  return null
}

function listCatalogEntries(providersData) {
  const providers = providersData?.providers || {}
  const out = []
  for (const [name, p] of Object.entries(providers)) {
    const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
    for (const model of models) {
      if (!model) continue
      out.push({
        id: modelId(name, model),
        provider: name,
        model,
        display_name: PICKER_LABEL,
        description: PICKER_DESCRIPTION,
        baseUrl: p.baseUrl || '',
        apiKeyEnv: p.apiKeyEnv || '',
      })
    }
  }
  return out
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
    upstreamModel = parsed.model
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
  if (!upstreamModel) upstreamModel = p.model || models[0]
  if (!p.baseUrl) throw new Error(`Provider "${name}" is missing baseUrl in providers.json`)

  const apiKey = resolveApiKey(p)
  const baseUrl = String(p.baseUrl).replace(/\/$/, '')

  return {
    ...p,
    name,
    baseUrl,
    model: upstreamModel,
    models,
    apiKey,
    format: p.format || 'chat',
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
  modelId,
  parseModelId,
  listCatalogEntries,
  resolveApiKey,
  resolveProvider,
  buildAnthropicModelsList,
}
