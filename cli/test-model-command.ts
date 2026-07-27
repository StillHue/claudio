// Simular exatamente o que acontece quando o usuário digita /model
import { resolveActiveRouteIdFromEnv, getRouteDescriptor } from './src/integrations/routeMetadata.js'
import { getCachedModels, isCacheStale } from './src/integrations/discoveryCache.js'
import { getDiscoveryCacheKey } from './src/integrations/discoveryService.js'
import { discoverModelsForRoute } from './src/integrations/discoveryService.js'
import { parseDurationString } from './src/integrations/discoveryCache.js'

console.log('=== Simulando /model ===\n')

// 1. Qual route está ativa?
const routeId = resolveActiveRouteIdFromEnv(process.env)
console.log('1. Route ativa:', routeId)

if (!routeId) {
  console.log('ERRO: Nenhuma route ativa')
  process.exit(1)
}

// 2. Tem descriptor?
const descriptor = getRouteDescriptor(routeId)
console.log('2. Descriptor:', descriptor?.label ?? 'NÃO ENCONTRADO')

if (!descriptor?.catalog) {
  console.log('ERRO: Sem catalog')
  process.exit(1)
}

console.log('   - Source:', descriptor.catalog.source)
console.log('   - Discovery:', descriptor.catalog.discovery?.kind ?? 'NÃO')
console.log('   - Refresh mode:', descriptor.catalog.discoveryRefreshMode)
console.log('   - Static models:', descriptor.catalog.models?.length ?? 0)

// 3. Verificar cache
const ttlMs = parseDurationString(descriptor.catalog.discoveryCacheTtl ?? 0)
const cacheKey = getDiscoveryCacheKey(routeId, {})
const cached = await getCachedModels(cacheKey, ttlMs, { includeStale: true })
const stale = await isCacheStale(cacheKey, ttlMs)

console.log('\n3. Cache:')
console.log('   - TTL:', descriptor.catalog.discoveryCacheTtl)
console.log('   - Cache key:', cacheKey)
console.log('   - Tem cache:', cached !== null)
console.log('   - Modelos no cache:', cached?.models?.length ?? 0)
console.log('   - Stale:', stale)

// 4. Simular shouldAutoRefreshRouteCatalog
const hasCachedModels = cached !== null
const staticEntryCount = descriptor.catalog.models?.length ?? 0
const needsInitialDiscovery = !hasCachedModels && staticEntryCount === 0

let autoRefresh = false
switch (descriptor.catalog.discoveryRefreshMode) {
  case 'manual':
    autoRefresh = needsInitialDiscovery
    break
  case 'on-open':
    autoRefresh = true
    break
  case 'startup':
    autoRefresh = needsInitialDiscovery
    break
  case 'background-if-stale':
  default:
    autoRefresh = stale || !hasCachedModels
}

console.log('\n4. Auto-refresh:')
console.log('   - needsInitialDiscovery:', needsInitialDiscovery)
console.log('   - autoRefresh:', autoRefresh)
console.log('   - Motivo:', autoRefresh ? 'Vai fazer refresh' : 'NÃO vai fazer refresh')

// 5. Se não vai fazer refresh, forçar
if (!autoRefresh) {
  console.log('\n5. Forçando discovery...')
  const result = await discoverModelsForRoute(routeId, { forceRefresh: true })
  console.log('   - Source:', result?.source)
  console.log('   - Modelos:', result?.models?.length ?? 0)
  if (result?.models) {
    console.log('   - Lista:', result.models.map(m => m.apiName).join(', '))
  }
}
