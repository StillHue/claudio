# Provider-agnostic Auto router

## Goal

`Auto` routes across the **active provider’s `models[]`**, like Cursor Auto.
Vendor (NVIDIA, OpenCode, custom) is the user’s choice at first-run — not hard-coded into Auto.

## Behavior

1. Resolve active provider + API key from `providers.json` / `.env`
2. Classify turn: vision | hard | coding | fast
3. Score catalog model ids with name heuristics; pick best for tier
4. Cascade stays inside that catalog (upgrade on empty/429/5xx/410)
5. OpenRouter with only `openrouter/auto` → passthrough to OpenRouter Auto Router

## Install fix

`install.ps1` must **not** seed OpenCode `providers.json` (caused wrong-provider API errors).
First Claude launch shows the provider picker.

## Docs

Clarify README: official Claude Code wrapper vs Ink CLI fork (`npm i -g claudio`).
