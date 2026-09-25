# Upstream errors

What each failure looks like, what it means, and what to do.
Code: `lib/bridge/stream.js`, `lib/bridge/messages-chat.js`, `lib/wrapper/log.js`.

## Error taxonomy

| What you see | What it means | Action |
|---|---|---|
| `upstream 503: Service temporarily overloaded` | The provider is throttled. The bridge retried once already. | Wait and retry the turn. Recurring = pick a less loaded model or hour. |
| `upstream 429 ...` | Rate limit on the provider key. | Back off; check key quota. |
| `upstream timed out after 180000ms` | No response in 3 min (huge payload or stuck upstream). | Retry; shrink context (`/compact`). Raise via `CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS` only if the model is just slow. |
| `upstream fetch failed: ...` | Network/TLS/DNS between bridge and provider. | Check connectivity and `baseUrl`. |
| `[upstream returned no content after retries]` | HTTP 200 with zero text, reasoning, or tool calls on every attempt. | Retry the turn. If frequent, see below. |
| `upstream HTTP 4xx` (other) | Provider rejected the request shape. | Do not retry blindly — file an issue with the sanitized log line. |

## The 503-disguised-as-200 case

Some providers (observed on Nvidia) answer HTTP 200 with an SSE payload of
`{"error": {"message": "Service temporarily overloaded", "code": 503}}`.
The bridge detects inline `error` objects in the stream (`stream.js`) and
propagates the real status and message instead of mislabeling the turn
"empty". The log line is `upstream stream-error 503 ...`.

## Logs

Critical diagnostics always land in `~/claude-native-debug.log`
(`CLAUDE_NATIVE_LOG` overrides). Key lines:

- `empty upstream stream model=... msgs=...` — genuine empty 200
- `upstream stream-error <code> ... detail=...` — error inside 200
- `upstream <status> ... detail=...` — HTTP error status
- `[retry] A→B reason=...` — cascade step

Secrets are redacted before logging (`sanitizeForLog`).

## Troubleshooting

- **Old CLI picked up**: the resolver prefers newest semver across override →
  `~/.local/bin` → npm global → extension bundles (incl. `*-server` roots).
  A stale copy only wins if the newer binary fails to probe. See resolution
  order in [ARCHITECTURE.md](../ARCHITECTURE.md).
- **`spawn EINVAL` in the IDE**: the extension spawns the wrapper directly —
  it must be `claudio-wrapper.exe` (Windows) or `claudio-wrapper.sh` (Linux),
  never a `.cmd` (needs a shell). Re-run the installer for your platform.
- **Auto-mode billing notice**: expected behind any non-Anthropic upstream;
  the wrapper sets `CLAUDE_CODE_AUTO_MODE_SERVER=0` so it never shows —
  classifiers stay local and billed as before.
