/**
 * Sync providers.json defaults into Claude Code + IDE host settings.
 * IDE hosts: any editor that runs the official Claude Code extension
 * (Cursor, VS Code, Insiders, VSCodium, …).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { modelId, loadProvidersConfig, listCatalogEntries, parseModelId, AUTO_PICKER_ID } = require('./resolve')

/**
 * User settings.json candidates for Claude Code IDE hosts (Windows + Linux/macOS).
 * @returns {{ name: string, path: string }[]}
 */
function ideHostSettingsTargets() {
  const targets = []
  const home = os.homedir()
  const winApps = process.env.APPDATA
    ? [
        ['Cursor', path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json')],
        ['VS Code', path.join(process.env.APPDATA, 'Code', 'User', 'settings.json')],
        ['VS Code Insiders', path.join(process.env.APPDATA, 'Code - Insiders', 'User', 'settings.json')],
        ['VSCodium', path.join(process.env.APPDATA, 'VSCodium', 'User', 'settings.json')],
      ]
    : []
  const unixApps = [
    ['Cursor', path.join(home, '.config', 'Cursor', 'User', 'settings.json')],
    ['VS Code', path.join(home, '.config', 'Code', 'User', 'settings.json')],
    ['VS Code Insiders', path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json')],
    ['VSCodium', path.join(home, '.config', 'VSCodium', 'User', 'settings.json')],
  ]
  const all = winApps.length ? winApps : unixApps
  const seen = new Set()
  for (const [name, p] of all) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targets.push({ name, path: p })
  }
  return targets
}

/** @deprecated use ideHostSettingsTargets — kept for callers */
function cursorUserSettingsPaths() {
  return ideHostSettingsTargets().map((t) => t.path)
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
      const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')
      settings = JSON.parse(raw)
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

  const active = providersData.active
  const providerLabel = active || 'your provider'
  const autoDescription = `Auto — routes vision, coding, and complexity across ${providerLabel} models`

  // Picker shows only Auto. Discrete catalog models stay resolvable by id,
  // but listing them here hides Auto in Claude Code / the extension.
  settings.availableModels = [AUTO_PICKER_ID]
  settings.enforceAvailableModels = true
  settings.model = AUTO_PICKER_ID

  settings.modelPicker = {
    replaceBuiltInOptions: true,
    options: [
      {
        model: AUTO_PICKER_ID,
        label: 'Auto',
        description: autoDescription,
      },
    ],
  }

  if (!settings.env || typeof settings.env !== 'object') settings.env = {}
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION = AUTO_PICKER_ID
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = 'Auto'
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = autoDescription

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
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
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
 * Merge `claudeCode.model` into every installed IDE host settings.json.
 * @returns {{ changed: boolean, model: string|null, hosts: { name: string, path: string, changed: boolean }[], path: string|null }}
 */
function syncIdeClaudeModel(defaultId) {
  const hosts = []
  if (!defaultId) return { changed: false, model: null, hosts, path: null }

  for (const target of ideHostSettingsTargets()) {
    if (!fs.existsSync(target.path)) {
      // Only touch hosts that already have a settings file (IDE was used).
      continue
    }
    let settings = {}
    let raw = ''
    try {
      raw = fs.readFileSync(target.path, 'utf8').replace(/^\uFEFF/, '')
      settings = JSON.parse(raw)
    } catch {
      // Recover from trailing junk (e.g. literal "\\n" after the root object).
      try {
        const end = raw.lastIndexOf('}')
        if (end < 0) throw new Error('no closing brace')
        settings = JSON.parse(raw.slice(0, end + 1))
      } catch {
        hosts.push({ name: target.name, path: target.path, changed: false, error: 'parse_failed' })
        continue
      }
    }
    if (settings['claudeCode.model'] === defaultId) {
      hosts.push({ name: target.name, path: target.path, changed: false })
      continue
    }
    settings['claudeCode.model'] = defaultId
    fs.writeFileSync(target.path, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    hosts.push({ name: target.name, path: target.path, changed: true })
  }

  return {
    changed: hosts.some((h) => h.changed),
    model: defaultId,
    hosts,
    path: hosts.find((h) => h.changed)?.path || hosts[0]?.path || null,
  }
}

/** @deprecated use syncIdeClaudeModel */
function syncCursorClaudeModel(defaultId) {
  return syncIdeClaudeModel(defaultId)
}

/**
 * Full default-model sync: ~/.claude + every Claude Code IDE host.
 * Call from CLI / wrapper spawn only — never from mid-stream.
 */
function syncDefaultModel(providersData) {
  const claude = syncClaudeAvailableModels(providersData)
  const defaultId = AUTO_PICKER_ID
  const ide = syncIdeClaudeModel(defaultId)
  return {
    model: defaultId,
    ids: claude.ids || [],
    claude,
    cursor: ide, // backward-compatible alias
    ide,
    changed: !!(claude.changed || ide.changed),
    path: claude.path,
  }
}

/**
 * Persist active provider + model into providers.json (no Claude/IDE rewrite).
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
 * Updates providers.json then runs syncDefaultModel.
 */
function setDefaultModel(providerName, upstreamModel) {
  const loaded = loadProvidersConfig()
  const data = loaded.data
  if (!data?.providers || !Object.keys(data.providers).length) {
    throw new Error('No providers configured in ~/.claude-native/providers.json')
  }
  let name = providerName
  let model = upstreamModel
  if (!name || !model) {
    const parsed = parseModelId(String(providerName || upstreamModel || ''), data)
    if (parsed) {
      name = parsed.provider
      model = parsed.model
    }
  }
  if (!name || !model) {
    throw new Error('Could not resolve provider/model')
  }
  if (!data.providers[name]) {
    throw new Error(`Provider "${name}" not found`)
  }
  if (!Array.isArray(data.providers[name].models)) {
    data.providers[name].models = []
  }
  if (!data.providers[name].models.includes(model)) {
    data.providers[name].models.unshift(model)
  }
  const configPath = loaded.path || path.join(os.homedir(), '.claude-native', 'providers.json')
  const persisted = persistProvidersDefault(data, name, model, configPath)
  const synced = syncDefaultModel(data)
  return {
    provider: name,
    model,
    pickerId: modelId(name, model),
    providersPath: persisted.path,
    providersChanged: persisted.changed,
    sync: synced,
  }
}

module.exports = {
  ideHostSettingsTargets,
  cursorUserSettingsPaths,
  syncClaudeAvailableModels,
  syncIdeClaudeModel,
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
}
