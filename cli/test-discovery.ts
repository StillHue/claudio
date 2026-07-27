// Test script to verify dashscope-intl discovery
import { getRouteDescriptor, resolveRouteCredentialValue } from './src/integrations/routeMetadata.js'
import { listOpenAICompatibleModels } from './src/utils/providerDiscovery.js'
import { firstUsableCredential } from './src/services/api/credentialPool.js'

const routeId = 'dashscope-intl'

console.log('=== Testing dashscope-intl discovery ===\n')

// 1. Check route descriptor
const descriptor = getRouteDescriptor(routeId)
console.log('1. Route descriptor:', descriptor ? 'Found' : 'NOT FOUND')
if (descriptor) {
  console.log('   - Label:', descriptor.label)
  console.log('   - Default base URL:', descriptor.defaultBaseUrl)
  console.log('   - Catalog source:', descriptor.catalog?.source)
  console.log('   - Has discovery:', Boolean(descriptor.catalog?.discovery))
  console.log('   - Discovery kind:', descriptor.catalog?.discovery?.kind)
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
console.log('\n3. Testing discovery...')
const baseUrl = descriptor?.defaultBaseUrl
if (baseUrl && apiKey) {
  try {
    const models = await listOpenAICompatibleModels({
      baseUrl,
      apiKey,
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })
    console.log('   - Models found:', models?.length ?? 0)
    if (models && models.length > 0) {
      console.log('   - Models:', models.join(', '))
    }
  } catch (error) {
    console.log('   - Error:', error.message)
  }
} else {
  console.log('   - Cannot test: missing baseUrl or apiKey')
}
