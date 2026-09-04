// claude-wrapper/scripts/test-openrouter-auto-only.js
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const autoRouter = require('../lib/bridge/auto-router')
const { parseModelId } = require('../lib/provider/resolve')

const openrouterOnly = {
  active: 'openrouter',
  providers: {
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      format: 'chat',
      models: ['openrouter/auto', 'openrouter/auto-beta'],
    },
  },
}

describe('openrouter auto-only', () => {
  it('committed providers.json is openrouter-only', () => {
    const fs = require('node:fs')
    const providersPath = path.join(__dirname, '..', 'providers.json')
    const cfg = JSON.parse(fs.readFileSync(providersPath, 'utf8'))
    assert.equal(cfg.active, 'openrouter')
    assert.equal(Object.keys(cfg.providers).length, 1)
    assert.ok(cfg.providers.openrouter)
  })

  it('treats anthropic.auto as Auto', () => {
    assert.equal(autoRouter.isAutoModel('anthropic.auto'), true)
    assert.equal(autoRouter.isAutoModel('auto'), true)
  })

  it('routes Auto exclusively to openrouter/auto', () => {
    const prev = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'test-key-not-real'
    try {
      const routed = autoRouter.routeAutoModel({ model: 'anthropic.auto', messages: [] }, openrouterOnly, {
        log() {},
      })
      assert.equal(routed.provider.name, 'openrouter')
      assert.equal(routed.upstreamModel, 'openrouter/auto')
      assert.notEqual(routed.provider.baseUrl.includes('nvidia.com'), true)
      assert.notEqual(routed.provider.baseUrl.includes('opencode.ai'), true)
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prev
    }
  })

  it('fails fast when OPENROUTER_API_KEY is missing', () => {
    const prev = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY
    try {
      assert.throws(
        () => autoRouter.routeAutoModel({ model: 'auto', messages: [] }, openrouterOnly, { log() {} }),
        /OPENROUTER_API_KEY/,
      )
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev
    }
  })

  it('parseModelId(auto) points at openrouter', () => {
    const parsed = parseModelId('anthropic.auto', openrouterOnly)
    assert.equal(parsed.provider, 'openrouter')
    assert.equal(parsed.model, 'openrouter/auto')
    const friendly = parseModelId('Auto', openrouterOnly)
    assert.equal(friendly.provider, 'openrouter')
    assert.equal(friendly.model, 'openrouter/auto')
  })

  it('catalog exposes only Auto', () => {
    const { listCatalogEntries } = require('../lib/provider/resolve')
    const entries = listCatalogEntries(openrouterOnly)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].id, 'Auto')
    assert.equal(entries[0].display_name, 'Auto')
  })

  it('buildAutoRouterPlugins respects OPENROUTER_COST_TIER', () => {
    const prev = process.env.OPENROUTER_COST_TIER
    process.env.OPENROUTER_COST_TIER = 'max'
    try {
      const plugins = autoRouter.buildAutoRouterPlugins('openrouter/auto')
      assert.deepEqual(plugins, [{ id: 'auto-router', cost_tier: 'max' }])
      const beta = autoRouter.buildAutoRouterPlugins('openrouter/auto-beta')
      assert.equal(beta[0].id, 'auto-beta-router')
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_COST_TIER
      else process.env.OPENROUTER_COST_TIER = prev
    }
  })

  it('buildAutoRouterPlugins returns empty when cost tier unset', () => {
    const prev = process.env.OPENROUTER_COST_TIER
    delete process.env.OPENROUTER_COST_TIER
    delete process.env.AUTO_ROUTER_COST_TIER
    try {
      assert.deepEqual(autoRouter.buildAutoRouterPlugins('openrouter/auto'), [])
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_COST_TIER = prev
    }
  })

  it('resolveVisionInMessages passes images through for openrouter', async () => {
    const { resolveVisionInMessages } = require('../lib/bridge/vision-describer')
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
    ]
    const out = await resolveVisionInMessages(
      messages,
      { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
      { log() {} },
    )
    assert.equal(out[0].content[1].type, 'image_url')
    assert.equal(out[0].content[1].image_url.url, 'data:image/png;base64,abc')
  })
})
