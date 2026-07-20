# Fase 0 — Recon (Claude extension → API)

Captured from the **installed** Edge/Chrome extension `Claude` (`fcoeoabgfenejglbffodgkkbkcdhcgfn` **v1.0.81**) by scanning string literals only. No extension source is copied into this repo.

Public cross-check: [Claude for Chrome Extension Internals (v1.0.56 gist)](https://gist.github.com/jeromeku/379f26fb9e69e2c2770a2f5bc476f3c8).

## Auth

| Mechanism | Notes |
| --------- | ----- |
| OAuth PKCE | Default; scopes include `user:profile` / `user:inference` (and related). |
| Bearer token | `Authorization: Bearer …` on Anthropic API calls. |
| API key | Feature-gated / internal; not required for normal sidebar use. |

**Do not log or commit cookies/tokens.** Proxy local mode ignores Anthropic auth and uses Claudio’s provider profile instead.

## Hosts (allowlist candidates)

| Host | Role |
| ---- | ---- |
| `api.anthropic.com` | **Primary inference** — Anthropic JS SDK `messages` / `beta.messages.stream`. |
| `www.claude.ai` / `preview.claude.ai` | Web / preview surfaces. |
| `platform.claude.com` | Platform links. |
| `bridge.claudeusercontent.com` | WebSocket bridge (Claude Code ↔ Chrome), not chat sidebar inference. |
| `bridge-staging.claudeusercontent.com` | Staging bridge. |
| `*.mcp.claude.com` | MCP connectors (Gmail / GCal / M365). |
| `support.anthropic.com` / `support.claude.com` | Support. |

Also seen as base URLs in bundles: `wss://api.anthropic.com`, `wss://bridge.claudeusercontent.com`.

## Paths (inference-relevant)

| Path | Role |
| ---- | ---- |
| `POST /v1/messages` | Chat / agent turns (stream or JSON). |
| `POST /v1/messages?beta=true` | Beta Messages API (extension uses SDK betas, e.g. `oauth-2025-04-20`). |
| `POST /v1/messages/count_tokens` | Token counting. |
| `GET /v1/models` | Model list. |
| `POST /v1/complete` | Legacy complete (SDK surface). |
| `GET /api/oauth/profile` | OAuth profile. |
| `GET /api/web/domain_info/browser_extension` | Domain safety classification. |
| `POST /api/event_logging/v2/batch` | Telemetry. |
| `POST /v1/oauth/token` | Token exchange. |

## Streaming

- Extension uses **Anthropic Messages streaming** via SDK (`beta.messages.stream` / `messages.create` with `stream: true`).
- Wire format: **SSE** (`text/event-stream`) with events such as `message_start`, `content_block_delta` (`text_delta`), `message_stop`.
- Separate from Claude Code’s `wss://bridge.claudeusercontent.com` (not required for v1 “oi” in the sidebar).

## Typical turn (chat-only mental model)

1. Side panel builds system prompt + tab context + tool defs.
2. `POST https://api.anthropic.com/v1/messages` (often `?beta=true`) with OAuth bearer, `stream: true`, model like `claude-sonnet-4-5-…`.
3. SSE tokens rendered in UI; tool_use loops if present.

**v1 proxy scope:** intercept `api.anthropic.com` `/v1/messages` in **local** mode → Claudio (`--tools ""` chat text). Other allowlisted hosts/paths stay **passthrough** so login/domain checks keep working.

## Sample shapes (sanitized — no secrets)

### Request (Messages)

```http
POST /v1/messages?beta=true HTTP/1.1
Host: api.anthropic.com
Authorization: Bearer <redacted>
anthropic-version: 2023-06-01
content-type: application/json
```

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "max_tokens": 10000,
  "stream": true,
  "system": "<chrome_ext_system_prompt + tab context>",
  "messages": [
    { "role": "user", "content": "oi" }
  ],
  "tools": []
}
```

### Response (SSE excerpt)

```text
event: message_start
data: {"type":"message_start","message":{"id":"msg_…","type":"message","role":"assistant","content":[],"model":"…","stop_reason":null}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Olá"}}

event: message_stop
data: {"type":"message_stop"}
```

## Certificate pinning risk

If the extension pins Anthropic’s certs, MITM fails → fall back to approach A (custom extension). Assumed risk for personal use; no guarantee across updates.
