# Retry

How the bridge recovers from upstream failures.
Code: `handleChat` in `lib/bridge/messages-chat.js`. Fetch timeouts use `isUpstreamTimeout`.

One configured model per turn (`providers.json` → `model`). No model cascade.

## Retry policy

| Failure | What happens |
|---|---|
| Empty completion / empty stream | 1 same-model retry, then an error |
| Error smuggled in HTTP 200 (e.g. 503) | 1 same-model retry, then the real status |
| HTTP 429/502/503/504/410 | surfaces immediately |
| Timeout / connection reset | surfaces immediately (504 on timeout) |
| Other 4xx | surfaces immediately |

## Empty completion

After one same-model retry, an empty completion returns HTTP 502. The bridge does not invent assistant text.
