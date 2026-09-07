// claude-wrapper/scripts/test-provider-auto-router.js
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const autoRouter = require('../lib/bridge/auto-router')
const { parseModelId, listCatalogEntries, AUTO_PICKER_ID } = require('../lib/provider/resolve')

const nvidiaCfg = {
  active: 'nvidia',
  providers: {
    nvidia: {
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      apiKeyEnv: 'NVIDIA_API_KEY',
      format: 'chat',
      models: [
        'nvidia/nemotron-3-ultra-550b-a55b',
        'nvidia/nemotron-3-super-120b-a12b',
        'nvidia/nemotron-3.5-lightning-30b-a3b',
        'nvidia/nemotron-3-nano-30b-a3b',
        'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
      ],
    },
  },
}

const opencodeCfg = {
  active: 'opencode',
  providers: {
    opencode: {
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'muse-spark-1.2-contributor-free',
      apiKeyEnv: 'OPENCODE_API_KEY',
      format: 'chat',
      models: ['muse-spark-1.2-contributor-free', 'laguna-s-2.1-free', 'hy3-free', 'big-pickle'],
    },
  },
}

describe('provider-agnostic auto router', () => {
  it('routes Auto on nvidia catalog to Super/Ultra for coding', () => {
    const prev = process.env.NVIDIA_API_KEY
    process.env.NVIDIA_API_KEY = 'test-key'
    try {
      const routed = autoRouter.routeAutoModel(
        { model: 'auto', messages: [{ role: 'user', content: 'fix this TypeScript bug' }], tools: [{ name: 'Read' }] },
        nvidiaCfg,
        { log() {} },
      )
      assert.equal(routed.provider.name, 'nvidia')
      assert.equal(routed.tier, 'coding')
      assert.match(routed.upstreamModel, /super|ultra/i)
      assert.equal(routed.fallbackCascade.every((m) => m.startsWith('nvidia/')), true)
    } finally {
      if (prev === undefined) delete process.env.NVIDIA_API_KEY
      else process.env.NVIDIA_API_KEY = prev
    }
  })

  it('routes Auto on opencode catalog without calling nvidia', () => {
    const prev = process.env.OPENCODE_API_KEY
    process.env.OPENCODE_API_KEY = 'test-key'
    try {
      const routed = autoRouter.routeAutoModel(
        { model: 'anthropic.auto', messages: [{ role: 'user', content: 'oi' }] },
        opencodeCfg,
        { log() {} },
      )
      assert.equal(routed.provider.name, 'opencode')
      assert.equal(routed.provider.baseUrl.includes('opencode.ai'), true)
      assert.equal(routed.fallbackCascade.every((m) => !m.includes('nvidia')), true)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_API_KEY
      else process.env.OPENCODE_API_KEY = prev
    }
  })

  it('classifies codebase analysis as hard', () => {
    assert.equal(
      autoRouter.classifyTier({
        messages: [{ role: 'user', content: 'analise esse codebase e crie um CLAUDE.md' }],
      }),
      'hard',
    )
  })

  it('parseModelId(auto) follows active provider', () => {
    assert.equal(parseModelId('anthropic.auto', opencodeCfg).provider, 'opencode')
    assert.equal(parseModelId('anthropic.openrouter.openrouter-auto', nvidiaCfg).provider, 'nvidia')
  })

  it('catalog exposes only Auto', () => {
    const entries = listCatalogEntries(nvidiaCfg)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].id, AUTO_PICKER_ID)
  })

  it('committed providers.json example is valid nvidia catalog', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'providers.json'), 'utf8'))
    assert.ok(cfg.providers[cfg.active])
    assert.ok(Array.isArray(cfg.providers[cfg.active].models))
    assert.ok(cfg.providers[cfg.active].models.length >= 2)
  })
})
