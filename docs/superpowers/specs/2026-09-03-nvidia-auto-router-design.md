# NVIDIA Auto Router (local heuristics + fallback)

## Goal

Picker **Auto** routes exclusively through **NVIDIA NIM** (`https://integrate.api.nvidia.com/v1`) using `NVIDIA_API_KEY`. No OpenRouter on the Auto path.

Intelligent behavior:

- **A — Heuristics:** vision vs text + task complexity → pick Ultra / Super / Lightning / Nano / VL
- **B — Fallback:** on 429 / 503 / timeout, cascade Ultra → Super → Lightning → Nano (skip already tried)

## Model map (env-overridable)

| Role | Env | Default |
|------|-----|---------|
| Vision | `NVIDIA_AUTO_VISION_MODEL` | `nvidia/nemotron-nano-12b-v2-vl` |
| Fast | `NVIDIA_AUTO_FAST_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Coding (default) | `NVIDIA_AUTO_CODING_MODEL` | `nvidia/nemotron-3-super-120b-a12b` |
| Hard | `NVIDIA_AUTO_HARD_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b` |
| Light fallback | `NVIDIA_AUTO_LIGHT_MODEL` | `nvidia/nemotron-3-nano-30b-a3b` |

## Classification

1. Request has images → **vision** (VL with image pass-through)
2. Else score last user text + tools:
   - hard hints / very long prompt → **hard** (Ultra)
   - code / tools / medium → **coding** (Super)
   - short, no tools → **fast** (Lightning)
3. Default → **coding**

## Fallback cascade

From the chosen tier, continue downward: hard → coding → fast → light.

Vision cascade: vision → coding → fast → light. Switching off VL re-flattens images via the VL describer before retry.

## Non-goals

- OpenRouter Auto / BYOK / `:free`
- Nano-as-classifier round-trip
- Opencode on Auto path

## Files

- `claude-wrapper/providers.json` — nvidia active
- `claude-wrapper/lib/bridge/auto-router.js` — classify + cascade
- `claude-wrapper/lib/bridge/messages-chat.js` — retry on 429/503/timeout
- `claude-wrapper/lib/bridge/vision-describer.js` — VL pass-through
- `claude-wrapper/lib/provider/resolve.js` + `sync.js` — Auto → nvidia catalog
- Tests: `scripts/test-nvidia-auto-router.js`
