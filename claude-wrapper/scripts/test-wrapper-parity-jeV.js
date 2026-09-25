/** Jev comparison: wrapper (local Anthropic→OpenAI gateway) vs official Claude Code behavior. */
const fs = require('fs')
const path = require('path')
const os = require('os')

const state = {
  subject: 'claudio-wrapper: local gateway exposing Anthropic Messages format, translating to NVIDIA OpenAI Chat Completions (nemotron models)',
  dimensions: {
    endpoints: {
      official: 'Gateway must serve POST /v1/messages, optional /v1/messages/count_tokens, GET /v1/models; best-effort HEAD /api/hello may be rejected.',
      wrapper: 'Serves /v1/messages, /v1/messages/count_tokens, GET /v1/models + /models. Unknown /v1/* or /api/* paths go to an allowlisted proxy to api.anthropic.com (needs real key) else 404/503.',
    },
    streaming: {
      official: 'Stream inference live, never buffer full responses; forward keep-alive pings, else client aborts silent streams after 300s. content-type text/event-stream.',
      wrapper: 'Forwards OpenAI SSE deltas as Anthropic SSE events live, no response buffering. content-type text/event-stream. Does NOT emit its own ping events during upstream silent gaps.',
    },
    request_translation: {
      official: 'Beta headers + body fields (thinking/adaptive, output_config/effort, context_management, tool fields strict/defer_loading, cache_control) travel as pairs; stripping one half causes 400s or silent loss.',
      wrapper: 'Builds its own OpenAI chat body from scratch: system array merged to text, tool_use/tool_result mapped, thinking folded to text. Unknown Anthropic fields (adaptive thinking, output_config, context_management, betas) are dropped quietly, never forwarded, so no 400s; those capabilities are silently off. cache_control markers dropped (upstream has no prompt caching anyway).',
    },
    error_forwarding: {
      official: 'Forward error response bodies unmodified so client capability-rejection recovery can match upstream wording; may use capability_rejected: tokens.',
      wrapper: 'Wraps upstream failures in its own envelope (upstream HTTP <status>, timeouts). Empty upstream (HTTP 200, zero content) is retried then surfaced as a 200 SSE text notice, never a blank assistant. Wording does not match any upstream so client regex recovery cannot trigger.',
    },
    retry_headers: {
      official: 'Return retry-after (integer seconds), pass through x-should-retry and anthropic-ratelimit-unified-* so client retries and limit display work.',
      wrapper: 'Does not return retry-after, x-should-retry, or ratelimit headers on errors or success. Has own cascade: same-model retry (single-model) then next-model fallback.',
    },
    model_discovery: {
      official: 'GET /v1/models entries need id containing claude|anthropic; display_name/description optional; enabled client-side by CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1.',
      wrapper: 'Exposes /v1/models with ids like anthropic.nvidia.<model> (pass the filter), sets CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1 for spawned clients.',
    },
    classifier_billing: {
      official: 'Auto-mode server-side safety checks must pass through unchanged (safeguards field, safeguard_results events); else client falls back to billed classifier requests with a notice. Can silence via CLAUDE_CODE_AUTO_MODE_SERVER=0.',
      wrapper: 'Upstream is NVIDIA, which cannot perform Anthropic server checks by construction; the notice appears and classifier requests stay billed. Wrapper does NOT set CLAUDE_CODE_AUTO_MODE_SERVER=0.',
    },
    attribution_block: {
      official: 'Forward system array unchanged (block first, own entry) or set CLAUDE_CODE_ATTRIBUTION_HEADER=0; stable per conversation since v2.1.181.',
      wrapper: 'Merges system array into one text string including the attribution block; harmless for non-Anthropic upstream, no cache-key concern there.',
    },
    auth_gate: {
      official: 'Accept developer credential via Authorization/x-api-key headers.',
      wrapper: 'Loopback-only by default with shared bridge token gate in strict mode; rejects browser origins and CORS preflight.',
    },
  },
}

const L = (l0, l1, l2, l3, l4) => [l0, l1, l2, l3, l4]
const questions = {
  endpoints: { type: 'score', instructions: 'How close is `dimensions.endpoints.wrapper` to `dimensions.endpoints.official`?', criteria: L('Messages endpoint missing or hard-fails', 'Main endpoint works, counting/discovery often error', 'All three endpoints work; edge paths fall back acceptably', 'Matches except rare edge paths', 'Full parity') },
  streaming: { type: 'score', instructions: 'How close is `dimensions.streaming.wrapper` to `dimensions.streaming.streaming`? Rate `dimensions.streaming.wrapper` against `dimensions.streaming.official`.', criteria: L('Buffered or stalled streams', 'Live but frequent stalls/aborts', 'Live streaming works; long silent gaps may abort', 'Matches except extreme pause edge cases', 'Full parity') },
  request_translation: { type: 'score', instructions: 'How close is `dimensions.request_translation.wrapper` to `dimensions.request_translation.official`?', criteria: L('Rejects normal requests with 400s', 'Core turns work, frequent capability errors', 'Core turns clean, advanced capabilities silently off', 'Matches except exotic fields', 'Full parity') },
  error_forwarding: { type: 'score', instructions: 'How close is `dimensions.error_forwarding.wrapper` to `dimensions.error_forwarding.official`?', criteria: L('Errors crash or corrupt sessions', 'Errors surface but break client recovery', 'Errors surface safely in own envelope; client recovery inapplicable', 'Envelope plus stable tokens', 'Full parity') },
  retry_headers: { type: 'score', instructions: 'How close is `dimensions.retry_headers.wrapper` to `dimensions.retry_headers.official`?', criteria: L('No retry behavior at all', 'Retries blindly against upstream guidance', 'Own cascade works; upstream retry hints ignored', 'Hints honored in most cases', 'Full parity') },
  model_discovery: { type: 'score', instructions: 'How close is `dimensions.model_discovery.wrapper` to `dimensions.model_discovery.official`?', criteria: L('Picker gets nothing', 'Entries appear but fail the client filter', 'Entries listed and selectable', 'Listed with names and descriptions', 'Full parity') },
  classifier_billing: { type: 'score', instructions: 'How close is `dimensions.classifier_billing.wrapper` to `dimensions.classifier_billing.official`?', criteria: L('Auto mode broken', 'Works but surprising charges with no explanation', 'Works billed-as-before with notice shown', 'Notice silenced by documented flag, behavior identical', 'Server checks actually served') },
  attribution_block: { type: 'score', instructions: 'How close is `dimensions.attribution_block.wrapper` to `dimensions.attribution_block.official`?', criteria: L('System prompt corrupted', 'Prompt reaches model but caching/attribution broken', 'Harmless for this upstream, shape differs', 'Shape preserved or flag set', 'Full parity') },
  auth_gate: { type: 'score', instructions: 'How close is `dimensions.auth_gate.wrapper` to `dimensions.auth_gate.official`?', criteria: L('Accepts nothing or is an open proxy', 'Works but with auth holes', 'Credential gate correct for local loopback scope', 'Matches plus rotation/audit', 'Full parity') },
}
const weights = { endpoints: 0.2, streaming: 0.2, request_translation: 0.2, error_forwarding: 0.1, retry_headers: 0.05, model_discovery: 0.05, classifier_billing: 0.1, attribution_block: 0.05, auth_gate: 0.05 }

async function main() {
  const envRaw = fs.readFileSync(path.join(os.homedir(), '.claude', '.env'), 'utf8')
  const key = envRaw.split('\n').find((l) => l.trim().startsWith('TYPESAFE_API_KEY=')).split('=').slice(1).join('=').trim()
  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ state, model: 'jev-latest', questions }),
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const data = await r.json()
  console.log('model:', data.model, 'usage:', JSON.stringify(data.usage))
  let total = 0
  for (const [id, a] of Object.entries(data.answers)) {
    const pct = ((a.score / 4) * 100).toFixed(0)
    console.log(`${id}: score=${a.score.toFixed(2)}/4 (${pct}%) conf=${a.confidence.toFixed(2)} dist=${JSON.stringify(a.probabilities)}`)
    total += (a.score / 4) * (weights[id] || 0)
  }
  console.log(`COMPOSITE: ${(total * 100).toFixed(1)}%`)
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
