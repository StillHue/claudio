# Environment flags

All flags the wrapper reads. `CLAUDE_NATIVE_*` tune the bridge;
`CLAUDE_CODE_*` are set for the spawned Claude Code client (each honors a
pre-existing value — the wrapper only fills defaults).

## Bridge tuning (`CLAUDE_NATIVE_*`)

| Variable | Default | Effect |
|---|---|---|
| `CLAUDE_NATIVE_UPSTREAM_TIMEOUT_MS` | `180000` | Abort upstream fetch after this long. |
| `CLAUDE_NATIVE_MAX_OUTPUT_TOKENS` | `32000` | Cap for `max_tokens` sent upstream. Claude Code's own budget wins below the cap. |
| `CLAUDE_NATIVE_PRUNE_MAX_BYTES` | `220000` | Conversation bytes budget before old tool outputs are pruned. |
| `CLAUDE_NATIVE_PRUNE_KEEP_RECENT` | `16` | Recent messages always kept intact by pruning. |
| `CLAUDE_NATIVE_MAX_BODY_BYTES` | `20971520` | Reject incoming `/v1/messages` bodies above 20 MB. |
| `CLAUDE_NATIVE_API_KEY` | — | Force upstream key, bypassing the provider's `apiKeyEnv`. |
| `CLAUDE_NATIVE_MODEL` | — | Force upstream model when no catalog model was selected. |
| `CLAUDE_NATIVE_BASE_URL` | provider `baseUrl` | Force upstream base URL. |
| `CLAUDE_NATIVE_ANTHROPIC_API_KEY` (`ANTHROPIC_REAL_API_KEY` fallback) | — | Real Anthropic key so system-tool traffic proxied to `api.anthropic.com` keeps working. Without it those endpoints return 503 with instructions. |
| `CLAUDE_NATIVE_BRIDGE_STRICT` | unset | `1` = require the shared bridge token on loopback (reject otherwise). |
| `CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL` | `1` | Loopback token check bypass (ignored when `STRICT=1`). |
| `CLAUDE_NATIVE_RESTORE_LOGIN` | unset | `1` = restore quarantined `~/.claude/.credentials.json` on shutdown. Default keeps it quarantined so the login prompt never targets the bridge. |
| `CLAUDE_NATIVE_LOG` | `~/claude-native-debug.log` | Critical-diagnostic log path. |
| `CLAUDE_WRAPPER_DEBUG` (`CLAUDIO_WRAPPER_DEBUG` legacy) | unset | `1` = verbose per-request logging to stderr + log file. |

## Client flags set on spawn (`CLAUDE_CODE_*`)

| Variable | Wrapper default | Why |
|---|---|---|
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` | `1` | Populate `/model` picker from bridge `/v1/models`. |
| `CLAUDE_CODE_AUTO_MODE_SERVER` | `0` | Non-Anthropic upstream cannot serve server-side auto-mode checks; silences the billing notice. Classifiers stay local, billed as before. |
| `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` | `1` | Custom/gateway model IDs are not in Claude's window table. |
| `CLAUDE_CODE_SKIP_API_KEY_CHECK` | `1` | The bridge token is not a real Anthropic key. |

The wrapper also strips `OPENAI_*`, `CLAUDE_CODE_USE_{OPENAI,BEDROCK,VERTEX}`,
`CLAUDE_CODE_OAUTH_TOKEN`, and `ANTHROPIC_AUTH_TOKEN` from the child env so a
foreign provider config can never leak into the bridged session.

## Provider config (`~/.claude/providers.json`)

Per provider: `baseUrl`, `model` (primary), `models` (cascade, see
[fallback & retry](./fallback-retry.md)), `apiKeyEnv` (env var holding the key),
`format: "chat"`, `tools: true`, optional `"vision": true` (default text-only:
images become short stubs).
