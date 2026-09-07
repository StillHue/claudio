/**
 * One-shot: force Claude Code + IDE hosts onto Auto-only picker.
 * Run: node scripts/force-auto-picker.js
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
  loadProvidersConfig,
  syncDefaultModel,
  AUTO_PICKER_ID,
  ideHostSettingsTargets,
} = require('../provider-config')

function readJsonLoose(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  try {
    return JSON.parse(raw)
  } catch {
    const end = raw.lastIndexOf('}')
    if (end < 0) throw new Error(`unrecoverable JSON: ${filePath}`)
    return JSON.parse(raw.slice(0, end + 1))
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

const { data } = loadProvidersConfig()
const synced = syncDefaultModel(data)

const claudePath = path.join(os.homedir(), '.claude', 'settings.json')
const claude = readJsonLoose(claudePath)
claude.availableModels = [AUTO_PICKER_ID]
claude.enforceAvailableModels = true
claude.model = AUTO_PICKER_ID
claude.modelPicker = {
  replaceBuiltInOptions: true,
  options: [
    {
      model: AUTO_PICKER_ID,
      label: 'Auto',
      description:
        claude.env?.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ||
        'Auto — routes across your active provider models',
    },
  ],
}
if (!claude.env || typeof claude.env !== 'object') claude.env = {}
claude.env.ANTHROPIC_CUSTOM_MODEL_OPTION = AUTO_PICKER_ID
claude.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = 'Auto'
writeJson(claudePath, claude)

const wrapperExe = path.join(__dirname, '..', 'claudio-wrapper-native47.exe')
const fallbackExe = path.join(__dirname, '..', 'claudio-wrapper-native46.exe')
const exe = fs.existsSync(wrapperExe) ? wrapperExe : fallbackExe

for (const target of ideHostSettingsTargets()) {
  if (!fs.existsSync(target.path)) continue
  try {
    const settings = readJsonLoose(target.path)
    settings['claudeCode.model'] = AUTO_PICKER_ID
    if (fs.existsSync(exe)) {
      settings['claudeCode.claudeProcessWrapper'] = exe
    }
    settings['claudeCode.disableLoginPrompt'] = true
    settings['claudeCode.skipApiCheck'] = true
    writeJson(target.path, settings)
    console.log(`ok ${target.name}: model=Auto wrapper=${settings['claudeCode.claudeProcessWrapper'] || '(unchanged)'}`)
  } catch (err) {
    console.error(`fail ${target.name}: ${err.message}`)
  }
}

console.log('claude settings:', {
  model: claude.model,
  availableModels: claude.availableModels,
  path: claudePath,
})
console.log('sync:', { changed: synced.changed, model: synced.model })
