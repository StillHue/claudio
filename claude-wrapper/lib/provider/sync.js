/**
 * Sync providers.json defaults into Claude Code + IDE host settings.
 * IDE hosts: any editor that runs the official Claude Code extension
 * (Cursor, VS Code, Insiders, VSCodium, …).
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { modelId, listCatalogEntries, parseModelId } = require('./resolve')
const { PICKER_LABEL, PICKER_DESCRIPTION } = require('./display')
const { claudeHomeDir } = require('../wrapper/paths')

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

  const catalog = listCatalogEntries(providersData)
  const wanted = Array.isArray(providersData.pickerModels) ? providersData.pickerModels : []
  const picked = []
  const source = wanted.length ? wanted : catalog.map((e) => e.model)
  for (const want of source) {
    let parsed = null
    try {
      parsed = parseModelId(String(want), providersData)
    } catch {
      parsed = null
    }
    if (!parsed || !parsed.model) continue
    if (!providersData.providers[parsed.provider]) continue
    const id = modelId(parsed.provider, parsed.model)
    if (picked.some((o) => o.model === id)) continue
    picked.push({
      model: id,
      label: PICKER_LABEL,
      description: PICKER_DESCRIPTION,
    })
  }
  if (!picked.length) return { path: settingsPath, ids, model: null, changed: false }
  const activeName = providersData.active
  const activeModel = providersData.providers?.[activeName]?.model
  const activeId = activeModel ? modelId(activeName, activeModel) : null
  picked.sort((a, b) => (a.model === activeId ? -1 : b.model === activeId ? 1 : 0))
  const pickerOptions = picked
  const defaultId = pickerOptions[0].model
  settings.availableModels = pickerOptions.map((o) => o.model)
  settings.enforceAvailableModels = true
  settings.model = defaultId

  // Drop stale/invalid overrides (Claude expects string values).
  if (settings.modelOverrides && typeof settings.modelOverrides === 'object') {
    for (const key of Object.keys(settings.modelOverrides)) {
      if (typeof settings.modelOverrides[key] !== 'string') {
        delete settings.modelOverrides[key]
      }
    }
    if (!Object.keys(settings.modelOverrides).length) delete settings.modelOverrides
  }

  settings.modelPicker = {
    replaceBuiltInOptions: true,
    options: pickerOptions,
  }

  if (!settings.env || typeof settings.env !== 'object') settings.env = {}
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION = defaultId
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = pickerOptions[0].label
  settings.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = pickerOptions[0].description

  // Never persist base URLs / API keys in settings.json — the wrapper injects
  // an ephemeral bridge URL per spawn.
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
      'ANTHROPIC_BASE_URL',
      'MISTRAL_API_KEY',
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

/**
 * Full default-model sync: ~/.claude + every Claude Code IDE host.
 * Call from CLI / wrapper spawn only — never from mid-stream.
 */
function syncDefaultModel(providersData) {
  const claude = syncClaudeAvailableModels(providersData)
  const defaultId = claude.model || ''
  const ide = syncIdeClaudeModel(defaultId)
  return {
    model: defaultId,
    ids: claude.ids || [],
    claude,
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
    target = path.join(claudeHomeDir(), 'providers.json')
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(providersData, null, 2) + '\n', 'utf8')
    return { changed: true, path: target, provider: providerName, model: upstreamModel }
  } catch (err) {
    console.error(
      `[claude-wrapper] failed to write providers.json (${target}): ${err.message}`,
    )
    return { changed: false, path: target, provider: providerName, model: upstreamModel, error: err.message }
  }
}

module.exports = {
  ideHostSettingsTargets,
  syncClaudeAvailableModels,
  syncIdeClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
}
