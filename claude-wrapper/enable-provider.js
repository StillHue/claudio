#!/usr/bin/env node
/**
 * Enable a provider from the catalog (list → API key → models in picker).
 *
 *   node enable-provider.js                  # interactive wizard
 *   node enable-provider.js opencode --prompt-key
 *   node enable-provider.js groq --key=gsk_...
 *   node enable-provider.js opencode --model=deepseek-v4-flash-free
 */
const readline = require('readline')
const {
  loadCatalog,
  refreshCatalog,
  listProviders,
  getProvider,
  enableProvider,
} = require('./provider-catalog')

function usage() {
  console.log(`Usage:
  node enable-provider.js                         Interactive wizard
  node enable-provider.js <provider-id> --prompt-key
  node enable-provider.js <provider-id> --key=<api-key>
  node enable-provider.js <provider-id> --model=<model-id>

Examples:
  node enable-provider.js opencode --prompt-key
  node enable-provider.js openrouter --prompt-key --model=anthropic/claude-sonnet-4
`)
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(String(ans || '').trim())))
}

async function promptHidden(rl, question) {
  // Best-effort hide on TTY (Windows-friendly fallback: still readline).
  if (!process.stdin.isTTY) return ask(rl, question)
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    const onData = (buf) => {
      const s = buf.toString('utf8')
      if (s === '\n' || s === '\r' || s === '\r\n') {
        stdin.removeListener('data', onData)
        if (typeof stdin.setRawMode === 'function') stdin.setRawMode(!!wasRaw)
        process.stdout.write('\n')
        resolve(acc)
        return
      }
      if (s === '\u0003') process.exit(130)
      if (s === '\u007f' || s === '\b') {
        acc = acc.slice(0, -1)
        return
      }
      if (s >= ' ' || s.length > 1) {
        acc += s
        process.stdout.write('*')
      }
    }
    let acc = ''
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

async function wizard() {
  console.log('Refreshing provider catalog…')
  const catalog = await refreshCatalog()
  const bridge = listProviders(catalog, { bridgeOnly: true })
  console.log(`\nBridge-ready providers (${bridge.length}):\n`)
  for (const p of bridge.slice(0, 40)) {
    console.log(`  ${p.id.padEnd(22)} ${String(p.modelCount).padStart(4)} models  ${p.apiKeyEnv || '-'}`)
  }
  if (bridge.length > 40) console.log(`  … +${bridge.length - 40} more (see: node sync-catalog.js list --bridge)`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const id = await ask(rl, '\nProvider id: ')
    if (!id) throw new Error('No provider id')
    const meta = getProvider(catalog, id)
    if (!meta) throw new Error(`Unknown provider: ${id}`)
    if (!meta.bridge) throw new Error(`Not bridge-ready: ${id}`)

    console.log(`\n${meta.name} · ${meta.modelCount} models · env ${meta.apiKeyEnv || '(none)'}`)
    console.log('Paste API key (input hidden). Leave empty to keep existing / use env only.')
    const key = await promptHidden(rl, 'API key: ')
    const modelHint = meta.models.find((m) => m.live)?.id || meta.models[0]?.id || ''
    const model = await ask(rl, `Default model [${modelHint}]: `)

    const result = enableProvider(catalog, id, {
      apiKey: key || undefined,
      model: model || undefined,
      setActive: true,
    })
    printResult(result)
  } finally {
    rl.close()
  }
}

function printResult(result) {
  console.log('\nEnabled:')
  console.log(`  provider:  ${result.provider} (${result.name})`)
  console.log(`  model:     ${result.model}`)
  console.log(`  models:    ${result.modelCount}`)
  console.log(`  picker:    ${result.pickerId}`)
  console.log(`  hasKey:    ${result.hasKey}`)
  if (result.apiKeyEnv) console.log(`  apiKeyEnv: ${result.apiKeyEnv}`)
  console.log(`  config:    ${result.path}`)
  console.log('\nNext: restart Claude Code (or Reload Window), then /model to pick a model.')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    usage()
    return
  }

  const positional = args.filter((a) => !a.startsWith('--'))
  const providerId = positional[0]
  if (!providerId) {
    await wizard()
    return
  }

  let key
  const keyArg = args.find((a) => a.startsWith('--key='))
  if (keyArg) key = keyArg.slice('--key='.length)
  const modelArg = args.find((a) => a.startsWith('--model='))
  const model = modelArg ? modelArg.slice('--model='.length) : undefined

  if (args.includes('--prompt-key')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      key = await promptHidden(rl, `API key for ${providerId}: `)
    } finally {
      rl.close()
    }
  }

  const catalog = await loadCatalog({ refresh: false })
  if (!catalog?.providers?.length) {
    console.log('No catalog cache — syncing…')
    await refreshCatalog()
  }
  const cat = await loadCatalog({ refresh: false })
  const result = enableProvider(cat, providerId, {
    apiKey: key,
    model,
    setActive: !args.includes('--no-active'),
  })
  printResult(result)
}

main().catch((err) => {
  console.error(`[enable-provider] ${err.message}`)
  process.exit(1)
})
