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
    // also ensure providers entry has no inline apiKey
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
})