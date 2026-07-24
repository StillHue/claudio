/**
 * Shared provider + model catalog for Claude native mode.
 * Reads ~/.claude-native/providers.json (fallback ~/.codius/).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const DISPLAY = {
  // Free OpenCode Zen models → Anthropic-looking picker ids (upstream id unchanged).
  'mimo-v2.5-free': {
    name: 'Claude Opus 4.8 (Free)',
    description: 'OpenCode Zen free → mimo-v2.5-free',
    slug: 'claude-opus-4-8-free',
  },
  'big-pickle': {
    name: 'Claude Opus 4.8',
    description: 'OpenCode Zen → big-pickle',
    slug: 'claude-opus-4-8',
  },
  'north-mini-code-free': {
    name: 'Claude Haiku 4.5 (Free)',
    description: 'OpenCode Zen free → north-mini-code-free',
    slug: 'claude-haiku-4-5-free',
  },
  'laguna-s-2.1-free': {
    name: 'Claude Haiku 4.5 (Free 2)',
    description: 'OpenCode Zen free → laguna-s-2.1-free',
    slug: 'claude-haiku-4-5-free-2',
  },
  'deepseek-v4-flash-free': {
    name: 'Claude Sonnet 5 (Free)',
    description: 'OpenCode Zen free → deepseek-v4-flash-free',
    slug: 'claude-sonnet-5-free',
  },
  'nemotron-3-ultra-free': {
    name: 'Claude Opus 4.7 (Free)',
    description: 'OpenCode Zen free → nemotron-3-ultra-free',
    slug: 'claude-opus-4-7-free',
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

/** Picker / legacy ids → upstream Zen free (or Cohere) model */
const LEGACY_SLUGS = {
  lite: 'big-pickle',
  fast: 'mimo-v2.5-free',
  mini: 'north-mini-code-free',
  spark: 'laguna-s-2.1-free',
  max: 'deepseek-v4-flash-free',
  ultra: 'nemotron-3-ultra-free',
  'big-pickle': 'big-pickle',
  mimo: 'mimo-v2.5-free',
  'mimo-v2.5-free': 'mimo-v2.5-free',
  'deepseek-v4': 'deepseek-v4-flash-free',
  'deepseek-v4-flash-free': 'deepseek-v4-flash-free',
  laguna: 'laguna-s-2.1-free',
  'laguna-s-2.1-free': 'laguna-s-2.1-free',
  nemotron: 'nemotron-3-ultra-free',
  'nemotron-3-ultra-free': 'nemotron-3-ultra-free',
  'north-mini-code-free': 'north-mini-code-free',
  'opencode-zen-lite': 'big-pickle',
  'opencode-zen-fast': 'mimo-v2.5-free',
  'opencode-zen-mini': 'north-mini-code-free',
  'opencode-zen-spark': 'laguna-s-2.1-free',
  'opencode-zen-max': 'deepseek-v4-flash-free',
  'opencode-zen-ultra': 'nemotron-3-ultra-free',
  // Anthropic-equivalent picker slugs
  'claude-opus-4-8-free': 'mimo-v2.5-free',
  'claude-opus-4.8-free': 'mimo-v2.5-free',
  'claude-opus-4-8': 'big-pickle',
  'claude-opus-4.8': 'big-pickle',
  'claude-haiku-4-5-free': 'north-mini-code-free',
  'claude-haiku-4.5-free': 'north-mini-code-free',
  'claude-haiku-4-5-free-2': 'laguna-s-2.1-free',
  'claude-haiku-4.5-free-2': 'laguna-s-2.1-free',
  'claude-sonnet-5-free': 'deepseek-v4-flash-free',
  'claude-sonnet-5': 'deepseek-v4-flash-free',
  sonnet: 'deepseek-v4-flash-free',
  'claude-opus-4-7-free': 'nemotron-3-ultra-free',
  'claude-opus-4.7-free': 'nemotron-3-ultra-free',
  'claude-opus-4-7': 'nemotron-3-ultra-free',
  'claude-opus-4.7': 'nemotron-3-ultra-free',
  opus: 'nemotron-3-ultra-free',
  'claude-fable-5': 'nemotron-3-ultra-free',
  fable: 'nemotron-3-ultra-free',
}

const PROVIDER_LABEL = {
  opencode: 'OpenCode Zen',
  cohere: 'Cohere',
  alibaba: 'Alibaba',
  'alibaba-cn': 'Alibaba CN',
  'alibaba-coding-plan': 'Alibaba Coding',
  'alibaba-coding-plan-cn': 'Alibaba Coding CN',
  'alibaba-token-plan': 'Alibaba Token',
  'alibaba-token-plan-cn': 'Alibaba Token CN',
  mistral: 'Mistral',
}

/** Short tag embedded in picker ids: anthropic.<tag>.<model> */
const PROVIDER_TAG = {
  opencode: 'opencode',
  cohere: 'cohere',
  alibaba: 'alibaba',
  'alibaba-cn': 'alibaba-cn',
  'alibaba-coding-plan': 'alibaba-coding',
  'alibaba-coding-plan-cn': 'alibaba-coding-cn',
  'alibaba-token-plan': 'alibaba-token',
  'alibaba-token-plan-cn': 'alibaba-token-cn',
  mistral: 'mistral',
}

function providerTag(providerName) {
  if (PROVIDER_TAG[providerName]) return PROVIDER_TAG[providerName]
  return String(providerName || 'provider').replace(/[^a-zA-Z0-9._-]/g, '-')
}

function modelSlug(model) {
  return (
    DISPLAY[model]?.slug ||
    String(model || 'model').replace(/[^a-zA-Z0-9._-]/g, '-')
  )
}

/** Reverse: slug → { provider, model } */
function buildSlugIndex(providersData) {
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
          model: 'deepseek-v4-flash-free',
          apiKeyEnv: 'OPENAI_API_KEY',
          models: ['deepseek-v4-flash-free', 'big-pickle'],
        },
      },
    },
  }
}

/**
 * Picker id for Claude Code.
 * Must start with anthropic. (or claude) — no slashes.
 * Embeds real provider: anthropic.alibaba.qwen3.6-plus, anthropic.opencode.claude-sonnet-5
 */
function modelId(providerName, model) {
  const tag = providerTag(providerName)
  const slug = modelSlug(model)
  return `anthropic.${tag}.${slug}`
}

function parseModelId(id, providersData) {
  if (!id || typeof id !== 'string') return null

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
  const out = []
  const providers = providersData.providers || {}
  for (const [name, p] of Object.entries(providers)) {
    if (!p) continue
    const label = PROVIDER_LABEL[name] || name
    const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
    for (const model of models) {
      const nice = DISPLAY[model]?.name || model
      out.push({
        id: modelId(name, model),
        provider: name,
        model,
        display_name: `${label} · ${nice}`,
        description: DISPLAY[model]?.description || `via ${label}`,
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
 * Cursor User settings.json candidates (Windows + Linux/macOS).
 * @returns {string[]}
 */
function cursorUserSettingsPaths() {
  const paths = []
  if (process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json'))
  }
  paths.push(path.join(os.homedir(), '.config', 'Cursor', 'User', 'settings.json'))
  return paths
}

/**
 * Write Claude Code `model` + catalog into ~/.claude/settings.json.
 * Always aligns `settings.model` with providers.json active default.
 * Only rewrites when content changes (Claude watches this file mid-session).
 */
function syncClaudeAvailableModels(providersData) {
  const ids = listCatalogEntries(providersData).map((e) => e.id)
  if (!ids.length) return { path: null, ids: [], model: null, changed: false }

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
  settings.enforceAvailableModels = true
  // Always align default with providers.json (source of truth).
  settings.model = defaultId

  // Strip leftovers that force OpenAI chat routing and bypass our
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

/**
 * Merge only `claudeCode.model` into Cursor User settings.json (só-se-mudou).
 * @returns {{ path: string|null, changed: boolean, model: string|null }}
 */
function syncCursorClaudeModel(defaultId) {
  if (!defaultId) return { path: null, changed: false, model: null }
  for (const settingsPath of cursorUserSettingsPaths()) {
    if (!fs.existsSync(settingsPath)) continue
    let settings = {}
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch {
      continue
    }
    if (settings['claudeCode.model'] === defaultId) {
      return { path: settingsPath, changed: false, model: defaultId }
    }
    settings['claudeCode.model'] = defaultId
    const next = JSON.stringify(settings, null, 2) + '\n'
    fs.writeFileSync(settingsPath, next, 'utf8')
    return { path: settingsPath, changed: true, model: defaultId }
  }
  return { path: null, changed: false, model: defaultId }
}

/**
 * Full default-model sync: Claude settings + Cursor claudeCode.model.
 * Call from CLI / wrapper spawn only — never from mid-stream.
 */
function syncDefaultModel(providersData) {
  const claude = syncClaudeAvailableModels(providersData)
  const active = providersData.active || 'opencode'
  const activeProvider = providersData.providers?.[active]
  const defaultId =
    claude.model ||
    (activeProvider
      ? modelId(active, activeProvider.model || (activeProvider.models || [])[0])
      : null)
  const cursor = syncCursorClaudeModel(defaultId)
  return {
    model: defaultId,
    ids: claude.ids || [],
    claude,
    cursor,
    changed: !!(claude.changed || cursor.changed),
    path: claude.path,
  }
}

/**
 * Persist active provider + model into providers.json (no Claude/Cursor rewrite).
 * Safe to call from POST /v1/messages hot path.
 * @returns {{ changed: boolean, path: string|null, provider: string|null, model: string|null }}
 */
function persistProvidersDefault(providersData, providerName, upstreamModel, configPath) {
  if (!providerName || !upstreamModel || !providersData?.providers?.[providerName]) {
    return { changed: false, path: configPath || null, provider: null, model: null }
  }
  const p = providersData.providers[providerName]
  const models = Array.isArray(p.models) && p.models.length ? p.models : p.model ? [p.model] : []
  // Only persist catalog models (avoid writing ephemeral Claude aliases).
  if (models.length && !models.includes(upstreamModel)) {
    return { changed: false, path: configPath || null, provider: providerName, model: upstreamModel }
  }

  const needActive = providersData.active !== providerName
  const needModel = p.model !== upstreamModel
  if (!needActive && !needModel) {
    return { changed: false, path: configPath || null, provider: providerName, model: upstreamModel }
  }

  providersData.active = providerName
  p.model = upstreamModel

  let target = configPath
  if (!target) {
    target = path.join(os.homedir(), '.claude-native', 'providers.json')
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(providersData, null, 2) + '\n', 'utf8')
    return { changed: true, path: target, provider: providerName, model: upstreamModel }
  } catch (err) {
    console.error(
      `[claude-native] failed to write providers.json (${target}): ${err.message}`,
    )
    return { changed: false, path: target, provider: providerName, model: upstreamModel, error: err.message }
  }
}

/**
 * Set default model from CLI arg (bare id or anthropic.<id>).
 * Updates providers.json then runs syncDefaultModel.
 */
function setDefaultModel(requestedId) {
  const loaded = loadProvidersConfig()
  const data = loaded.data
  if (!data.providers || !Object.keys(data.providers).length) {
    throw new Error('No providers configured in ~/.claude-native/providers.json')
  }

  let providerName = null
  let upstreamModel = null
  const parsed = parseModelId(requestedId, data)
  if (parsed && data.providers[parsed.provider]) {
    providerName = parsed.provider
    upstreamModel = parsed.model
  } else {
    const bare = String(requestedId || '')
      .replace(/^anthropic\./i, '')
      .trim()
    for (const [n, cand] of Object.entries(data.providers)) {
      const models = Array.isArray(cand.models) && cand.models.length ? cand.models : [cand.model]
      if (models.includes(bare) || cand.model === bare) {
        providerName = n
        upstreamModel = bare
        break
      }
    }
  }

  if (!providerName || !upstreamModel) {
    throw new Error(`Unknown model: ${requestedId}`)
  }

  const models =
    Array.isArray(data.providers[providerName].models) && data.providers[providerName].models.length
      ? data.providers[providerName].models
      : [data.providers[providerName].model]
  if (!models.includes(upstreamModel)) {
    // Allow setting as default even if not listed — append for catalog sync.
    if (!Array.isArray(data.providers[providerName].models)) {
      data.providers[providerName].models = models.filter(Boolean)
    }
    if (!data.providers[providerName].models.includes(upstreamModel)) {
      data.providers[providerName].models.unshift(upstreamModel)
    }
  }

  const configPath = loaded.path || path.join(os.homedir(), '.claude-native', 'providers.json')
  const persisted = persistProvidersDefault(data, providerName, upstreamModel, configPath)
  const synced = syncDefaultModel(data)
  return {
    provider: providerName,
    model: upstreamModel,
    pickerId: modelId(providerName, upstreamModel),
    providersPath: persisted.path,
    providersChanged: persisted.changed,
    sync: synced,
  }
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
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
  cursorUserSettingsPaths,
}
