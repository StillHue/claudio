// Testar as condições individuais
import { hasNonEmptyEnvValue, hasConflictingOpenAIBaseUrlForRoute, hasNoExplicitNonOpenAICompatibleProvider, isDashscopeIntlBaseUrl } from './src/integrations/routeMetadata.js'

console.log('=== Testando condições individuais ===\n')

console.log('1. hasNonEmptyEnvValue(DASHSCOPE_API_KEY):', hasNonEmptyEnvValue(process.env.DASHSCOPE_API_KEY))
console.log('2. hasNonEmptyEnvValue(XAI_API_KEY):', hasNonEmptyEnvValue(process.env.XAI_API_KEY))
console.log('3. hasNonEmptyEnvValue(MINIMAX_API_KEY):', hasNonEmptyEnvValue(process.env.MINIMAX_API_KEY))
console.log('4. hasNonEmptyEnvValue(VENICE_API_KEY):', hasNonEmptyEnvValue(process.env.VENICE_API_KEY))
console.log('5. hasNonEmptyEnvValue(MIMO_API_KEY):', hasNonEmptyEnvValue(process.env.MIMO_API_KEY))
console.log('6. hasNonEmptyEnvValue(NEARAI_API_KEY):', hasNonEmptyEnvValue(process.env.NEARAI_API_KEY))
console.log('7. hasNonEmptyEnvValue(FIREWORKS_API_KEY):', hasNonEmptyEnvValue(process.env.FIREWORKS_API_KEY))
console.log('8. hasNonEmptyEnvValue(CLINE_API_KEY):', hasNonEmptyEnvValue(process.env.CLINE_API_KEY))

console.log('\n9. OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL)
console.log('10. isDashscopeIntlBaseUrl(OPENAI_BASE_URL):', isDashscopeIntlBaseUrl(process.env.OPENAI_BASE_URL))
console.log('11. hasConflictingOpenAIBaseUrlForRoute:', hasConflictingOpenAIBaseUrlForRoute(process.env, isDashscopeIntlBaseUrl))
console.log('12. hasNoExplicitNonOpenAICompatibleProvider:', hasNoExplicitNonOpenAICompatibleProvider(process.env))
