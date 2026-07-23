import { defineVendor } from '../define.js'

export default defineVendor({
  id: 'gemini',
  label: 'Google AI / Gemini',
  classification: 'native',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  defaultModel: 'gemini-3-flash-preview',
  requiredEnvVars: ['GEMINI_API_KEY'],
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['GEMINI_API_KEY'],
  },
  transportConfig: {
    kind: 'gemini-native',
    openaiShim: {
      removeBodyFields: ['store'],
    },
  },
  preset: {
    id: 'gemini',
    description: 'Google AI / Gemini OpenAI-compatible endpoint',
    apiKeyEnvVars: ['GEMINI_API_KEY'],
  },
  validation: {
    kind: 'gemini-credential',
    routing: {
      enablementEnvVar: 'CLAUDE_CODE_USE_GEMINI',
    },
    missingCredentialMessage:
      'GEMINI_API_KEY, GOOGLE_API_KEY, GEMINI_ACCESS_TOKEN, or Google ADC credentials are required when CLAUDE_CODE_USE_GEMINI=1.',
  },
  catalog: {
    source: 'static',
    models: [
      { id: 'gemini-3-flash-preview', apiName: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { id: 'gemini-2.5-flash', apiName: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', apiName: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', apiName: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-3.5-flash', apiName: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-flash-lite', apiName: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { id: 'gemini-3.1-pro', apiName: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
      { id: 'gemini-3.1-pro-preview', apiName: 'google/gemini-3.1-pro-preview', label: 'Google Gemini 3.1 Pro Preview' },
      { id: 'gemini-3.1-flash-lite-preview', apiName: 'google/gemini-3.1-flash-lite', label: 'Google Gemini 3.1 Flash Lite' },
      { id: 'gemini-2.5-pro-preview', apiName: 'google/gemini-2.5-pro', label: 'Google Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash-preview', apiName: 'google/gemini-2.0-flash', label: 'Google Gemini 2.0 Flash' },
      { id: 'gemma-4-26b-a4b-it', apiName: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B' },
      { id: 'gemma-4-31b-it', apiName: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
    ],
  },
  usage: { supported: false },
})
