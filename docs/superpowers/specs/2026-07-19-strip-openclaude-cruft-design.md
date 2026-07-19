# Design: Strip OpenClaude promotional / gamified cruft (Approach A)

**Date:** 2026-07-19  
**Repo:** `C:\Users\gabdr\claudio` (CLI under `openclaude-fork/`)  
**Status:** Approved in conversation; awaiting user review of this file before implementation plan

## Goal

Ship a lean multi-provider coding-agent CLI (**Claudio**) without OpenClaude monetization, mascot gamification, or Anthropic product upsells—while keeping the full agent core.

## Non-goals

- Removing working LLM providers (including Atomic Chat, Xiaomi MiMo, Atlas Cloud, Gitlawb OpenGateway as backends)
- Deleting analytics/GrowthBook modules (already stubbed / no phone-home)
- Stripping MCP, hooks, skills, sessions, permissions, tools, or the query loop
- Approach B extras (Chrome-in-Claude, voice, `web/` marketing site) unless later requested
- Automatic npm republish (only on explicit user request)

## Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Core scope | Full multi-provider agent (chat, tools, sessions, permissions, MCP, hooks, skills) |
| Providers | Keep functional providers; remove ads/sponsor marketing only |
| Cleanup approach | **A — Surgical** |

## Remove

### Ads / sponsored tips

- Command `/ads` and `src/commands/ads.tsx` (+ tests)
- `src/services/ads.ts` (+ tests) — client for `ads.gitlawb.com`
- `src/services/tips/gitlawbEarn.ts` (+ tests)
- `src/services/tips/sponsoredTips.ts` (+ tests)
- Config/settings: `ads`, `sponsoredTipsEnabled`, `sponsoredTipsFrequency`, `sponsoredTipsHistory`
- Wiring in tip scheduler / REPL so spinner tips never fetch ads or share prompts

### Buddy

- Entire `src/buddy/**`
- `src/commands/buddy/**`
- Companion state in `AppStateStore`, rendering in `REPL.tsx` / `PromptInput`, attachments/messages hooks that exist only for companion

### Anthropic / merch upsells and dead promo commands

- `/stickers`
- `/upgrade`
- `/passes` (+ referral / GuestPasses upsell UI)
- `/extra-usage`
- Desktop upsell startup UI
- Overage credit upsell in Logo feed (promo surface only)
- `/mobile` (already disabled; delete)
- `/install-slack-app`
- Thinkback / year-in-review commands and play UI

### Docs / README

- Sponsors section and sponsor logo table
- Buddy pitch and `/buddy` docs
- GitLawb marketing badges / mirror fluff that are not operational install links
- Keep lineage credit (Claude Code → OpenClaude → Claudio) and MIT/NOTICE honesty

## Keep

- Providers and `/provider` flows
- Non-sponsored educational tips
- Analytics stubs / `verify-no-phone-home` / no-telemetry build plugin
- Startup branding (Clawd splash / “Welcome to Claude Code” / Claudio product name)—cosmetic, not ads
- Attribution trailers for commits (retarget GitHub/npm URLs to Claudio where they still point at OpenClaude)

## Execution order

1. Ads + sponsored tips + earning (delete files, unregister command, clean tip path)
2. Buddy + companion UI/state
3. Upsell / stickers / thinkback / related dead commands
4. README and fork docs cleanup
5. `bun run build` + smoke (`claudio --version` / `node dist/cli.mjs --version`)
6. npm republish **only if requested**

## Success criteria

- No `/ads`, `/buddy`, stickers, upgrade/passes/mobile/slack/thinkback in the command surface
- No HTTP to `ads.gitlawb.com` on tip/spinner paths
- No companion sprite/FX in the REPL
- Spinner tips without “Sponsored” badge / partner promo tips
- Providers and agent loop still work
- Build + smoke pass
- README free of Sponsors section and buddy pitch

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Missed import breaks build | Grep for symbols after deletion; fix compile errors before smoke |
| Tip scheduler assumes sponsored branch | Leave educational tips; remove sponsored/earn branches only |
| Config fields left in types | Remove or ignore deprecated keys without migrating user configs |
| Referral shared by non-upsell code | Grep `referral` before deleting; keep shared API only if still required |

## Out of scope for this change

- Chrome extension integration, voice mode, gRPC headless, `web/` site
- Deep deletion of `services/analytics/**`
- Changing default provider away from OpenGateway (not part of Approach A)
