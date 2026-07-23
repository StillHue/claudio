import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'cohere',
  label: 'Cohere',
  category: 'aggregating',
  defaultBaseUrl: 'https://api.cohere.com/compatibility/v1',
  defaultModel: 'command-r-plus',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['COHERE_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      removeBodyFields: ['store', 'reasoning_effort'],
    },
  },
  preset: {
    id: 'cohere',
    description: 'Cohere OpenAI-compatible endpoint',
    apiKeyEnvVars: ['COHERE_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      mapModel(raw: unknown) {
        const model = raw as { id?: string }
        if (!model.id) return null
        if (/(embed|rerank|classify|cluster|detect|tokenize|detokenize|train|finetune)/i.test(model.id)) {
          return null
        }
        return {
          id: model.id,
          apiName: model.id,
          label: model.id,
        }
      },
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [],
  },
  usage: { supported: false },
})
