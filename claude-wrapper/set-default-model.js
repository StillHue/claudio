#!/usr/bin/env node
/**
 * Set the default Claude native model and sync Claude Code + Cursor settings.
 *
 * Usage:
 *   node set-default-model.js deepseek-v4-flash-free
 *   node set-default-model.js anthropic.deepseek-v4-flash-free
 *   node set-default-model.js --list
 *   node set-default-model.js --show
 */
const {
  loadProvidersConfig,
  listCatalogEntries,
  modelId,
  setDefaultModel,
  syncDefaultModel,
} = require('./provider-config')

function usage() {
  console.log(`Usage:
  node set-default-model.js <model-id>
  node set-default-model.js anthropic.<model-id>
  node set-default-model.js --list
  node set-default-model.js --show

Examples:
  node set-default-model.js deepseek-v4-flash-free
  node set-default-model.js north-mini-code-1-0
`)
}

function showCurrent() {
  const { path: cfgPath, data } = loadProvidersConfig()
  const active = data.active || 'opencode'
  const p = data.providers?.[active]
  const model = p?.model || (p?.models || [])[0] || '(none)'
  const picker = p ? modelId(active, model) : '(none)'
  console.log(`config:  ${cfgPath || '(builtin)'}`)
  console.log(`active:  ${active}`)
  console.log(`model:   ${model}`)
  console.log(`picker:  ${picker}`)
}

function listModels() {
  const { data } = loadProvidersConfig()
  const entries = listCatalogEntries(data)
  if (!entries.length) {
    console.log('(empty catalog)')
    return
  }
  const active = data.active || 'opencode'
  const activeModel = data.providers?.[active]?.model
  for (const e of entries) {
    const mark = e.provider === active && e.model === activeModel ? '*' : ' '
    console.log(`${mark} ${e.id}  (${e.provider})`)
  }
  console.log('\n* = current default')
}

function main() {
  const arg = process.argv[2]
  if (!arg || arg === '-h' || arg === '--help') {
    usage()
    process.exit(arg ? 0 : 1)
  }
  if (arg === '--list' || arg === '-l') {
    listModels()
    return
  }
  if (arg === '--show' || arg === '-s') {
    showCurrent()
    return
  }
  if (arg === '--sync') {
    const { data } = loadProvidersConfig()
    const synced = syncDefaultModel(data)
    console.log(`synced ${synced.model}`)
    console.log(`  claude: ${synced.claude?.changed ? 'updated' : 'unchanged'} ${synced.claude?.path || ''}`)
    console.log(`  cursor: ${synced.cursor?.changed ? 'updated' : 'unchanged'} ${synced.cursor?.path || ''}`)
    return
  }

  try {
    const result = setDefaultModel(arg)
    console.log(`default → ${result.pickerId}`)
    console.log(`  provider: ${result.provider}`)
    console.log(`  model:    ${result.model}`)
    console.log(`  providers.json: ${result.providersChanged ? 'updated' : 'unchanged'} ${result.providersPath || ''}`)
    console.log(
      `  claude settings: ${result.sync.claude?.changed ? 'updated' : 'unchanged'} ${result.sync.claude?.path || ''}`,
    )
    console.log(
      `  cursor settings: ${result.sync.cursor?.changed ? 'updated' : 'unchanged'} ${result.sync.cursor?.path || ''}`,
    )
    console.log('\nReload Claude Code / Cursor window if the picker still shows the old default.')
  } catch (err) {
    console.error(`[set-default-model] ${err.message}`)
    process.exit(1)
  }
}

main()
