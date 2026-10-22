const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { applySetup, renderPage, validate } = require('../provider-ui')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-setup-'))
const envFile = path.join(dir, '.env')
fs.writeFileSync(envFile, 'OTHER=1\n', 'utf8')

assert.strictEqual(typeof validate({ id: 'nvidia', baseUrl: 'https://x/v1', model: '', apiKeyEnv: 'K', apiKey: 's' }), 'string')
const fields = validate({
  id: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1/',
  model: 'nvidia/nemotron',
  apiKeyEnv: 'NVIDIA_API_KEY',
  apiKey: 'secret value',
})
applySetup(fields, { wrapperDir: dir, envFile })
const saved = JSON.parse(fs.readFileSync(path.join(dir, 'providers.json'), 'utf8'))
assert.strictEqual(saved.active, 'nvidia')
assert.strictEqual(saved.providers.nvidia.model, 'nvidia/nemotron')
assert.strictEqual(saved.providers.nvidia.apiKey, undefined)
const env = fs.readFileSync(envFile, 'utf8')
assert.ok(env.includes('OTHER=1'))
assert.ok(env.includes('NVIDIA_API_KEY="secret value"'))
const html = renderPage({ id: '', baseUrl: '', model: '', apiKeyEnv: '' })
assert.ok(html.includes('<form'))
assert.ok(html.includes('name="model"'))
console.log('provider setup: OK')
