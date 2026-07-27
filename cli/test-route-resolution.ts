// Verificar por que dashscope-intl não está sendo reconhecido
import { resolveActiveRouteIdFromEnv } from './src/integrations/routeMetadata.js'

console.log('=== Verificando route resolution ===\n')

console.log('Variáveis de ambiente relevantes:')
console.log('  DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? 'SET' : 'NOT SET')
console.log('  ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET')
console.log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET')
console.log('  CLAUDE_CODE_USE_OPENAI:', process.env.CLAUDE_CODE_USE_OPENAI ?? 'NOT SET')
console.log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL ?? 'NOT SET')

console.log('\nResolução da route:')
const routeId = resolveActiveRouteIdFromEnv(process.env)
console.log('  Route ativa:', routeId)

// Testar hasDashscopeIntlEnvOnlyProviderIntent
import { hasDashscopeIntlEnvOnlyProviderIntent } from './src/integrations/routeMetadata.js'
const hasIntent = hasDashscopeIntlEnvOnlyProviderIntent(process.env)
console.log('\nhasDashscopeIntlEnvOnlyProviderIntent:', hasIntent)
