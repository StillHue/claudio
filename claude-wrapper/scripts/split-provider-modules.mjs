#!/usr/bin/env node
/**
 * One-shot: split provider-config.js into lib/provider/{display,resolve,sync}.js
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'provider-config.js'), 'utf8')

fs.mkdirSync(path.join(root, 'lib', 'provider'), { recursive: true })
fs.mkdirSync(path.join(root, 'lib', 'wrapper'), { recursive: true })

function between(startMarker, endMarker) {
  const a = src.indexOf(startMarker)
  if (a < 0) throw new Error('start not found: ' + startMarker)
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : src.length
  if (endMarker && b < 0) throw new Error('end not found: ' + endMarker)
  return src.slice(a, endMarker ? b : undefined)
}

const displayBody = between('const DISPLAY = {', '/** Reverse: slug')
fs.writeFileSync(
  path.join(root, 'lib', 'provider', 'display.js'),
  `/**
 * Display names, legacy slugs, and provider tags for the Claude native catalog.
 */
${displayBody.trim()}

module.exports = {
  DISPLAY,
  LEGACY_SLUGS,
  PROVIDER_LABEL,
  PROVIDER_TAG,
  providerTag,
  modelSlug,
}
`,
)

const resolveStart = src.indexOf('/** Reverse: slug')
const resolveEnd = src.search(/\/\*\*\r?\n \* Cursor User settings\.json candidates/)
if (resolveStart < 0 || resolveEnd < 0) {
  throw new Error(`resolve markers missing start=${resolveStart} end=${resolveEnd}`)
}
const resolveChunk = src.slice(resolveStart, resolveEnd)
fs.writeFileSync(
  path.join(root, 'lib', 'provider', 'resolve.js'),
  `/**
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

${resolveChunk.trim()}

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
`,
)

const syncStart = src.search(/\/\*\*\r?\n \* Cursor User settings\.json candidates/)
if (syncStart < 0) throw new Error('sync start marker missing')
let syncChunk = src.slice(syncStart)
syncChunk = syncChunk.replace(/module\.exports = \{[\s\S]*$/, '').trim()

const oldParse = `const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let settings = {}
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch {
    settings = {}
  }`

const newParse = `const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  let settings = {}
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch (err) {
    // NEVER wipe a corrupt settings.json by rewriting {}.
    console.error(
      \`[provider-sync] refusing to rewrite corrupt settings.json: \${err.message}\`,
    )
    return {
      path: settingsPath,
      ids,
      model: null,
      changed: false,
      error: 'parse_failed',
    }
  }
  if (!settings || typeof settings !== 'object') settings = {}`

if (!syncChunk.includes(oldParse)) {
  // try CRLF variant
  const oldCrlf = oldParse.replace(/\n/g, '\r\n')
  if (syncChunk.includes(oldCrlf)) {
    syncChunk = syncChunk.replace(oldCrlf, newParse.replace(/\n/g, '\r\n'))
  } else {
    console.error('WARN: sync parse block not found exactly; writing with manual patch attempt')
    syncChunk = syncChunk.replace(
      /catch \{\r?\n\s*settings = \{\}\r?\n\s*\}/,
      `catch (err) {
    console.error(
      \`[provider-sync] refusing to rewrite corrupt settings.json: \${err.message}\`,
    )
    return {
      path: settingsPath,
      ids,
      model: null,
      changed: false,
      error: 'parse_failed',
    }
  }
  if (!settings || typeof settings !== 'object') settings = {}`,
    )
  }
} else {
  syncChunk = syncChunk.replace(oldParse, newParse)
}

fs.writeFileSync(
  path.join(root, 'lib', 'provider', 'sync.js'),
  `/**
 * Sync providers.json defaults into Claude + Cursor settings.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { modelId, loadProvidersConfig, listCatalogEntries, parseModelId } = require('./resolve')

${syncChunk}

module.exports = {
  cursorUserSettingsPaths,
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
}
`,
)

const syncTxt = fs.readFileSync(path.join(root, 'lib', 'provider', 'sync.js'), 'utf8')
console.log('display bytes', fs.statSync(path.join(root, 'lib/provider/display.js')).size)
console.log('resolve bytes', fs.statSync(path.join(root, 'lib/provider/resolve.js')).size)
console.log('sync bytes', fs.statSync(path.join(root, 'lib/provider/sync.js')).size)
console.log('has parse_failed', syncTxt.includes("error: 'parse_failed'"))
console.log('wipe catch gone', !/catch \{\s*settings = \{\}/.test(syncTxt))
