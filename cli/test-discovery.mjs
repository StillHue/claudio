// Test script to verify dashscope-intl discovery
import { listOpenAICompatibleModels } from './dist/cli.mjs'

const baseUrl = 'https://coding-intl.dashscope.aliyuncs.com/v1'
const apiKey = process.env.DASHSCOPE_API_KEY

console.log('Testing dashscope-intl discovery...')
console.log('Base URL:', baseUrl)
console.log('Has API Key:', Boolean(apiKey))

try {
  const models = await listOpenAICompatibleModels({
    baseUrl,
    apiKey,
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  
  console.log('Models found:', models?.length ?? 0)
  console.log('Models:', models)
} catch (error) {
  console.error('Error:', error.message)
}
