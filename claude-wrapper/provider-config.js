/**
 * Shared provider + model catalog for Claude native mode.
 * Reads ~/.claude-native/providers.json (fallback ~/.codius/).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const DISPLAY = {
  // Prefer exact OpenCode model ids in the picker (anthropic.<id>).
  // Extra name/description only used as gateway hints.
  'big-pickle': { name: 'big-pickle', description: 'OpenCode Zen', slug: 'big-pickle' },
  'mimo-v2.5-free': { name: 'mimo-v2.5-free', description: 'OpenCode Zen', slug: 'mimo-v2.5-free' },
  'north-mini-code-free': {
    name: 'north-mini-code-free',
    description: 'OpenCode Zen',
    slug: 'north-mini-code-free',
  },
  'laguna-s-2.1-free': {
    name: 'laguna-s-2.1-free',
    description: 'OpenCode Zen',
    slug: 'laguna-s-2.1-free',
  },
  'deepseek-v4-flash-free': {
    name: 'deepseek-v4-flash-free',
    description: 'OpenCode Zen',
    slug: 'deepseek-v4-flash-free',
  },
  'nemotron-3-ultra-free': {
    name: 'nemotron-3-ultra-free',
    description: 'OpenCode Zen',
    slug: 'nemotron-3-ultra-free',
  },
  'north-mini-code-1-0': {
    name: 'Cohere · north-mini-code',
    description: 'Cohere',
    slug: 'north-mini-code-1-0',
  },
  'command-a-03-2025': {
    name: 'Cohere · command-a',
    description: 'Cohere',
    slug: 'command-a-03-2025',
  },
  'command-r-plus-08-2024': {
    name: 'Cohere · command-r-plus',
    description: 'Cohere',
    slug: 'command-r-plus-08-2024',
  },
}

/** Legacy picker ids → upstream model */
const LEGACY_SLUGS = {
  lite: 'big-pickle',
  fast: 'mimo-v2.5-free',
  mini: 'north-mini-code-free',
  spark: 'laguna-s-2.1-free',
  max: 'deepseek-v4-flash-free',
  ultra: 'nemotron-3-ultra-free',
  'big-pickle': 'big-pickle',
  mimo: 'mimo-v2.5-free',
  'deepseek-v4': 'deepseek-v4-flash-free',
  laguna: 'laguna-s-2.1-free',
  nemotron: 'nemotron-3-ultra-free',
  'opencode-zen-lite': 'big-pickle',
  'opencode-zen-fast': 'mimo-v2.5-free',
  'opencode-zen-mini': 'north-mini-code-free',
  'opencode-zen-spark': 'laguna-s-2.1-free',
  'opencode-zen-max': 'deepseek-v4-flash-free',
  'opencode-zen-ultra': 'nemotron-3-ultra-free',
}

const PROVIDER_LABEL = {
  opencode: 'OpenCode Zen',
  cohere: 'Cohere',
}

/** Reverse: slug → { provider, model } */
function buildSlugIndex(providersData) {
  const index = new Map()
  for (const [name, p] of Object.entries(providersData.providers || {})) {
    const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
    for (const model of models) {
      const slug = DISPLAY[model]?.slug || `${name}-${model}`.replace(/[^a-zA-Z0-9._-]/g, '-')
      const shortName = DISPLAY[model]?.name
      index.set(slug.toLowerCase(), { provider: name, model, slug })
      index.set(`anthropic.${slug}`.toLowerCase(), { provider: name, model, slug })
      if (shortName) {
        index.set(String(shortName).toLowerCase(), { provider: name, model, slug })
        index.set(`anthropic.${shortName}`.toLowerCase(), { provider: name, model, slug })
      }
    }
  }
  // Old OpenCode-Zen-* / Cohere-* ids still work
  for (const [legacy, model] of Object.entries(LEGACY_SLUGS)) {
    for (const [name, p] of Object.entries(providersData.providers || {})) {
      const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
      if (!models.includes(model)) continue
      const slug = DISPLAY[model]?.slug || legacy
      index.set(legacy, { provider: name, model, slug })
      index.set(`anthropic.${legacy}`, { provider: name, model, slug })
    }
  }
  return index
}

function loadProvidersConfig() {
  const candidates = [
    path.join(os.homedir(), '.claude-native', 'providers.json'),
    path.join(os.homedir(), '.codius', 'providers.json'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }
      }
    } catch {
      /* ignore */
    }
  }
  return {
    path: null,
    data: {
      active: 'opencode',
      providers: {
        opencode: {
          baseUrl: 'https://opencode.ai/zen/v1',
          model: 'big-pickle',
          apiKeyEnv: 'OPENAI_API_KEY',
          models: ['big-pickle'],
        },
      },
    },
  }
}

/**
 * Picker id for Claude Code.
 * Must start with anthropic. (or claude) — no slashes.
 * Use the exact upstream model id after the prefix, e.g. anthropic.big-pickle
 */
function modelId(providerName, model) {
  const slug =
    DISPLAY[model]?.slug ||
    String(model || `${providerName}-model`).replace(/[^a-zA-Z0-9._-]/g, '-')
  return `anthropic.${slug}`
}

function parseModelId(id, providersData) {
  if (!id || typeof id !== 'string') return null

  if (providersData) {
    const hit = buildSlugIndex(providersData).get(id.toLowerCase())
    if (hit) return { provider: hit.provider, model: hit.model }
  }

  // anthropic.OpenCode-Zen-Lite / anthropic.opencode/big-pickle (legacy)
  if (id.startsWith('anthropic.')) {
    const rest = id.slice('anthropic.'.length)
    if (rest.includes('/')) {
      const [provider, ...modelParts] = rest.split('/')
      if (provider && modelParts.length) return { provider, model: modelParts.join('/') }
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
  const out = []
  const providers = providersData.providers || {}
  for (const [name, p] of Object.entries(providers)) {
    if (!p) continue
    const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
    for (const model of models) {
      const meta = DISPLAY[model] || {
        name: `${PROVIDER_LABEL[name] || name} · ${model}`,
        description: `via ${PROVIDER_LABEL[name] || name}`,
      }
      out.push({
        id: modelId(name, model),
        provider: name,
        model,
        display_name: meta.name,
        description: meta.description,
        baseUrl: p.baseUrl,
        apiKeyEnv: p.apiKeyEnv,
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
  const active = providersData.active || 'opencode'
  const providers = providersData.providers || {}
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
    'https://opencode.ai/zen/v1'
  ).replace(/\/$/, '')

  return {
    ...p,
    name,
    baseUrl,
    model: upstreamModel,
    models,
    apiKey,
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

/**
 * Keep Claude Code availableModels in sync so gateway discovery is not filtered out.
 * Docs: discovered models are still filtered by availableModels.
 */
function syncClaudeAvailableModels(providersData) {
  const ids = listCatalogEntries(providersData).map((e) => e.id)
  if (!ids.length) return { path: null, ids: [] }

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let settings = {}
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch {
    settings = {}
  }

  const active = providersData.active || 'opencode'
  const activeProvider = providersData.providers?.[active]
  const defaultId = activeProvider
    ? modelId(active, activeProvider.model || (activeProvider.models || [])[0])
    : ids[0]

  settings.availableModels = ids
  // Constrain Default: without this, Claude Code keeps showing
  // "Default (recommended) · Opus …" even when settings.model is a gateway id.
  // With enforce=true, Default resolves to the first availableModels entry
  // when Opus isn't in the list.
  settings.enforceAvailableModels = true
  const needsDefault =
    !settings.model ||
    String(settings.model).startsWith('claude-') ||
    /opus|sonnet|haiku/i.test(String(settings.model)) ||
    settings.model === 'composer-2.5' ||
    !ids.includes(settings.model) ||
    String(settings.model).includes('/')
  if (needsDefault) {
    settings.model = defaultId
  }

  // Strip Claudio leftovers that force OpenAI chat routing and bypass our
  // Anthropic Messages bridge (ANTHROPIC_BASE_URL). Keep COHERE_API_KEY etc.
  if (settings.env && typeof settings.env === 'object') {
    for (const k of [
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENAI_MODEL',
      'CLAUDE_CODE_USE_OPENAI',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
    ]) {
      delete settings.env[k]
    }
    if (!Object.keys(settings.env).length) delete settings.env
  }

  const next = JSON.stringify(settings, null, 2) + '\n'
  let prev = ''
  try {
    if (fs.existsSync(settingsPath)) prev = fs.readFileSync(settingsPath, 'utf8')
  } catch {
    prev = ''
  }
  // Avoid rewriting — Claude Code watches settings.json and reloads mid-session,
  // which drops in-flight turns (picker works, chat hangs / never POSTs).
  if (prev === next) {
    return { path: settingsPath, ids, model: settings.model, changed: false }
  }

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, next, 'utf8')
  return { path: settingsPath, ids, model: settings.model, changed: true }
}

module.exports = {
  DISPLAY,
  loadProvidersConfig,
  listCatalogEntries,
  modelId,
  parseModelId,
  resolveProvider,
  buildAnthropicModelsList,
  syncClaudeAvailableModels,
}
