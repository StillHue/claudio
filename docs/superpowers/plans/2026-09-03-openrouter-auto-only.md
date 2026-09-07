# OpenRouter Auto Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make picker model `Auto` resolve exclusively to OpenRouter Auto Router (`openrouter/auto`), with no local nvidia/opencode execution on the Auto path.

**Architecture:** Slim the wrapper to a thin Anthropic Messages → OpenRouter chat bridge. Alias resolution and `cost_tier` plugins stay local; task classification, sticky, vision/coding routing, and failover live on OpenRouter (NVIDIA via account BYOK).

**Tech Stack:** Node.js CommonJS, `@openrouter/sdk` (optional for future; primary path remains `fetch` in `messages-chat.js`), `node:test`, PowerShell env on Windows.

**Spec:** `docs/superpowers/specs/2026-09-03-openrouter-auto-only-design.md`

## Global Constraints

- Auto path must never call `opencode.ai` or `integrate.api.nvidia.com` directly
- Missing `OPENROUTER_API_KEY` fails fast with a clear error (no silent local fallback)
- `providers.json` active provider is `openrouter` only for this migration
- Default cost tier when unset: OpenRouter default (`low`-equivalent); send plugin only when `OPENROUTER_COST_TIER` is set and valid
- Secrets stay in `.env` / `apiKeyEnv`; never commit keys
- Conventional commits (`feat`, `fix`, `test`, `docs`, `chore`)

## File map

| File | Responsibility |
|------|----------------|
| `claude-wrapper/providers.json` | openrouter-only runtime catalog |
| `~/.claude-native/providers.json` | synced native copy (written by sync / migration) |
| `claude-wrapper/lib/bridge/auto-router.js` | Auto → openrouter/auto only (delete local routeLocal cascade) |
| `claude-wrapper/lib/bridge/messages.js` | always use openrouter route for Auto aliases |
| `claude-wrapper/lib/bridge/messages-chat.js` | attach OpenRouter `plugins` + session id; log upstream `model` |
| `claude-wrapper/lib/provider/resolve.js` | Auto parse → openrouter; hardcode fallback = openrouter |
| `claude-wrapper/lib/provider/display.js` | Auto / openrouter display copy |
| `claude-wrapper/lib/provider/sync.js` | default model sync for openrouter/auto |
| `claude-wrapper/scripts/test-openrouter-auto-only.js` | unit tests for alias + plugins + no-local-fallback |
| `docs/superpowers/specs/2026-09-03-openrouter-auto-only-design.md` | already written; commit if not committed |

---

### Task 1: Commit the approved design spec

**Files:**
- Add: `docs/superpowers/specs/2026-09-03-openrouter-auto-only-design.md`

**Interfaces:**
- None

- [ ] **Step 1: Stage and commit only the spec**

```bash
cd C:/Users/gabdr/claudio
git add docs/superpowers/specs/2026-09-03-openrouter-auto-only-design.md
git commit -m "$(cat <<'EOF'
docs: add OpenRouter Auto-only design spec

EOF
)"
```

On PowerShell if heredoc fails:

```powershell
cd C:\Users\gabdr\claudio
git add docs/superpowers/specs/2026-09-03-openrouter-auto-only-design.md
git commit -m "docs: add OpenRouter Auto-only design spec"
```

- [ ] **Step 2: Verify**

```bash
git status
git log -1 --oneline
```

Expected: clean regarding that file; latest commit is the docs commit.

---

### Task 2: Unit tests for Auto → OpenRouter-only resolution

**Files:**
- Create: `claude-wrapper/scripts/test-openrouter-auto-only.js`
- Modify (later tasks): `claude-wrapper/lib/bridge/auto-router.js`, `claude-wrapper/lib/provider/resolve.js`

**Interfaces:**
- Consumes: `isAutoModel(name)`, `routeAutoModel(body, providersData, ctx)`, `parseModelId(id, data)`, `buildAutoRouterPlugins(model)`
- Produces: failing tests that define the target API

- [ ] **Step 1: Write the failing test file**

```js
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
```

- [ ] **Step 2: Run tests (expect failures)**

```bash
cd C:/Users/gabdr/claudio/claude-wrapper
node --test scripts/test-openrouter-auto-only.js
```

Expected: FAIL — `buildAutoRouterPlugins` missing and/or Auto still routes via `routeLocal` to nvidia/opencode; `parseModelId` still returns `active`/`auto`.

---

### Task 3: Slim `auto-router.js` to OpenRouter-only

**Files:**
- Modify: `claude-wrapper/lib/bridge/auto-router.js` (replace local cascade with thin resolver)

**Interfaces:**
- Produces:
  - `isAutoModel(modelName): boolean`
  - `isOpenRouterModel(modelName): boolean`
  - `buildAutoRouterPlugins(modelName): Array<{id, cost_tier, allowed_models?, excluded_models?}>`
  - `routeAutoModel(body, providersData, ctx): { provider, upstreamModel, upstreamFormat, tier, openRouterPlugins }`
  - `routeAutoModelAsync` — same as sync (keep for callers)

- [ ] **Step 1: Replace implementation with OpenRouter-only router**

Keep file path. Remove `routeLocal`, complexity scoring, session sticky Map, and nvidia/opencode candidate lists. New body (full file intent):

```js
const { resolveProvider, resolveApiKey, loadProvidersConfig } = require('../provider/resolve')
const { loadNativeEnvFiles } = require('../wrapper/env')

loadNativeEnvFiles()

const COST_TIERS = ['low', 'medium', 'high', 'xhigh', 'max']

function isAutoModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return (
    lower === 'auto' ||
    lower === 'anthropic.auto' ||
    lower === 'claude-auto' ||
    lower === 'auto-router' ||
    lower.endsWith('.auto')
  )
}

function isOpenRouterModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false
  const lower = modelName.toLowerCase().trim()
  return lower.startsWith('openrouter/')
}

function getCostTierOrNull() {
  const raw = process.env.OPENROUTER_COST_TIER || process.env.AUTO_ROUTER_COST_TIER
  if (!raw) return null
  const t = String(raw).toLowerCase().trim()
  if (!COST_TIERS.includes(t)) {
    console.warn(`[auto-router] invalid cost_tier="${raw}", ignoring plugin`)
    return null
  }
  return t
}

function buildAutoRouterPlugins(modelName) {
  const costTier = getCostTierOrNull()
  if (!costTier) return []
  const model = String(modelName || 'openrouter/auto')
  const plugin = {
    id: model.includes('beta') ? 'auto-beta-router' : 'auto-router',
    cost_tier: costTier,
  }
  const allowed = process.env.OPENROUTER_ALLOWED_MODELS
  if (allowed) plugin.allowed_models = allowed.split(',').map((s) => s.trim()).filter(Boolean)
  const excluded = process.env.OPENROUTER_EXCLUDED_MODELS
  if (excluded) plugin.excluded_models = excluded.split(',').map((s) => s.trim()).filter(Boolean)
  return [plugin]
}

function routeAutoModel(body, providersData, ctx) {
  const data = providersData || loadProvidersConfig().data
  const entry = data.providers?.openrouter
  if (!entry) {
    throw new Error('Provider openrouter não configurado em providers.json')
  }
  const apiKey = resolveApiKey(entry)
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY não configurada — defina em .env do wrapper ou ~/.claude-native/.env')
  }

  let upstreamModel = 'openrouter/auto'
  if (body?.model && isOpenRouterModel(body.model)) {
    upstreamModel = body.model
  }

  const resolved = resolveProvider(data, upstreamModel)
  const provider = {
    ...resolved,
    name: 'openrouter',
    baseUrl: entry.baseUrl || resolved.baseUrl,
    apiKey,
    format: entry.format || 'chat',
  }
  const openRouterPlugins = buildAutoRouterPlugins(upstreamModel)
  ctx?.log?.(
    `[auto-router] → openrouter/${upstreamModel} plugins=${JSON.stringify(openRouterPlugins)}`,
  )
  return {
    provider,
    upstreamModel,
    upstreamFormat: provider.format || 'chat',
    tier: 'openrouter',
    openRouterPlugins,
  }
}

async function routeAutoModelAsync(body, providersData, ctx) {
  return routeAutoModel(body, providersData, ctx)
}

module.exports = {
  isAutoModel,
  isOpenRouterModel,
  buildAutoRouterPlugins,
  routeAutoModel,
  routeAutoModelAsync,
}
```

Ensure `resolveProvider` / `resolveApiKey` still read `OPENROUTER_API_KEY` from env (existing behavior). If `resolveApiKey` only reads `apiKeyEnv` from entry, keep `apiKeyEnv: "OPENROUTER_API_KEY"` in providers.json.

- [ ] **Step 2: Wire messages.js so Auto always uses the openrouter route**

In `claude-wrapper/lib/bridge/messages.js`, change the Auto branch so both Auto and OpenRouter models call the same router (prefer async always):

```js
  if (isAutoModel(body.model) || isOpenRouterModel(body.model)) {
    const data = typeof ctx.getProvidersData === 'function' ? ctx.getProvidersData() : null
    let routed
    try {
      routed = await routeAutoModelAsync(body, data, ctx)
    } catch (err) {
      return json(res, 401, {
        type: 'error',
        error: { type: 'authentication_error', message: err.message },
      })
    }
    provider = routed.provider
    upstreamModel = routed.upstreamModel
    upstreamFormat = routed.upstreamFormat
    // stash plugins for chat handler
    body.__openRouterPlugins = routed.openRouterPlugins || []
    body.__openRouterSessionId = body.session_id || body.sessionId || null
  } else {
```

- [ ] **Step 3: Re-run unit tests**

```bash
cd C:/Users/gabdr/claudio/claude-wrapper
node --test scripts/test-openrouter-auto-only.js
```

Expected: Auto routing + plugins tests PASS; `parseModelId` may still FAIL until Task 4.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\gabdr\claudio
git add claude-wrapper/lib/bridge/auto-router.js claude-wrapper/lib/bridge/messages.js claude-wrapper/scripts/test-openrouter-auto-only.js
git commit -m "feat(claude-wrapper): route Auto exclusively via OpenRouter"
```

---

### Task 4: providers.json + resolve/parse/sync openrouter-only

**Files:**
- Modify: `claude-wrapper/providers.json`
- Modify: `claude-wrapper/lib/provider/resolve.js` (`parseModelId` Auto branch + hardcoded fallback)
- Modify: `claude-wrapper/lib/provider/display.js` (Auto description)
- Modify: `claude-wrapper/lib/provider/sync.js` only if default id logic still prefers opencode/nvidia

**Interfaces:**
- Produces: `parseModelId('anthropic.auto', data) → { provider: 'openrouter', model: 'openrouter/auto' }`
- Produces: `loadProvidersConfig` fallback data uses openrouter, not opencode

- [ ] **Step 1: Rewrite `claude-wrapper/providers.json`**

```json
{
  "active": "openrouter",
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "openrouter/auto",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "tools": true,
      "format": "chat",
      "models": [
        "openrouter/auto",
        "openrouter/auto-beta"
      ]
    }
  }
}
```

- [ ] **Step 2: Fix `parseModelId` Auto branch and hardcoded fallback**

In `resolve.js`:

```js
  if (lower === 'auto' || lower === 'anthropic.auto' || lower === 'claude-auto') {
    return { provider: 'openrouter', model: 'openrouter/auto' }
  }
```

Replace the `providers.json not found` fallback object so `active: 'openrouter'` and only the openrouter provider block (same shape as providers.json above). Remove the opencode hardcoded fallback.

Update `listCatalogEntries` Auto description string to:

```js
description: 'OpenRouter Auto Router — classifies the task and routes across models (BYOK providers on your OpenRouter account)',
```

In `display.js`, ensure `'openrouter/auto'` DISPLAY name stays `Auto (OpenRouter)` or `Auto` — prefer picker-facing `Auto` for the catalog entry already named Auto via `anthropic.auto`.

- [ ] **Step 3: Sync native copy**

Run existing sync entrypoint if present:

```bash
cd C:/Users/gabdr/claudio/claude-wrapper
node set-default-model.js openrouter/auto
```

Or call `syncDefaultModel` via a one-liner that loads providers and syncs. Confirm `~/.claude-native/providers.json` matches openrouter-only (no nvidia/opencode keys).

- [ ] **Step 4: Re-run tests**

```bash
node --test scripts/test-openrouter-auto-only.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add claude-wrapper/providers.json claude-wrapper/lib/provider/resolve.js claude-wrapper/lib/provider/display.js claude-wrapper/lib/provider/sync.js
git commit -m "feat(claude-wrapper): openrouter-only providers catalog for Auto"
```

---

### Task 5: Attach OpenRouter plugins + log resolved model in chat bridge

**Files:**
- Modify: `claude-wrapper/lib/bridge/messages-chat.js`
- Modify: `claude-wrapper/scripts/test-openrouter-auto-only.js` (add plugin attachment helper test if extracted)

**Interfaces:**
- Consumes: `body.__openRouterPlugins`, `body.__openRouterSessionId`
- Produces: chat completion JSON including `plugins` when non-empty; logs `upstream-resolved-model=…` from response `model` field when present

- [ ] **Step 1: After building `chatBody` in `handleChat`, attach plugins/session**

```js
  if (Array.isArray(body.__openRouterPlugins) && body.__openRouterPlugins.length) {
    chatBody.plugins = body.__openRouterPlugins
  }
  if (body.__openRouterSessionId) {
    chatBody.session_id = body.__openRouterSessionId
  }
```

Also set OpenRouter attribution headers when `provider.name === 'openrouter'`:

```js
  if (provider.name === 'openrouter') {
    headers['HTTP-Referer'] =
      process.env.OPENROUTER_HTTP_REFERER || 'https://github.com/StillHue/claudio'
    headers['X-Title'] = process.env.OPENROUTER_APP_TITLE || 'claudio-wrapper'
  }
```

- [ ] **Step 2: Log resolved model from non-stream JSON responses**

Where non-stream OpenAI JSON is parsed, after success:

```js
  if (provider.name === 'openrouter' && data?.model) {
    ctx.log?.(`[openrouter] resolved model=${data.model}`)
  }
```

For streams, if the first chunk or final payload includes `model`, log once. If stream path does not expose it easily, logging non-stream + request `upstreamModel=openrouter/auto` is enough for v1.

- [ ] **Step 3: Manual smoke (requires real key)**

1. Ensure `claude-wrapper/.env` has non-empty `OPENROUTER_API_KEY`.
2. Start wrapper / use existing shim.
3. Send a trivial Messages request with `model: "anthropic.auto"`.
4. Confirm log line hits `openrouter.ai` and not nvidia/opencode hosts.

- [ ] **Step 4: Commit**

```powershell
git add claude-wrapper/lib/bridge/messages-chat.js claude-wrapper/scripts/test-openrouter-auto-only.js
git commit -m "feat(claude-wrapper): pass OpenRouter auto-router plugins on Auto chat"
```

---

### Task 6: Docs touch + migration checklist

**Files:**
- Modify: `claude-wrapper/ARCHITECTURE.md` (short note: Auto = OpenRouter only)
- Optionally add a short section to an existing README if one still exists; do not recreate deleted guides unless needed

**Interfaces:**
- None

- [ ] **Step 1: Update ARCHITECTURE.md** with 5–10 lines:

```markdown
## Auto model

`Auto` / `anthropic.auto` always routes to OpenRouter (`openrouter/auto`).
Classification, sticky multi-turn, vision vs coding, and rate-limit fallbacks are handled by OpenRouter Auto Router.
NVIDIA is used via OpenRouter BYOK on the account — the wrapper does not call NVIDIA or OpenCode directly on the Auto path.
Required: `OPENROUTER_API_KEY`. Optional: `OPENROUTER_COST_TIER`.
```

- [ ] **Step 2: User migration checklist (run, do not commit secrets)**

1. Put `OPENROUTER_API_KEY=...` in `claude-wrapper/.env` and/or `~/.claude-native/.env`
2. Confirm BYOK NVIDIA still enabled on openrouter.ai
3. Replace `~/.claude-native/providers.json` via sync (`node set-default-model.js openrouter/auto`)
4. Restart Claude Code / Cursor shims
5. Same chat: image ask → then coding ask; keep Auto selected; check logs for resolved models

- [ ] **Step 3: Commit docs + plan**

```powershell
git add claude-wrapper/ARCHITECTURE.md docs/superpowers/plans/2026-09-03-openrouter-auto-only.md
git commit -m "docs: document OpenRouter-only Auto path and implementation plan"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Auto → `openrouter/auto` | 2, 3, 4 |
| Only OpenRouter execution | 3, 4, 5 |
| Remove nvidia/opencode from Auto path | 3, 4 |
| `OPENROUTER_API_KEY` required / fail fast | 2, 3 |
| Optional `cost_tier` plugin | 2, 3, 5 |
| Session id forward | 3, 5 |
| Log resolved model | 5 |
| Sync picker default | 4 |
| No local failover cascade | 3 |
| Migration + smoke | 6 |
| Design doc committed | 1 |

## Placeholder / consistency check

- No TBD steps
- `buildAutoRouterPlugins` / `routeAutoModel` names consistent across tasks 2–5
- Plugins attached on the **fetch chat body**, not only returned from the router (Task 5), because `messages-chat.js` is the actual upstream caller today
