# Codius ↔ Claudio separation

Date: 2026-08-02  
Status: approved (design dialogue)  
Approach: independent Codius Responses bridge + Claudio cleanup

## Goal

Split Codex bridging (Codius) from Claude Code wrapping (Claudio) into separate products and configs. Zero shared provider files. Codex talks Responses to a local Codius gateway; Claude keeps its Anthropic bridge unchanged.

## Boundaries

| Product | Path | Owns | Does not touch |
|---------|------|------|----------------|
| Claudio | `~/claudio` (existing) | Claude Code process wrapper, Anthropic→Chat bridge, `~/.claude-native/` | Codex, `~/.codex/`, `~/.codius/` |
| Codius | `~/codius` (new git repo) | Local Responses gateway `:4890`, `~/.codius/`, Codex `model_providers.codius` | Claude wrapper, `~/.claude-native/` |

### Data flow

```
Codex (IDE/CLI)
  → POST http://127.0.0.1:4890/v1/responses  (Responses API)
  → Codius translates → OpenCode POST …/chat/completions
  → model (e.g. mimo-v2.5-free)
```

Claudio remains:

```
Claude Code → Anthropic /v1/messages → claude-wrapper bridge → OpenCode chat/completions
```

## Codius product

### Repo layout

```
~/codius/
  package.json          # name: codius; bin → src/cli.js
  README.md
  src/
    bridge.js           # HTTP server 127.0.0.1:4890
    translate.js        # Responses ↔ Chat Completions
    config.js           # load ~/.codius only
    cli.js              # bridge | status | install-config
  scripts/
    install.ps1         # PATH shim + seed ~/.codius if missing
  test/
    translate.test.js
    bridge.smoke.js
```

### Config (`~/.codius/` only)

- `providers.json` — active provider, baseUrl, model id, `apiKeyEnv` (no plaintext keys in JSON)
- `.env` — secrets (`OPENAI_API_KEY` for OpenCode, `CODIUS_API_KEY` for inbound Bearer)

Example `providers.json`:

```json
{
  "active": "opencode",
  "providers": {
    "opencode": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "model": "mimo-v2.5-free",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  }
}
```

Codius never reads `~/.claude-native/`. No automatic key copy from Claude.

### Bridge API (MVP)

Listen: `127.0.0.1` port `CODIUS_PORT` (default `4890`).

Inbound auth: `Authorization: Bearer <CODIUS_API_KEY>` on `/v1/*` (optional on `/health`).

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/health` | `{ ok: true }` |
| GET | `/v1/models` | Models from active provider catalog |
| POST | `/v1/responses` | Translate → upstream chat/completions → Responses shape |

#### Translation rules

**Request (Responses → Chat)**

- Map `instructions` + `input` (string or message list) → OpenAI `messages`
- Map Responses `tools` → Chat Completions `tools` when present
- `model`: request model if listed for active provider; else provider default
- `stream`: pass through
- Drop/ignore fields with no Chat equivalent (log at debug); do not fail the request for unknown optional fields Codex may send

**Response non-stream (Chat → Responses)**

- Emit a single Responses object with `status: completed`, output text (and tool calls if present) in the Responses item layout Codex expects for `wire_api = "responses"`

**Response stream**

Emit the minimal event set Codex needs:

1. `response.created`
2. text: `response.output_text.delta` (and matching item/part bookkeeping as required)
3. tools: function-call argument deltas when upstream emits tool calls
4. `response.completed` (or `error`)

Ignore unknown upstream chunks; never double-close the SSE stream.

### CLI

| Command | Behavior |
|---------|----------|
| `codius bridge` | Start gateway (foreground) |
| `codius status` | Show port, config path, active provider, `/health` ping |
| `codius install-config` | Ensure `[model_providers.codius]` in `~/.codex/config.toml` without wiping other keys |

Target Codex snippet:

```toml
model = "mimo-v2.5-free"
model_provider = "codius"

[model_providers.codius]
name = "Codius"
base_url = "http://127.0.0.1:4890/v1"
env_key = "CODIUS_API_KEY"
wire_api = "responses"
```

### Error handling

| Case | Behavior |
|------|----------|
| Missing `~/.codius/providers.json` or active provider | 502 JSON error; CLI status explains how to seed |
| Missing upstream API key | 502; status shows which env var is empty |
| Upstream 4xx/5xx | Forward status when safe; else 502 with sanitized message (no raw key) |
| Invalid inbound JSON | 400 |
| Unauthorized Bearer | 401 |
| Translate failure | 502 + log; never hang the SSE without terminal `error` / close |

### Testing

- Unit: `translate.js` — string input, multi-message input, tool round-trip shapes, stream event ordering
- Smoke: start bridge against a mock upstream; `POST /v1/responses` non-stream + stream returns completed/error terminal event
- Manual: Codex extension with `model_provider = "codius"` after `codius bridge`

## Claudio cleanup

In `~/claudio/claude-wrapper`:

1. Remove `~/.codius/providers.json` from candidate list in `lib/provider/resolve.js` (only `~/.claude-native/providers.json`)
2. Update `SETUP-GUIDE.md` — drop shared/fallback Codius wording
3. Update `STATUS-CLAUDE-FIRST.md` — Codius is a separate repo (`~/codius`), not paused-inside-Claudio
4. Do **not** restore `codius/` under the Claudio monorepo

No changes to Anthropic bridge behavior, native wrapper build, or Cursor `claudeProcessWrapper` wiring as part of this work.

## Out of scope

- Reusing Claude Anthropic bridge for Codex
- `chatgpt.cliExecutable` process wrapper
- Full OpenAI Responses event parity (WebSocket, vision-heavy paths, every tool event type)
- Legacy HTTPS_PROXY / CONNECT tunnel from reverted Codius commit
- Auto-migrating secrets from `~/.claude-native` to `~/.codius`
- Publishing npm package (local PATH shim via install.ps1 is enough)

## Success criteria

1. `~/codius` exists as its own git repo; Claudio has no Codius source tree
2. Codius config lives only under `~/.codius/`
3. Claudio no longer loads `~/.codius/providers.json`
4. With Codius bridge up, Codex can complete a text turn via `model_providers.codius`
5. Claude wrapper continues to use only `~/.claude-native/`
