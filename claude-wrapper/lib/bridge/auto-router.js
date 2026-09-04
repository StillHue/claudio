const { resolveProvider, resolveApiKey, loadProvidersConfig } = require('../provider/resolve')
const { loadNativeEnvFiles } = require('../wrapper/env')

loadNativeEnvFiles()

const COST_TIERS = ['low', 'medium', 'high', 'xhigh', 'max']

function isAutoModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return (
    lower === 'auto' ||
    lower === 'anthropic.auto' ||
    lower === 'claude-auto' ||
    lower === 'auto-router' ||
    lower.endsWith('.auto')
  )
}

function isOpenRouterModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return lower.startsWith('openrouter/')
}

function getCostTierOrNull() {
  const raw = process.env.OPENROUTER_COST_TIER || process.env.AUTO_ROUTER_COST_TIER
  if (!raw) return null
  const t = String(raw).toLowerCase().trim()
  if (!COST_TIERS.includes(t)) {
    console.warn(`[auto-router] invalid cost_tier="${raw}", ignoring plugin cost_tier`)
    return null
  }
  return t
}

function parseModelListEnv(name) {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * OpenRouter Auto Router plugin.
 * Always attach for openrouter/auto so allowed_models (e.g. nvidia/*) actually apply.
 * Without this, Auto routes across the whole OpenRouter catalog and can burn credits.
 */
function buildAutoRouterPlugins(modelName) {
  const model = String(modelName || 'openrouter/auto')
  const plugin = {
    id: model.includes('beta') ? 'auto-beta-router' : 'auto-router',
  }

  const costTier = getCostTierOrNull()
  if (costTier) plugin.cost_tier = costTier

  // Default: only NVIDIA models on OpenRouter (BYOK). Override via OPENROUTER_ALLOWED_MODELS.
  const allowed = parseModelListEnv('OPENROUTER_ALLOWED_MODELS')
  plugin.allowed_models = allowed.length ? allowed : ['nvidia/*']

  const excluded = parseModelListEnv('OPENROUTER_EXCLUDED_MODELS')
  if (excluded.length) plugin.excluded_models = excluded

  return [plugin]
}

function routeAutoModel(body, providersData, ctx) {
  const data = providersData || loadProvidersConfig().data
  const entry = data.providers?.openrouter
  if (!entry) {
    throw new Error('Provider openrouter is not configured in providers.json')
  }
  const apiKey = resolveApiKey(entry)
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured — set it in the wrapper .env or ~/.claude-native/.env')
  }

  let upstreamModel = 'openrouter/auto'
  if (body?.model && isOpenRouterModel(body.model)) {
    upstreamModel = body.model
  }

  const resolved = resolveProvider(data, upstreamModel)
  const provider = {
    ...resolved,
    name: 'openrouter',
    baseUrl: entry.baseUrl || resolved.baseUrl,
    apiKey,
    format: entry.format || 'chat',
  }
  const openRouterPlugins = buildAutoRouterPlugins(upstreamModel)
  ctx?.log?.(
    `[auto-router] → ${upstreamModel} plugins=${JSON.stringify(openRouterPlugins)}`,
  )
  return {
    provider,
    upstreamModel,
    upstreamFormat: provider.format || 'chat',
    tier: 'openrouter',
    openRouterPlugins,
  }
}

async function routeAutoModelAsync(body, providersData, ctx) {
  return routeAutoModel(body, providersData, ctx)
}

module.exports = {
  isAutoModel,
  isOpenRouterModel,
  buildAutoRouterPlugins,
  routeAutoModel,
  routeAutoModelAsync,
}
