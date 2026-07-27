// Test script to simulate /model command flow
import { getRouteDescriptor, resolveActiveRouteIdFromEnv } from './src/integrations/routeMetadata.js'
import { discoverModelsForRoute } from './src/integrations/discoveryService.js'
import { getCachedModels, isCacheStale } from './src/integrations/discoveryCache.js'
import { getDiscoveryCacheKey } from './src/integrations/discoveryService.js'
import { parseDurationString } from './src/integrations/discoveryCache.js'
import { mergeRouteCatalogEntries } from './src/utils/model/routeCatalogOptions.js'
import { buildRouteCatalogModelOptions } from './src/utils/model/routeCatalogOptions.js'

console.log('=== Simulating /model command flow ===\n')

// 1. Get active route ID
const routeId = resolveActiveRouteIdFromEnv(process.env)
console.log('1. Active route ID:', routeId)

if (routeId && routeId !== 'anthropic') {
  const descriptor = getRouteDescriptor(routeId)
  const catalog = descriptor?.catalog
  
  console.log('2. Descriptor found:', Boolean(descriptor))
  console.log('   - Catalog found:', Boolean(catalog))
  console.log('   - Catalog source:', catalog?.source)
  console.log('   - Has discovery:', Boolean(catalog?.discovery))
  console.log('   - Discovery refresh mode:', catalog?.discoveryRefreshMode)
  console.log('   - Static models:', catalog?.models?.length ?? 0)
  
  if (catalog?.discovery) {
    const ttlMs = parseDurationString(catalog.discoveryCacheTtl ?? 0)
    console.log('\n3. Discovery cache config:')
    console.log('   - TTL:', catalog.discoveryCacheTtl, '(', ttlMs, 'ms)')
    
    // Simulate getOpenAIDiscoveryRequestOptions
    const discoveryOptions = {} // Simplified for testing
    const cacheKey = getDiscoveryCacheKey(routeId, discoveryOptions)
    console.log('   - Cache key:', cacheKey)
    
    const cached = await getCachedModels(cacheKey, ttlMs, { includeStale: true })
    const stale = await isCacheStale(cacheKey, ttlMs)
    
    console.log('\n4. Cache state:')
    console.log('   - Has cached models:', cached !== null)
    console.log('   - Cached models count:', cached?.models?.length ?? 0)
    console.log('   - Is stale:', stale)
    
    const staticEntries = catalog.models ?? []
    const mergedEntries = mergeRouteCatalogEntries(
      staticEntries,
      cached?.models ?? [],
    )
    
    console.log('\n5. Merged entries:')
    console.log('   - Static entries:', staticEntries.length)
    console.log('   - Merged entries:', mergedEntries.length)
    console.log('   - Models:', mergedEntries.map(e => e.apiName).join(', '))
    
    // Test discovery
    console.log('\n6. Testing discovery...')
    const result = await discoverModelsForRoute(routeId, {
      forceRefresh: true,
    })
    
    if (result) {
      console.log('   - Discovery source:', result.source)
      console.log('   - Models found:', result.models.length)
      console.log('   - Models:', result.models.map(m => m.apiName).join(', '))
    }
  }
}
