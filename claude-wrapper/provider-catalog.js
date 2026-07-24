/**
 * Remote provider catalog for Claude native mode (v1: list + cache).
 *
 * Sources:
 *   - https://models.dev/api.json  (broad registry)
 *   - https://opencode.ai/zen/v1/models  (live Zen ids)
 *
 * Cache: ~/.claude-native/catalog.json
 * User keys / active provider stay in ~/.claude-native/providers.json (manual).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const MODELS_DEV_URL = process.env.CLAUDE_NATIVE_MODELS_DEV_URL || 'https://models.dev/api.json'
const ZEN_MODELS_URL =
  process.env.CLAUDE_NATIVE_ZEN_MODELS_URL || 'https://opencode.ai/zen/v1/models'
const CATALOG_PATH = path.join(os.homedir(), '.claude-native', 'catalog.json')
const FETCH_TIMEOUT_MS = Number(process.env.CLAUDE_NATIVE_CATALOG_TIMEOUT_MS || 60000)

/** When models.dev omits `api`, use these OpenAI-compatible bases (bridge dialect). */
const BASE_URL_FALLBACKS = {
  opencode: 'https://opencode.ai/zen/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com',
  cohere: 'https://api.cohere.com/compatibility/v1',
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  togetherai: 'https://api.together.xyz/v1',
  'fireworks-ai': 'https://api.fireworks.ai/inference/v1',
  mistral: 'https://api.mistral.ai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  'github-models': 'https://models.inference.ai.azure.com',
}

/**
 * Map models.dev `npm` package → bridge dialect.
 * Only `openai-chat` is usable by the current native-bridge upstream.
 */
function dialectFromNpm(npm) {
  const n = String(npm || '')
  if (
    n.includes('openai-compatible') ||
    n === '@ai-sdk/openai' ||
    n.includes('openrouter') ||
    n === '@ai-sdk/groq' ||
    n === '@ai-sdk/cerebras' ||
    n === '@ai-sdk/xai' ||
    n === '@ai-sdk/togetherai' ||
    n === '@ai-sdk/mistral' ||
    n === '@ai-sdk/cohere'
  ) {
    return 'openai-chat'
  }
  if (n.includes('anthropic')) return 'anthropic-messages'
  if (n.includes('google') || n.includes('gemini')) return 'google'
  if (n.includes('bedrock') || n.includes('vertex')) return 'cloud'
  return 'unknown'
}

function normalizeBaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return ''
  return raw.replace(/\/$/, '').replace(/\/chat\/completions$/i, '')
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'claude-native-catalog/1' },
  })
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}`)
  }
  return res.json()
}

function modelEntry(id, meta, liveSet) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const free =
    /free/i.test(id) ||
    /free/i.test(String(m.name || '')) ||
    (m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0)
  return {
    id,
    name: m.name || id,
    free: Boolean(free),
    tools: m.tool_call !== false,
    reasoning: Boolean(m.reasoning),
    attachment: Boolean(m.attachment),
    live: liveSet ? liveSet.has(id) : undefined,
  }
}

/**
 * Build catalog provider list from models.dev registry + optional Zen live set.
 * @param {object} modelsDev
 * @param {Set<string>|null} zenLiveIds
 */
function buildProvidersFromModelsDev(modelsDev, zenLiveIds) {
  const providers = []
  for (const [id, raw] of Object.entries(modelsDev || {})) {
    if (!raw || typeof raw !== 'object') continue
    // Skip non-provider blobs if any
    if (!raw.name && !raw.models && !raw.npm) continue

    const npm = raw.npm || ''
    const dialect = dialectFromNpm(npm)
    const baseUrl =
      normalizeBaseUrl(raw.api) || BASE_URL_FALLBACKS[id] || ''
    const envList = Array.isArray(raw.env) ? raw.env : raw.env ? [raw.env] : []
    const apiKeyEnv = envList[0] || ''
    const modelsObj = raw.models && typeof raw.models === 'object' ? raw.models : {}
    const liveSet = id === 'opencode' && zenLiveIds ? zenLiveIds : null

    const models = Object.keys(modelsObj)
      .sort()
      .map((mid) => modelEntry(mid, modelsObj[mid], liveSet))

    providers.push({
      id,
      name: raw.name || id,
      baseUrl,
      apiKeyEnv,
      apiKeyEnvAlts: envList.slice(1),
      dialect,
      bridge: dialect === 'openai-chat' && Boolean(baseUrl),
      doc: raw.doc || '',
      npm,
      modelCount: models.length,
      models,
    })
  }

  providers.sort((a, b) => {
    if (a.bridge !== b.bridge) return a.bridge ? -1 : 1
    if (a.id === 'opencode') return -1
    if (b.id === 'opencode') return 1
    return a.name.localeCompare(b.name)
  })
  return providers
}

/**
 * Fetch remote sources and write ~/.claude-native/catalog.json
 * @returns {Promise<object>} catalog
 */
async function refreshCatalog() {
  const [modelsDev, zen] = await Promise.all([
    fetchJson(MODELS_DEV_URL),
    fetchJson(ZEN_MODELS_URL).catch(() => ({ data: [] })),
  ])

  const zenLiveIds = new Set(
    (Array.isArray(zen?.data) ? zen.data : [])
      .map((m) => m?.id)
      .filter(Boolean),
  )

  const providers = buildProvidersFromModelsDev(modelsDev, zenLiveIds)
  const catalog = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    sources: {
      modelsDev: MODELS_DEV_URL,
      zenModels: ZEN_MODELS_URL,
      zenLiveCount: zenLiveIds.size,
    },
    providerCount: providers.length,
    bridgeReadyCount: providers.filter((p) => p.bridge).length,
    providers,
  }

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true })
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8')
  return catalog
}

function loadCachedCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return null
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
  } catch {
    return null
  }
}

/** Load cache or refresh if missing. */
async function loadCatalog({ refresh = false } = {}) {
  if (!refresh) {
    const cached = loadCachedCatalog()
    if (cached?.providers?.length) return cached
  }
  return refreshCatalog()
}

function listProviders(catalog, { bridgeOnly = false } = {}) {
  const list = catalog?.providers || []
  return bridgeOnly ? list.filter((p) => p.bridge) : list
}

function getProvider(catalog, id) {
  const key = String(id || '').toLowerCase()
  return (catalog?.providers || []).find((p) => p.id.toLowerCase() === key) || null
}

/**
 * Merge Zen/opencode model ids into user providers.json (keys untouched).
 * Prefers live Zen ids when available; else full opencode catalog models.
 * @returns {{ changed: boolean, path: string|null, modelCount: number }}
 */
function syncOpencodeModelsIntoProviders(catalog, providersPath) {
  const { loadProvidersConfig } = require('./provider-config')
  const loaded = loadProvidersConfig()
  const data = loaded.data
  const target =
    providersPath ||
    loaded.path ||
    path.join(os.homedir(), '.claude-native', 'providers.json')

  const oc = getProvider(catalog, 'opencode')
  if (!oc) {
    return { changed: false, path: target, modelCount: 0, error: 'opencode not in catalog' }
  }

  if (!data.providers) data.providers = {}
  if (!data.providers.opencode) {
    data.providers.opencode = {
      baseUrl: oc.baseUrl || BASE_URL_FALLBACKS.opencode,
      model: 'deepseek-v4-flash-free',
      apiKeyEnv: oc.apiKeyEnv || 'OPENCODE_API_KEY',
      tools: true,
      models: [],
    }
  }

  const p = data.providers.opencode
  // Picker aliases Anthropic names onto free Zen models only — keep catalog sync
  // aligned with that (live free → free → live → all).
  const freeLive = oc.models.filter((m) => m.free && m.live).map((m) => m.id)
  const free = oc.models.filter((m) => m.free).map((m) => m.id)
  const live = oc.models.filter((m) => m.live).map((m) => m.id)
  const all = oc.models.map((m) => m.id)
  const nextModels = freeLive.length
    ? freeLive
    : free.length
      ? free
      : live.length
        ? live
        : all

  // Keep current default first if still in list
  const current = p.model
  const ordered = []
  if (current && nextModels.includes(current)) ordered.push(current)
  for (const id of nextModels) {
    if (!ordered.includes(id)) ordered.push(id)
  }

  const prev = JSON.stringify(p.models || [])
  const next = JSON.stringify(ordered)
  if (prev === next && p.baseUrl === (oc.baseUrl || p.baseUrl)) {
    return { changed: false, path: target, modelCount: ordered.length }
  }

  p.models = ordered
  if (oc.baseUrl) p.baseUrl = oc.baseUrl
  if (!p.model && ordered[0]) p.model = ordered[0]
  if (p.model && !ordered.includes(p.model) && ordered[0]) p.model = ordered[0]
  // Prefer documenting OpenCode env; do not overwrite if user set something else
  if (!p.apiKeyEnv) p.apiKeyEnv = oc.apiKeyEnv || 'OPENCODE_API_KEY'

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return { changed: true, path: target, modelCount: ordered.length }
}

/**
 * Enable a catalog provider in providers.json (API key + models + optional active).
 * @param {object} catalog
 * @param {string} providerId
 * @param {{ apiKey?: string, model?: string, setActive?: boolean, providersPath?: string|null }} [opts]
 */
function enableProvider(catalog, providerId, opts = {}) {
  const { loadProvidersConfig, syncDefaultModel, modelId } = require('./provider-config')
  const meta = getProvider(catalog, providerId)
  if (!meta) {
    throw new Error(`Unknown provider "${providerId}". Run: node sync-catalog.js sync`)
  }
  if (!meta.bridge || !meta.baseUrl) {
    throw new Error(
      `Provider "${providerId}" is not bridge-ready (dialect=${meta.dialect}, baseUrl=${meta.baseUrl || 'missing'}). Pick one from: node sync-catalog.js list --bridge`,
    )
  }

  const loaded = loadProvidersConfig()
  const data = loaded.data || { active: providerId, providers: {} }
  if (!data.providers) data.providers = {}
  const target =
    opts.providersPath ||
    loaded.path ||
    path.join(os.homedir(), '.claude-native', 'providers.json')

  const existing = data.providers[meta.id] || {}
  let models =
    meta.id === 'opencode'
      ? meta.models.filter((m) => m.live).map((m) => m.id)
      : meta.models.map((m) => m.id)
  if (!models.length) models = meta.models.map((m) => m.id)

  const apiKey =
    opts.apiKey != null && String(opts.apiKey).length
      ? String(opts.apiKey).trim()
      : existing.apiKey || ''

  let model = opts.model || existing.model || models[0]
  if (model && models.length && !models.includes(model)) {
    models = [model, ...models]
  }
  if (!model) model = models[0]

  data.providers[meta.id] = {
    ...existing,
    baseUrl: meta.baseUrl,
    apiKeyEnv: meta.apiKeyEnv || existing.apiKeyEnv || '',
    tools: true,
    model,
    models,
  }
  if (apiKey) data.providers[meta.id].apiKey = apiKey
  if (opts.setActive !== false) data.active = meta.id

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })

  const synced = syncDefaultModel(data)
  return {
    provider: meta.id,
    name: meta.name,
    model,
    modelCount: models.length,
    pickerId: modelId(meta.id, model),
    hasKey: Boolean(apiKey || (meta.apiKeyEnv && process.env[meta.apiKeyEnv])),
    apiKeyEnv: meta.apiKeyEnv || '',
    path: target,
    sync: synced,
  }
}

module.exports = {
  CATALOG_PATH,
  MODELS_DEV_URL,
  ZEN_MODELS_URL,
  BASE_URL_FALLBACKS,
  dialectFromNpm,
  refreshCatalog,
  loadCachedCatalog,
  loadCatalog,
  listProviders,
  getProvider,
  syncOpencodeModelsIntoProviders,
  enableProvider,
  buildProvidersFromModelsDev,
}
