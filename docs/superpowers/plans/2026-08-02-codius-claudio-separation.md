# Codius/Claudio Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create independent `~/codius` Responses→Chat bridge and remove Codius coupling from Claudio.

**Architecture:** Codius is a small Node HTTP server on `127.0.0.1:4890` that accepts OpenAI Responses API, translates to Chat Completions, and forwards to OpenCode using only `~/.codius/`. Claudio drops the `~/.codius` providers fallback.

**Tech Stack:** Node.js (CommonJS), no framework; Node built-in `http`/`https`/`test` runner; PowerShell install shim.

**Spec:** `docs/superpowers/specs/2026-08-02-codius-claudio-separation-design.md`

## Global Constraints

- Codius never reads `~/.claude-native/`
- Claudio never reads `~/.codius/`
- Listen only on `127.0.0.1` (default port 4890)
- Secrets in `~/.codius/.env` only; `providers.json` uses `apiKeyEnv`
- MVP: `/health`, `/v1/models`, `/v1/responses` (stream + non-stream); no HTTPS_PROXY tunnel
- Windows-first paths (`C:\Users\gabdr\codius`)

## File map

| File | Responsibility |
|------|----------------|
| `C:/Users/gabdr/codius/package.json` | package name, bin, test script |
| `C:/Users/gabdr/codius/src/config.js` | load `~/.codius` providers + env |
| `C:/Users/gabdr/codius/src/translate.js` | Responses ↔ Chat |
| `C:/Users/gabdr/codius/src/bridge.js` | HTTP server |
| `C:/Users/gabdr/codius/src/cli.js` | bridge / status / install-config |
| `C:/Users/gabdr/codius/scripts/install.ps1` | PATH shim + seed config |
| `C:/Users/gabdr/codius/test/*.js` | unit + smoke |
| `C:/Users/gabdr/codius/README.md` | usage |
| `claudio/.../lib/provider/resolve.js` | remove `.codius` candidate |
| `claudio/.../SETUP-GUIDE.md`, `STATUS-CLAUDE-FIRST.md` | docs cleanup |

---

### Task 1: Scaffold Codius repo + config loader

**Files:**
- Create: `C:/Users/gabdr/codius/package.json`
- Create: `C:/Users/gabdr/codius/src/config.js`
- Create: `C:/Users/gabdr/codius/test/config.test.js`
- Create: `C:/Users/gabdr/codius/.gitignore`

**Interfaces:**
- Produces: `loadConfig()` → `{ port, codiusApiKey, provider: { name, baseUrl, model, apiKey, models[] } | null, paths }`
- Produces: `CODIUS_HOME` override via env for tests

- [ ] **Step 1: Init repo + package.json**

```json
{
  "name": "codius",
  "version": "0.1.0",
  "private": true,
  "bin": { "codius": "./src/cli.js" },
  "scripts": {
    "start": "node src/cli.js bridge",
    "test": "node --test test/*.js"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2: Write failing config test**

```js
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

describe('loadConfig', () => {
  let dir
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codius-cfg-'))
    process.env.CODIUS_HOME = dir
    fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify({
      active: 'opencode',
      providers: {
        opencode: {
          baseUrl: 'https://opencode.ai/zen/v1',
          model: 'mimo-v2.5-free',
          apiKeyEnv: 'OPENAI_API_KEY',
          models: ['mimo-v2.5-free'],
        },
      },
    }))
    fs.writeFileSync(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-test\nCODIUS_API_KEY=codius-local\n')
  })
  after(() => {
    delete process.env.CODIUS_HOME
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('loads provider from CODIUS_HOME only', () => {
    delete require.cache[require.resolve('../src/config.js')]
    const { loadConfig } = require('../src/config.js')
    const cfg = loadConfig()
    assert.equal(cfg.provider.model, 'mimo-v2.5-free')
    assert.equal(cfg.provider.apiKey, 'sk-test')
    assert.equal(cfg.codiusApiKey, 'codius-local')
    assert.equal(cfg.port, 4890)
  })
})
```

- [ ] **Step 3: Run test — expect FAIL** (`Cannot find module`)

Run: `cd C:\Users\gabdr\codius && node --test test/config.test.js`

- [ ] **Step 4: Implement `src/config.js`**

Parse `providers.json` + dotenv-style `.env` from `process.env.CODIUS_HOME || ~/.codius`. Never open `~/.claude-native`. Port from `CODIUS_PORT` or 4890.

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit** in `~/codius`: `feat: add config loader for ~/.codius`

---

### Task 2: Translate Responses ↔ Chat

**Files:**
- Create: `C:/Users/gabdr/codius/src/translate.js`
- Create: `C:/Users/gabdr/codius/test/translate.test.js`

**Interfaces:**
- Consumes: none from Task 1
- Produces:
  - `responsesRequestToChat(body, defaultModel) → { model, messages, tools?, stream, ... }`
  - `chatCompletionToResponse(chatJson, { model, id }) → responsesObject`
  - `createStreamTranslator({ model, id }) → { onChatChunk(obj), end() → events[] }` emitting Responses SSE event objects

- [ ] **Step 1: Failing tests for string input + non-stream map**

```js
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { responsesRequestToChat, chatCompletionToResponse } = require('../src/translate.js')

describe('translate', () => {
  it('maps string input to user message', () => {
    const out = responsesRequestToChat({ model: 'mimo-v2.5-free', input: 'hi', instructions: 'be brief' }, 'mimo-v2.5-free')
    assert.equal(out.model, 'mimo-v2.5-free')
    assert.deepEqual(out.messages[0], { role: 'system', content: 'be brief' })
    assert.deepEqual(out.messages[1], { role: 'user', content: 'hi' })
  })
  it('maps chat completion to responses object', () => {
    const resp = chatCompletionToResponse({
      id: 'chatcmpl-1',
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
    }, { model: 'mimo-v2.5-free', id: 'resp_1' })
    assert.equal(resp.object, 'response')
    assert.equal(resp.status, 'completed')
    assert.equal(resp.output[0].content[0].text, 'hello')
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement translate.js** (string + message-list input; tools passthrough; stream helper emitting `response.created`, `response.output_text.delta`, tool arg deltas, `response.completed`)

- [ ] **Step 4: Run — PASS** (extend tests for tools if implemented in same task)

- [ ] **Step 5: Commit** `feat: translate Responses to Chat Completions`

---

### Task 3: HTTP bridge

**Files:**
- Create: `C:/Users/gabdr/codius/src/bridge.js`
- Create: `C:/Users/gabdr/codius/test/bridge.smoke.js`

**Interfaces:**
- Consumes: `loadConfig`, translate helpers
- Produces: `startBridge({ config, fetchImpl? }) → { server, port, close() }`

- [ ] **Step 1: Smoke test with mock upstream** (in-process mock http that returns a fixed chat completion)

- [ ] **Step 2: Implement bridge** — auth Bearer `codiusApiKey` if set; `/health`; `/v1/models`; `/v1/responses` stream/non-stream; sanitize upstream errors

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit** `feat: HTTP Responses bridge on :4890`

---

### Task 4: CLI + install script + README

**Files:**
- Create: `C:/Users/gabdr/codius/src/cli.js` (shebang)
- Create: `C:/Users/gabdr/codius/scripts/install.ps1`
- Create: `C:/Users/gabdr/codius/README.md`

**Interfaces:**
- `codius bridge|status|install-config|help`
- `install-config` upserts `[model_providers.codius]` into `~/.codex/config.toml`

- [ ] **Step 1: Implement CLI**
- [ ] **Step 2: install.ps1** seeds `~/.codius` if missing; npm PATH shim `codius.cmd`
- [ ] **Step 3: Manual** `node src/cli.js status` shows paths
- [ ] **Step 4: Commit** `feat: CLI, installer, README`

---

### Task 5: Claudio cleanup

**Files:**
- Modify: `C:/Users/gabdr/claudio/claude-wrapper/lib/provider/resolve.js` — remove `.codius` candidate
- Modify: `C:/Users/gabdr/claudio/claude-wrapper/SETUP-GUIDE.md` — remove fallback wording
- Modify: `C:/Users/gabdr/claudio/claude-wrapper/STATUS-CLAUDE-FIRST.md` — point to `~/codius` repo

- [ ] **Step 1: Remove fallback line from resolve.js**
- [ ] **Step 2: Update docs**
- [ ] **Step 3: Commit in claudio** `chore: decouple Claude provider config from Codius`

---

### Task 6: Wire Codex config + verify smoke

- [ ] **Step 1: Seed `~/.codius`** (providers + `.env` with keys; generate `CODIUS_API_KEY` if missing)
- [ ] **Step 2: `codius install-config`**
- [ ] **Step 3: Start bridge; curl `/health` and a tiny `/v1/responses`** (skip live OpenCode if no key — mock already covered)
- [ ] **Step 4: Confirm Claudio resolve only lists `.claude-native`**

---

## Spec coverage checklist

- Independent `~/codius` repo — Tasks 1–4
- `~/.codius` only — Task 1
- Responses bridge MVP — Tasks 2–3
- CLI/install-config — Task 4
- Claudio cleanup — Task 5
- Success criteria / Codex snippet — Task 6
- Out of scope (Anthropic bridge, HTTPS_PROXY, vision) — not scheduled
