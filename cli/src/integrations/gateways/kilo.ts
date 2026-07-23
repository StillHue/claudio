import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'kilo',
  label: 'Kilo Gateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.kilo.ai/api/gateway',
  defaultModel: 'kilo-auto/free',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['KILO_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
    },
  },
  preset: {
    id: 'kilo',
    description: 'Kilo Gateway OpenAI-compatible endpoint',
    apiKeyEnvVars: ['KILO_API_KEY'],
    baseUrlEnvVars: ['KILO_BASE_URL', 'OPENAI_BASE_URL'],
    modelEnvVars: ['KILO_MODEL'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      {
        id: 'kilo-auto/free',
        apiName: 'kilo-auto/free',
        label: 'Kilo Auto Free',
        capabilities: { supportsReasoning: true },
      },
      {
        id: 'kilo-auto/efficient',
        apiName: 'kilo-auto/efficient',
        label: 'Kilo Auto Efficient',
        capabilities: { supportsReasoning: true },
      },
      {
        id: 'kilo-auto/balanced',
        apiName: 'kilo-auto/balanced',
        label: 'Kilo Auto Balanced',
        capabilities: { supportsReasoning: true },
      },
      {
        id: 'kilo-auto/frontier',
        apiName: 'kilo-auto/frontier',
        label: 'Kilo Auto Frontier',
        capabilities: { supportsReasoning: true },
      },
    ],
  },
  usage: { supported: false },
})
