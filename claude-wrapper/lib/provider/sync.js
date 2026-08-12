/**
 * Sync providers.json defaults into Claude + Cursor settings.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { modelId, loadProvidersConfig, listCatalogEntries, parseModelId } = require('./resolve')

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
  } catch (err) {
    // NEVER wipe a corrupt settings.json by rewriting {}.
    console.error(
      `[provider-sync] refusing to rewrite corrupt settings.json: ${err.message}`,
    )
    return {
      path: settingsPath,
      ids,
      model: null,
      changed: false,
      error: 'parse_failed',
    }
  }
  if (!settings || typeof settings !== 'object') settings = {}

  const active = providersData.active || 'opencode'
  const activeProvider = providersData.providers?.[active]
  const defaultId = activeProvider
    ? modelId(active, activeProvider.model || (activeProvider.models || [])[0])
    : ids[0]

  settings.availableModels = ids
  // Constrain Default: without this, Claude Code keeps showing
  // "Default (recommended) · Opus …" even when settings.model is a gateway id.
  settings.enforceAvailableModels = true
  // Always align with providers.json active default (set-default-model / wrapper sync).
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
  const active = providersData.active || 'opencode'
  const activeProvider = providersData.providers?.[active]
  const fromProviders = activeProvider
    ? modelId(active, activeProvider.model || (activeProvider.models || [])[0])
    : null
  const claude = syncClaudeAvailableModels(providersData)
  const defaultId = fromProviders || claude.model
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
  cursorUserSettingsPaths,
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
}
