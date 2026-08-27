/**
 * Third party providers — first-run screen when no provider is configured.
 * Shows provider list and writes providers.json + .env via CLI prompt.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')

const PROVIDERS = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    description: 'Muse Spark 1.2 · Laguna · Hy3 (free tier)',
    baseUrl: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
    models: ['muse-spark-1.2-contributor-free', 'laguna-s-2.1-free', 'hy3-free'],
    keyUrl: 'https://opencode.ai/settings/api-keys',
  },
  {
    id: 'nvidia',
    name: 'Nvidia',
    description: 'Nemotron Nano 30B · Lightning 30B',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    models: ['nvidia/nemotron-3-nano-30b-a3b', 'nvidia/nemotron-3.5-lightning-30b-a3b'],
    keyUrl: 'https://build.nvidia.com/explore/reasoning',
  },
  {
    id: 'custom',
    name: 'OpenAI Compatible (custom)',
    description: 'Any OpenAI-compatible endpoint (OpenRouter, Groq, etc.)',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini'],
    keyUrl: null,
  },
]

function providersPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'providers.json'),
    path.join(os.homedir(), '.claude-native', 'providers.json'),
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch { /* ignore */ }
  }
  return path.join(__dirname, '..', '..', 'providers.json')
}

function envPath() {
  return path.join(__dirname, '..', '..', '.env')
}

function loadExistingProviders() {
  const p = providersPath()
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch { /* ignore */ }
  return null
}

function printProviders() {
  console.log('')
  console.log('  ┌─ Third party providers ──────────────────────────┐')
  for (let i = 0; i < PROVIDERS.length; i++) {
    const pr = PROVIDERS[i]
    const line = `  │ ${i + 1}. ${pr.name} · ${pr.description}`
    console.log(line.padEnd(52) + '│')
  }
  console.log('  └──────────────────────────────────────────────────┘')
  console.log('')
}

async function prompt(question, hideInput = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    if (hideInput) {
      const stdin = process.stdin
      const onData = (char) => {
        char = char + ''
        switch (char) {
          case '\n': case '\r': case '\u0004':
            stdin.removeListener('data', onData); break
          default:
            process.stdout.write('\x1B[2K\x1B[200D' + question + Array(rl.line.length + 1).join('*'))
            break
        }
      }
      process.stdin.on('data', onData)
    }
    rl.question(question, (answer) => {
      rl.close()
      if (hideInput) process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

async function showThirdPartyProviders() {
  const isTTY = process.stdin.isTTY && process.stdout.isTTY
  if (!isTTY) {
    console.error('')
    console.error('[claude-wrapper] No provider configured.')
    console.error('  Set one of these env vars and retry:')
    for (const pr of PROVIDERS) {
      console.error(`    ${pr.apiKeyEnv} → ${pr.name} (${pr.baseUrl})`)
    }
    console.error('')
    console.error('  Or run: node lib/provider/third-party-ui.js')
    console.error('  Or edit: claude-wrapper/providers.json')
    console.error('')
    return false
  }

  printProviders()
  const choice = await prompt('Select provider [1-' + PROVIDERS.length + '] (1): ')
  const idx = parseInt(choice || '1', 10) - 1
  const selected = PROVIDERS[idx] || PROVIDERS[0]

  console.log(`\n  Selected: ${selected.name} (${selected.baseUrl})`)
  if (selected.keyUrl) console.log(`  Get API key: ${selected.keyUrl}`)
  let apiKey = ''
  while (!apiKey) {
    apiKey = await prompt(`  Enter ${selected.apiKeyEnv}: `, false)
    if (!apiKey) console.log('  API key cannot be empty.')
  }

  let customBaseUrl = selected.baseUrl
  let customModel = selected.models[0]
  if (selected.id === 'custom') {
    const url = await prompt(`  Base URL [${selected.baseUrl}]: `)
    if (url) customBaseUrl = url.trim().replace(/\/$/, '')
    const model = await prompt(`  Model [${selected.models[0]}]: `)
    if (model) customModel = model.trim()
  }

  // Write .env
  const envFile = envPath()
  let envContent = ''
  try { if (fs.existsSync(envFile)) envContent = fs.readFileSync(envFile, 'utf8') } catch { /* ignore */ }
  const envKey = selected.apiKeyEnv
  const envLine = `${envKey}=${apiKey}`
  if (envContent.includes(envKey + '=')) {
    envContent = envContent.replace(new RegExp(`^${envKey}=.*$`, 'm'), envLine)
  } else {
    if (envContent && !envContent.endsWith('\n')) envContent += '\n'
    envContent += envLine + '\n'
  }
  fs.mkdirSync(path.dirname(envFile), { recursive: true })
  fs.writeFileSync(envFile, envContent, 'utf8')
  console.log(`\n  Wrote ${envFile} → ${envKey}`)

  // Write providers.json
  const pPath = providersPath()
  let data = loadExistingProviders()
  if (!data) {
    data = { active: selected.id, providers: {} }
  }
  // Ensure selected provider exists
  if (!data.providers[selected.id]) {
    data.providers[selected.id] = {
      baseUrl: customBaseUrl,
      model: customModel,
      apiKeyEnv: selected.apiKeyEnv,
      tools: true,
      format: 'chat',
      models: selected.models,
    }
    if (selected.id === 'opencode' && selected.models.includes('muse-spark-1.2-contributor-free')) {
      data.providers[selected.id].modelFormats = { 'muse-spark-1.2-contributor-free': 'responses' }
    }
  } else {
    // Update existing provider with new key env if needed
    data.providers[selected.id].baseUrl = customBaseUrl
    data.providers[selected.id].model = customModel
  }
  data.active = selected.id
  fs.mkdirSync(path.dirname(pPath), { recursive: true })
  fs.writeFileSync(pPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`  Wrote ${pPath} → active: ${selected.id}/${customModel}`)
  console.log('')
  console.log('  ✓ Provider configured. Run `claude` again.')
  console.log('')
  return true
}

if (require.main === module) {
  showThirdPartyProviders().then((ok) => process.exit(ok ? 0 : 1))
}

module.exports = { showThirdPartyProviders, PROVIDERS }
