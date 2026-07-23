#!/usr/bin/env node
/**
 * Provider catalog CLI (v1: sync + list; keys stay manual in providers.json).
 *
 *   node sync-catalog.js sync
 *   node sync-catalog.js list
 *   node sync-catalog.js list --bridge
 *   node sync-catalog.js list --models opencode
 *   node sync-catalog.js show opencode
 */
const {
  CATALOG_PATH,
  refreshCatalog,
  loadCatalog,
  listProviders,
  getProvider,
  syncOpencodeModelsIntoProviders,
} = require('./provider-catalog')

function usage() {
  console.log(`Usage:
  node sync-catalog.js sync              Fetch models.dev + Zen, cache, update opencode.models
  node sync-catalog.js list [--bridge]   List providers (optionally bridge-ready only)
  node sync-catalog.js list --models <id>
  node sync-catalog.js show <provider>

Cache: ${CATALOG_PATH}
Keys / active: ~/.claude-native/providers.json (edit manually)
`)
}

async function cmdSync() {
  console.log('Fetching models.dev + OpenCode Zen…')
  const catalog = await refreshCatalog()
  console.log(
    `catalog: ${catalog.providerCount} providers (${catalog.bridgeReadyCount} bridge-ready), Zen live=${catalog.sources.zenLiveCount}`,
  )
  console.log(`wrote:   ${CATALOG_PATH}`)
  const merged = syncOpencodeModelsIntoProviders(catalog)
  if (merged.error) {
    console.log(`providers.json: skipped (${merged.error})`)
  } else {
    console.log(
      `providers.json: ${merged.changed ? 'updated' : 'unchanged'} opencode.models=${merged.modelCount} → ${merged.path}`,
    )
    try {
      const { loadProvidersConfig, syncDefaultModel } = require('./provider-config')
      const synced = syncDefaultModel(loadProvidersConfig().data)
      console.log(
        `claude/cursor sync: ${synced.changed ? 'updated' : 'unchanged'} model=${synced.model} ids=${synced.ids.length}`,
      )
    } catch (err) {
      console.log(`claude/cursor sync: skipped (${err.message})`)
    }
  }
}

async function cmdList(args) {
  const bridgeOnly = args.includes('--bridge')
  const modelsIdx = args.indexOf('--models')
  const catalog = await loadCatalog({ refresh: false })
  if (!catalog) {
    console.error('No catalog cache. Run: node sync-catalog.js sync')
    process.exit(1)
  }

  if (modelsIdx >= 0) {
    const id = args[modelsIdx + 1]
    if (!id) {
      console.error('Missing provider id after --models')
      process.exit(1)
    }
    const p = getProvider(catalog, id)
    if (!p) {
      console.error(`Unknown provider: ${id}`)
      process.exit(1)
    }
    console.log(`${p.name} (${p.id}) dialect=${p.dialect} bridge=${p.bridge} baseUrl=${p.baseUrl || '-'}`)
    for (const m of p.models) {
      const flags = [
        m.live ? 'live' : null,
        m.free ? 'free' : null,
        m.tools === false ? 'no-tools' : null,
        m.reasoning ? 'reasoning' : null,
      ]
        .filter(Boolean)
        .join(',')
      console.log(`  ${m.id}${flags ? `  (${flags})` : ''}`)
    }
    console.log(`(${p.models.length} models)`)
    return
  }

  const list = listProviders(catalog, { bridgeOnly })
  console.log(
    `fetchedAt=${catalog.fetchedAt}  showing=${list.length}${bridgeOnly ? ' (bridge-only)' : ''}`,
  )
  for (const p of list) {
    const mark = p.bridge ? '*' : ' '
    console.log(
      `${mark} ${p.id.padEnd(22)} ${String(p.modelCount).padStart(4)} models  ${p.dialect.padEnd(18)} ${p.apiKeyEnv || '-'}`,
    )
  }
  console.log('\n* = bridge-ready (openai-chat + baseUrl). Enable = add block to providers.json with apiKey.')
}

async function cmdShow(id) {
  if (!id) {
    console.error('Usage: node sync-catalog.js show <provider>')
    process.exit(1)
  }
  const catalog = await loadCatalog({ refresh: false })
  const p = getProvider(catalog, id)
  if (!p) {
    console.error(`Unknown provider: ${id}. Run sync first.`)
    process.exit(1)
  }
  const { models, ...rest } = p
  console.log(JSON.stringify({ ...rest, modelsSample: models.slice(0, 8), modelCount: models.length }, null, 2))
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    return
  }
  try {
    if (cmd === 'sync') await cmdSync()
    else if (cmd === 'list') await cmdList(args)
    else if (cmd === 'show') await cmdShow(args[0])
    else {
      usage()
      process.exit(1)
    }
  } catch (err) {
    console.error(`[sync-catalog] ${err.message}`)
    process.exit(1)
  }
}

main()
