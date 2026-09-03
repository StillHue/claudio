# Design: Auto via OpenRouter only

**Date:** 2026-09-03  
**Status:** Approved for implementation planning  
**Scope:** `claudio/claude-wrapper` + Claude/Cursor model sync

## Problem

Manual model switching fails when the turn needs vision, then coding, or when a provider hits rate limits. Local multi-provider routing in the wrapper duplicated what OpenRouter Auto Router already does, with weaker classification and more moving parts.

## Goal

Expose a single picker model **Auto** that always means OpenRouter Auto Router (`openrouter/auto`). All inference goes through OpenRouter. NVIDIA is consumed via OpenRouter BYOK. No direct calls to NVIDIA or OpenCode from the wrapper.

## Non-goals

- Local vision/coding classifiers, sticky buckets, or failover queues between providers
- Keeping `nvidia` / `opencode` as first-class execution providers in the Auto path
- Rebuilding Cursor-style Compass telemetry
- Changing Claude Code itself beyond settings/env the wrapper already syncs

## Architecture

```
Claude Code / Cursor
  → model alias Auto → openrouter/auto
  → auth: OPENROUTER_API_KEY
  → base: OpenRouter Anthropic-compatible API
       (thin bridge only if Messages compatibility requires it)
  → optional: auto-router plugin + cost_tier
       ↓
OpenRouter Auto Router
  → task classify (~30 types)
  → market ranking + fallbacks + multi-turn sticky
  → execute (e.g. NVIDIA via account BYOK, or other catalog models)
```

OpenRouter owns: task type (vision vs coding vs other), mid-conversation re-route when the task changes, rate-limit fallbacks, model pool.

The wrapper owns: wiring, alias sync, optional `cost_tier`, logging of the resolved upstream model.

## Configuration

### Environment

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | yes | Account key (BYOK NVIDIA lives on the OpenRouter account) |
| `OPENROUTER_COST_TIER` | no | `low` \| `medium` \| `high` \| `xhigh` \| `max`; default `low` if unset |
| `OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE` | no | Attribution headers already used by the client |

Remove Auto-path dependence on `NVIDIA_API_KEY` and `OPENCODE_API_KEY` inside the wrapper (keys may remain unused on disk; they must not be used for Auto execution).

### `providers.json`

Single active provider:

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
      "models": ["openrouter/auto", "openrouter/auto-beta"]
    }
  }
}
```

- Remove `nvidia` and `opencode` entries from the Auto/runtime config (or leave them unused and exclude from catalog sync — prefer delete from active config to avoid accidental direct routing).
- Picker display: `Auto` maps to `openrouter/auto` (and keep existing `anthropic.auto` → Auto aliases if already present in display sync).

### Account (outside repo)

- NVIDIA BYOK configured on the OpenRouter account (already done by user).
- Optional account `allowed_models` / guardrails to constrain the Auto pool.

## Wrapper behavior (minimal)

1. **Resolve Auto** — any of `auto`, `anthropic.auto`, `claude-auto`, catalog Auto ids → upstream `openrouter/auto`.
2. **Auth + base URL** — all Auto (and default) traffic uses OpenRouter credentials and endpoint.
3. **cost_tier** — if `OPENROUTER_COST_TIER` is set, attach the OpenRouter auto-router plugin payload on requests (`id: auto-router`, `cost_tier: …`). For `openrouter/auto-beta`, use the matching plugin id per OpenRouter docs.
4. **Session** — forward session id when available so OpenRouter multi-turn sticky can apply.
5. **Observability** — log the response `model` field (actual routed model) without exposing secrets.
6. **Sync** — `syncDefaultModel` / available-models sync advertise Auto as the default when `active` is `openrouter`.

### Bridge stance

Prefer pointing Claude’s Anthropic base URL at OpenRouter’s Anthropic-compatible API when that covers Claude Code’s Messages + tools needs.

Keep the existing thin Messages↔chat bridge only if compatibility gaps remain (tool streaming, count_tokens, etc.). Do not grow local routing logic either way.

## Error handling

| Case | Behavior |
|---|---|
| Missing `OPENROUTER_API_KEY` | Fail fast with a clear message; do not fall back to nvidia/opencode |
| OpenRouter 401/403 | Surface upstream error; hint BYOK/account key |
| OpenRouter 429 / upstream provider errors | Rely on OpenRouter’s own fallbacks; do not implement a second local cascade |
| Invalid `cost_tier` | Fall back to OpenRouter default (`low`-equivalent) and log a warning |

## Testing

- Unit: Auto alias resolution → `openrouter/auto`; providers catalog only lists OpenRouter Auto models after sync.
- Integration (with key): one Messages request with `Auto` returns 200 and a concrete `model` in logs/response metadata.
- Manual: same chat — image analysis turn then coding turn — without changing picker; confirm logs show different upstream models when the task type changes (when OpenRouter re-routes).
- Negative: empty key → no silent local provider use.

## Migration

1. Set `OPENROUTER_API_KEY` in wrapper `.env` (and native env loaders).
2. Replace `providers.json` / `~/.claude-native/providers.json` with openrouter-only active config.
3. Disable or delete local auto-router branch that selects nvidia/opencode for `auto`.
4. Re-run provider sync so Claude/Cursor default model is Auto.
5. Smoke-test vision then coding in one session.

## Success criteria

- User never switches models for vision vs coding vs rate-limit recovery; Auto stays selected.
- Zero direct NVIDIA/OpenCode HTTP from the wrapper on the Auto path.
- OpenRouter performs classification, sticky, and fallbacks.
- Config surface is small: key + optional cost_tier + openrouter-only providers file.
