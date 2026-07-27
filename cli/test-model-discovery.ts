// Test script to verify dashscope-intl discovery in the actual claudio context
import { loadDescriptorDiscoveryContext } from './src/commands/model/model.tsx'

console.log('=== Testing loadDescriptorDiscoveryContext ===\n')

try {
  const context = await loadDescriptorDiscoveryContext('dashscope-intl')
  
  if (context) {
    console.log('\n✓ Discovery context loaded successfully')
    console.log('  - kind:', context.kind)
    console.log('  - routeId:', context.routeId)
    console.log('  - routeLabel:', context.routeLabel)
    console.log('  - autoRefresh:', context.autoRefresh)
    console.log('  - canRefresh:', context.canRefresh)
    console.log('  - optionsOverride count:', context.optionsOverride?.length ?? 0)
    if (context.optionsOverride && context.optionsOverride.length > 0) {
      console.log('  - First 5 models:', context.optionsOverride.slice(0, 5).map(o => o.value).join(', '))
    }
  } else {
    console.log('\n✗ Discovery context returned null')
  }
} catch (error) {
  console.error('\n✗ Error loading discovery context:', error.message)
  console.error(error.stack)
}
