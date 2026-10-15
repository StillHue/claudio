# Fallback & retry

How the bridge picks models and recovers from upstream failures.
Code: `lib/bridge/auto-router.js`, `lib/bridge/messages.js`, `lib/bridge/messages-chat.js`.

## Cascade

The `models` array in `~/.claude/providers.json` is the fallback cascade, in order:

```json
{ "active": "nvidia", "providers": { "nvidia": {
  "model": "nvidia/nemotron-3-ultra-550b-a55b",
  "models": ["nvidia/nemotron-3-ultra-550b-a55b"]
} } }
```

`model` is the primary; `models[0]` must equal it. Extra entries are fallbacks,
tried only after the primary's attempts are exhausted. With a single entry there
is no fallback — behavior is identical to the original bridge.

## Retry policy

Per model, per turn:

| Failure | Single-model cascade | Multi-model cascade |
|---|---|---|
| Empty completion / empty stream | 1 same-model retry, then honest error | straight to next model, no same-model retry |
| Error smuggled in HTTP 200 (e.g. 503) | 1 same-model retry, then real status | next model (if status retryable), else real status |
| HTTP 429/502/503/504/410 | same as above | next model |
| Timeout / connection reset | same as above | next model |
| Other 4xx | no retry, surfaces immediately | no retry, surfaces immediately |

Skipping the same-model retry when a fallback exists is deliberate: a second
full-latency call against a flaky model is pure wait (`messages-chat.js`).

## The empty notice

`[upstream returned no content after retries — retry the turn; empty replies
are not stored as blank assistants]` appears only when every attempt returned
HTTP 200 with zero usable content. It is a 200 SSE text block, not an error —
the turn can simply be retried. If you see it often, the upstream is
overloaded or rejecting the payload shape; see [upstream errors](./upstream-errors.md).
