// Testar hasDashscopeIntlEnvOnlyProviderIntent
import { hasDashscopeIntlEnvOnlyProviderIntent, resolveActiveRouteIdFromEnv } from './src/integrations/routeMetadata.js'

console.log('=== Testando hasDashscopeIntlEnvOnlyProviderIntent ===\n')

console.log('Variáveis de ambiente:')
console.log('  DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? 'SET' : 'NOT SET')
console.log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL ?? 'NOT SET')
console.log('  XAI_API_KEY:', process.env.XAI_API_KEY ? 'SET' : 'NOT SET')
console.log('  MINIMAX_API_KEY:', process.env.MINIMAX_API_KEY ? 'SET' : 'NOT SET')
console.log('  VENICE_API_KEY:', process.env.VENICE_API_KEY ? 'SET' : 'NOT SET')
console.log('  MIMO_API_KEY:', process.env.MIMO_API_KEY ? 'SET' : 'NOT SET')
console.log('  NEARAI_API_KEY:', process.env.NEARAI_API_KEY ? 'SET' : 'NOT SET')
console.log('  FIREWORKS_API_KEY:', process.env.FIREWORKS_API_KEY ? 'SET' : 'NOT SET')
console.log('  CLINE_API_KEY:', process.env.CLINE_API_KEY ? 'SET' : 'NOT SET')

console.log('\nResultado:')
const hasIntent = hasDashscopeIntlEnvOnlyProviderIntent(process.env)
console.log('  hasDashscopeIntlEnvOnlyProviderIntent:', hasIntent)

const routeId = resolveActiveRouteIdFromEnv(process.env)
console.log('  resolveActiveRouteIdFromEnv:', routeId)
