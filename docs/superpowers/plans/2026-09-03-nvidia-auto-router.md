# NVIDIA Auto Router Implementation Plan

> **For agentic workers:** Spec: `docs/superpowers/specs/2026-09-03-nvidia-auto-router-design.md`

**Goal:** Auto picker → local NVIDIA heuristics + rate-limit fallback (no OpenRouter).

## Status

Implemented on branch `feat/openrouter-auto-only` (reuses shim/picker; execution is NVIDIA).

- [x] Spec
- [x] `providers.json` nvidia-active
- [x] `auto-router.js` classify + cascade
- [x] `messages-chat.js` 429/503/timeout retry
- [x] VL pass-through in `vision-describer.js`
- [x] resolve/sync Auto → nvidia
- [x] Tests `scripts/test-nvidia-auto-router.js` (10 pass)
