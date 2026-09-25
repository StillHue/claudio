/**
 * Fixed configured model routing.
 * Canonical picker id: anthropic.mistral.mistral-code-latest
 * Legacy openrouter-auto / bare Auto aliases still accepted.
 */
const { resolveProvider, resolveApiKey, loadProvidersConfig, isAutoPickerId } = require('../provider/resolve')
const { loadNativeEnvFiles } = require('../wrapper/env')

loadNativeEnvFiles()

function isAutoModel(modelName) {
  return isAutoPickerId(modelName)
}

function isConcreteModel(modelName) {
  return Boolean(modelName) && !isAutoModel(modelName)
}

function shouldRetryUpstream(status, err) {
  if (err) {
    const name = err?.name || ''
    const msg = String(err?.message || err)
    return name === 'TimeoutError' || /aborted|timeout|econnreset|fetch failed/i.test(msg)
  }
  return status === 429 || status === 503 || status === 502 || status === 504 || status === 410
}

function getActiveProviderEntry(data) {
  const active = data?.active
  const providers = data?.providers || {}
  if (active && providers[active]) return { name: active, entry: providers[active] }
  if (providers.mistral) return { name: 'mistral', entry: providers.mistral }
  const names = Object.keys(providers)
  if (names.length === 1) return { name: names[0], entry: providers[names[0]] }
  for (const name of names) {
    if (resolveApiKey(providers[name])) return { name, entry: providers[name] }
  }
  return { name: active || names[0] || null, entry: active ? providers[active] : providers[names[0]] }
}

function configuredModel(entry) {
  if (!entry) return null
  if (isConcreteModel(entry.model)) return entry.model
  if (Array.isArray(entry.models)) {
    const hit = entry.models.find((m) => isConcreteModel(m))
    if (hit) return hit
  }
  return null
}

function configuredCascade(entry) {
  if (!entry) return []
  const list = Array.isArray(entry.models) && entry.models.length ? entry.models : entry.model ? [entry.model] : []
  const concrete = list.filter((m) => isConcreteModel(m))
  const primary = configuredModel(entry)
  if (!primary) return concrete
  return [primary, ...concrete.filter((m) => m !== primary)]
}

function routeAutoModel(body, providersData, ctx) {
  const data = providersData || loadProvidersConfig().data
  const { name, entry } = getActiveProviderEntry(data)
  if (!name || !entry) {
    throw new Error('No provider configured in providers.json — run first-run setup or set a provider')
  }

  const apiKey = resolveApiKey(entry)
  if (!apiKey) {
    const envName = entry.apiKeyEnv || 'MISTRAL_API_KEY'
    throw new Error(`${envName} is not configured — set it in ~/.claude/.env`)
  }

  const upstreamModel = configuredModel(entry)
  if (!upstreamModel) {
    throw new Error(`No concrete model set for provider "${name}" in providers.json`)
  }

  const resolved = resolveProvider(data, upstreamModel)
  const provider = {
    ...resolved,
    name,
    baseUrl: entry.baseUrl || resolved.baseUrl,
    apiKey,
    format: entry.format || resolved.format || 'chat',
    models: Array.isArray(entry.models) ? entry.models : resolved.models,
  }

  ctx?.log?.(`[picker] model=${upstreamModel} provider=${name}`)

  const fallbackCascade = configuredCascade(entry)
  return {
    provider,
    upstreamModel,
    upstreamFormat: 'chat',
    tier: 'fixed',
    fallbackCascade: fallbackCascade.length ? fallbackCascade : [upstreamModel],
  }
}

async function routeAutoModelAsync(body, providersData, ctx) {
  return routeAutoModel(body, providersData, ctx)
}

module.exports = {
  isAutoModel,
  shouldRetryUpstream,
  routeAutoModel,
  routeAutoModelAsync,
  getActiveProviderEntry,
  configuredModel,
  configuredCascade,
}
