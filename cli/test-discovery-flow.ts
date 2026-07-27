// Test script to verify dashscope-intl discovery flow
import { getRouteDescriptor } from './src/integrations/routeMetadata.js'
import { discoverModelsForRoute } from './src/integrations/discoveryService.js'
import { resolveRouteCredentialValue } from './src/integrations/routeMetadata.js'
import { firstUsableCredential } from './src/services/api/credentialPool.js'

console.log('=== Testing dashscope-intl discovery flow ===\n')

const routeId = 'dashscope-intl'

// 1. Check route descriptor
const descriptor = getRouteDescriptor(routeId)
console.log('1. Route descriptor:', descriptor ? 'Found' : 'NOT FOUND')
if (descriptor) {
  console.log('   - Label:', descriptor.label)
  console.log('   - Catalog source:', descriptor.catalog?.source)
  console.log('   - Has discovery:', Boolean(descriptor.catalog?.discovery))
  console.log('   - Discovery kind:', descriptor.catalog?.discovery?.kind)
  console.log('   - Discovery cache TTL:', descriptor.catalog?.discoveryCacheTtl)
  console.log('   - Allow manual refresh:', descriptor.catalog?.allowManualRefresh)
  console.log('   - Static models:', descriptor.catalog?.models?.length ?? 0)
}

// 2. Check API key resolution
const apiKey = firstUsableCredential(
  resolveRouteCredentialValue({
    routeId,
    processEnv: process.env,
  }),
)
console.log('\n2. API key resolution:')
console.log('   - DASHSCOPE_API_KEY env:', process.env.DASHSCOPE_API_KEY ? 'Set' : 'NOT SET')
console.log('   - Resolved API key:', apiKey ? 'Found' : 'NOT FOUND')

// 3. Test discovery
console.log('\n3. Testing discoverModelsForRoute...')
try {
  const result = await discoverModelsForRoute(routeId, {
    forceRefresh: true,
  })
  
  if (result) {
    console.log('   - Discovery result:')
    console.log('     - routeId:', result.routeId)
    console.log('     - source:', result.source)
    console.log('     - stale:', result.stale)
    console.log('     - models count:', result.models.length)
    console.log('     - discoveredModelCount:', result.discoveredModelCount)
    console.log('     - error:', result.error?.message ?? 'none')
    if (result.models.length > 0) {
      console.log('     - Models:', result.models.slice(0, 10).map(m => m.apiName).join(', '))
    }
  } else {
    console.log('   - Discovery returned null')
  }
} catch (error) {
  console.log('   - Error:', error.message)
  console.log('   - Stack:', error.stack)
}
