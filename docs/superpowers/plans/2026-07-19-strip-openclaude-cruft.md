# Strip OpenClaude Cruft (Approach A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ads, buddy, sponsored tips, and Anthropic/merch upsell commands from Claudio while keeping the full multi-provider agent core.

**Architecture:** Delete promotional modules and their registrations end-to-end (commands, UI mounts, tip scheduler branches, config fields). Leave educational tips and analytics stubs. Do not change provider backends.

**Tech Stack:** TypeScript, Bun (build/test), Node ≥22, Ink/React TUI under `cli/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-strip-openclaude-cruft-design.md`
- Keep providers including Atomic / MiMo / Atlas / OpenGateway as backends
- Keep non-sponsored tips; keep analytics stubs / no-telemetry build guards
- Do **not** npm publish unless the user explicitly asks
- Do **not** git commit unless the user explicitly asks
- Tests may be deleted/updated locally; do not invent large new test suites beyond a thin regression guard
- Working directory for CLI work: `C:\Users\gabdr\claudio\cli`

---

## File map

| Area | Delete | Modify |
|------|--------|--------|
| Ads | `src/commands/ads.tsx`, `ads.test.ts`, `src/services/ads.ts`, `ads.test.ts`, `src/services/tips/gitlawbEarn.ts`, `gitlawbEarn.test.ts`, `sponsoredTips.ts`, `sponsoredTips.test.ts` | `commands.ts`, `tipRegistry.ts`, `tipScheduler.ts`, `tipHistory.ts`, `tipScheduler.test.ts`, `config.ts`, `settings/types.ts`, `REPL.tsx` (tip context if only for ads) |
| Buddy | entire `src/buddy/**`, `src/commands/buddy/**` | `commands.ts`, `REPL.tsx`, `PromptInput.tsx`, `AppStateStore.ts`, `attachments.ts` / `messages.ts` if companion-only |
| Upsells | `commands/{stickers,upgrade,passes,extra-usage,mobile,thinkback,thinkback-play,install-slack-app}/**`, `DesktopUpsell/**`, `LogoV2/GuestPassesUpsell.tsx`, `LogoV2/OverageCreditUpsell.tsx` (or gut to always-false no-op if deeply entangled), related `Passes/**` | `commands.ts`, `LogoV2.tsx`, `CondensedLogo.tsx`, `feedConfigs.tsx`, `Usage.tsx`, `tipRegistry.ts`, `main.tsx` (passes prefetch) |
| Docs | — | `cli/README.md`, root `README.md` if buddy/sponsors remain |

---

### Task 1: Regression guard for forbidden commands

**Files:**
- Create: `src/__tests__/no-openclaude-cruft.test.ts`
- Modify: none yet

**Interfaces:**
- Consumes: `getCommands` / command registry export from `src/commands.ts` (use whatever the existing tests use to list built-in command names)
- Produces: failing test that lists forbidden names until Tasks 2–4 delete them

- [ ] **Step 1: Find how existing tests enumerate commands**

```bash
rg -n "getCommands|COMMANDS|command\.name" src/commands.test.ts src/**/*.test.ts --glob "*.ts" -m 20
```

- [ ] **Step 2: Add regression test**

```typescript
import { describe, expect, test } from 'bun:test'

// Import the same helper existing command tests use to list built-in names.
// If only a static array is exported, assert against that after registration.

const FORBIDDEN = [
  'ads',
  'buddy',
  'stickers',
  'upgrade',
  'passes',
  'extra-usage',
  'mobile',
  'install-slack-app',
  'thinkback',
  'thinkback-play',
] as const

describe('no OpenClaude cruft commands', () => {
  test('built-in command names exclude promotional commands', async () => {
    // Resolve names via the project’s existing command-list helper.
    // Expected after Task 4: none of FORBIDDEN appear.
    const names: string[] = [] // fill using discovered helper
    for (const name of FORBIDDEN) {
      expect(names).not.toContain(name)
    }
  })

  test('tip modules do not reference ads.gitlawb.com', async () => {
    const adsPath = new URL('../services/ads.ts', import.meta.url)
    const exists = await Bun.file(adsPath).exists()
    expect(exists).toBe(false)
  })
})
```

- [ ] **Step 3: Run test — expect FAIL (files/commands still present)**

```bash
bun test src/__tests__/no-openclaude-cruft.test.ts
```

Expected: FAIL until later tasks land.

- [ ] **Step 4: Do not commit** (wait for user)

---

### Task 2: Remove ads + sponsored tips + earning

**Files:**
- Delete: `src/commands/ads.tsx`, `src/commands/ads.test.ts`, `src/services/ads.ts`, `src/services/ads.test.ts`, `src/services/tips/gitlawbEarn.ts`, `src/services/tips/gitlawbEarn.test.ts`, `src/services/tips/sponsoredTips.ts`, `src/services/tips/sponsoredTips.test.ts`
- Modify: `src/commands.ts`, `src/services/tips/tipRegistry.ts`, `src/services/tips/tipScheduler.ts`, `src/services/tips/tipHistory.ts`, `src/services/tips/tipScheduler.test.ts`, `src/utils/config.ts`, `src/utils/settings/types.ts`, `src/screens/REPL.tsx` (only ads-related tip context comments/args)

**Interfaces:**
- Consumes: educational tips from `tipRegistry` without `sponsor`
- Produces: `getTipToShowOnSpinner` returns only non-sponsored tips; no `fetchNextTip`

- [ ] **Step 1: Unregister `/ads` in `commands.ts`**

Remove:

```typescript
import ads from './commands/ads.js'
// ...
ads,
```

- [ ] **Step 2: Simplify `tipScheduler.ts`**

Replace sponsored/earn logic with regular tips only:

```typescript
export async function getTipToShowOnSpinner(
  context?: TipContext,
): Promise<Tip | undefined> {
  if (getSettings_DEPRECATED().spinnerTipsEnabled === false) {
    return undefined
  }

  const tips = await getRelevantTips(context)
  const regular = tips.filter(t => !t.sponsor)
  return selectTipWithLongestTimeSinceShown(regular)
}

export function recordTipShownIfNeeded(tip: Tip): void {
  recordTipShown(tip.id)
  // no recordSponsoredTipShown
}
```

(Adjust `recordTipShownIfNeeded` name to match the real export in the file.)

- [ ] **Step 3: Remove sponsored tips from `tipRegistry.ts`**

Remove `import { sponsoredTips } from './sponsoredTips.js'` and drop `...sponsoredTips` from the tips array.

- [ ] **Step 4: Clean `tipHistory.ts`**

Remove `recordSponsoredTipShown`, `getSessionsSinceLastSponsored`, and `sponsoredTipsHistory` reads/writes.

- [ ] **Step 5: Clean config/settings types**

In `src/utils/config.ts` remove `ads?: { enabled: boolean; earnCode?: string }` and `sponsoredTipsHistory`.  
In `src/utils/settings/types.ts` remove `sponsoredTipsEnabled` and `sponsoredTipsFrequency` zod fields.

- [ ] **Step 6: Delete the ads/sponsored/earn source + test files listed above**

- [ ] **Step 7: Fix `tipScheduler.test.ts`** — delete cases about earning/sponsored; keep regular tip selection tests.

- [ ] **Step 8: Verify**

```bash
bun test src/services/tips/tipScheduler.test.ts
rg -n "ads\.gitlawb|gitlawbEarn|sponsoredTips|/ads" src --glob "!**/*.md"
```

Expected: tests pass; no remaining source references except possibly docs (fixed in Task 5).

- [ ] **Step 9: Do not commit**

---

### Task 3: Remove buddy

**Files:**
- Delete: entire `src/buddy/` directory, `src/commands/buddy/` directory
- Modify: `src/commands.ts`, `src/screens/REPL.tsx`, `src/components/PromptInput/PromptInput.tsx`, `src/state/AppStateStore.ts`, and any companion-only refs in `src/utils/attachments.ts`, `src/utils/messages.ts`, `src/components/FullscreenLayout.tsx`, `src/components/Messages.tsx`

**Interfaces:**
- Consumes: none
- Produces: REPL/PromptInput with no companion reservation or FX

- [ ] **Step 1: Unregister buddy in `commands.ts`**

Remove `isBuddyEnabled` import, dynamic `buddy` require, and `...(buddy ? [buddy] : [])`.

- [ ] **Step 2: Strip companion from `AppStateStore.ts`**

Remove `companion` from footer selection union if unused afterward, and remove:

```typescript
companionReaction?: string
companionPetAt?: number
companionShotAt?: number
```

Also remove from default state initializers.

- [ ] **Step 3: Strip `REPL.tsx`**

Remove imports of `CompanionSprite`, `CompanionFloatingBubble`, `CompanionActionFX`, `isBuddyEnabled`, `fireCompanionObserver`. Remove all `isBuddyEnabled()` branches, companion layout flex tweaks, and `companionShotAt` on Enter.

- [ ] **Step 4: Strip `PromptInput.tsx`**

Remove `companionReservedColumns` import and width reservation math.

- [ ] **Step 5: Grep and clear leftover companion hooks**

```bash
rg -n "buddy/|isBuddyEnabled|CompanionSprite|companionReaction|companionShotAt|companionPetAt|companionReservedColumns|fireCompanionObserver" src
```

Delete or rewrite each hit (attachments/messages if companion-only).

- [ ] **Step 6: Delete `src/buddy` and `src/commands/buddy`**

- [ ] **Step 7: Verify**

```bash
bun run build
```

Expected: build succeeds.

- [ ] **Step 8: Do not commit**

---

### Task 4: Remove upsell / merch / thinkback commands + UI

**Files:**
- Delete directories/files:
  - `src/commands/stickers/`
  - `src/commands/upgrade/`
  - `src/commands/passes/`
  - `src/commands/extra-usage/`
  - `src/commands/mobile/`
  - `src/commands/thinkback/`
  - `src/commands/thinkback-play/`
  - `src/commands/install-slack-app/`
  - `src/components/DesktopUpsell/`
  - `src/components/Passes/` (if only for guest passes)
  - Prefer delete `GuestPassesUpsell.tsx` + `OverageCreditUpsell.tsx` after unwiring; if `Usage.tsx`/`tipRegistry` hard-depend, replace exports with:

```typescript
export function shouldShowOverageCreditUpsell(): boolean { return false }
export function useShowOverageCreditUpsell(): boolean { return false }
export function incrementOverageCreditUpsellSeenCount(): void {}
export function createOverageCreditFeed(): never { throw new Error('removed') }
export function OverageCreditUpsell(): null { return null }
export function isEligibleForOverageCreditGrant(): boolean { return false }
```

  Then delete call sites that render them, then delete the stub files.
- Modify: `src/commands.ts`, `src/components/LogoV2/LogoV2.tsx`, `CondensedLogo.tsx`, `feedConfigs.tsx`, `src/components/Settings/Usage.tsx`, `src/services/tips/tipRegistry.ts` (remove install-slack / overage upsell tips), `src/main.tsx` (`prefetchPassesEligibility` and similar)

**Interfaces:**
- Consumes: Task 2 tip registry without sponsor tips
- Produces: command list without FORBIDDEN names from Task 1

- [ ] **Step 1: Unregister commands in `commands.ts`**

Remove imports and array entries for: `installSlackApp`, `mobile`, `thinkback`, `thinkbackPlay`, `passes`, `stickers`, `upgrade`, `extra-usage` exports.

Also remove from any secondary export lists near lines ~692–705.

- [ ] **Step 2: Remove DesktopUpsell from `REPL.tsx`**

Remove import, state `showDesktopUpsellStartup`, dialog branch `'desktop-upsell'`, and render of `<DesktopUpsellStartup />`.

- [ ] **Step 3: Clean LogoV2 / CondensedLogo / feedConfigs / Usage**

Remove guest-passes and overage-credit feed branches; keep recent activity + what’s-new feeds.

- [ ] **Step 4: Clean tipRegistry upsell tips** (`install-slack-app`, overage credit tip using `shouldShowOverageCreditUpsell`)

- [ ] **Step 5: Grep referral/passes prefetch**

```bash
rg -n "prefetchPasses|GuestPasses|OverageCredit|install-slack|thinkback|/upgrade|/passes|stickermule" src
```

Remove or stub safely; delete `src/services/api/referral.ts` only if nothing essential remains.

- [ ] **Step 6: Delete command/UI directories listed above**

- [ ] **Step 7: Re-run Task 1 regression test — expect PASS**

```bash
bun test src/__tests__/no-openclaude-cruft.test.ts
bun run build
```

- [ ] **Step 8: Do not commit**

---

### Task 5: README / docs cleanup

**Files:**
- Modify: `cli/README.md`, optionally root `README.md`
- Delete if unused: `cli/docs/assets/atomic-chat-logo.png`, `atlas-cloud-banner.png` **only if** no longer referenced after Sponsors removal (providers table may still want logos — if used only in Sponsors, delete)

- [ ] **Step 1: Remove from `cli/README.md`**

- Sponsors section + logo table
- Nav link `| [Sponsors](#sponsors)`
- Trendshift / Discord / GitLawb mirror badges that are marketing (keep CI badge only if still accurate for *this* repo; otherwise remove or retarget StillHue/claudio)
- “Meet your buddy” section and Why-Claudio bullet about pixel companion
- Any `/buddy` examples

- [ ] **Step 2: Keep**

- Install: `npm install -g @gaburieuru/claudio@latest`
- Providers table (Atomic/MiMo/Atlas/OpenGateway as backends OK)
- Lineage / not affiliated with Anthropic disclaimer

- [ ] **Step 3: Grep docs**

```bash
rg -n "Sponsors|/buddy|ads\.gitlawb|/ads on|Stickermule|opengateway credits" cli/README.md README.md docs
```

- [ ] **Step 4: Do not commit**

---

### Task 6: Final verification

**Files:** none new

- [ ] **Step 1: Build + smoke**

```bash
bun run build
node dist/cli.mjs --version
```

Expected: `0.24.0 (Claudio)` (or current version)

- [ ] **Step 2: Grep ban list**

```bash
rg -n "ads\.gitlawb|sponsoredTips|gitlawbEarn|isBuddyEnabled|CompanionSprite|/buddy|/ads" src
rg -n "Sponsors|Meet your buddy" cli/README.md
```

Expected: no hits in `src`; no Sponsors/buddy pitch in README.

- [ ] **Step 3: Optional local tip/unit tests**

```bash
bun test src/services/tips/tipScheduler.test.ts src/__tests__/no-openclaude-cruft.test.ts
```

- [ ] **Step 4: Report to user** — list deleted surfaces; ask whether to commit and/or `npm publish`

- [ ] **Step 5: Do not publish or commit unless asked**

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Remove ads / earning / sponsored tips | 2 |
| Remove buddy | 3 |
| Remove stickers/upgrade/passes/extra-usage/mobile/slack/thinkback/desktop upsell/overage upsell | 4 |
| README Sponsors + buddy docs | 5 |
| Keep providers + educational tips + analytics stubs | Global + Tasks 2–4 (do not touch) |
| Build + smoke | 6 |
| No auto npm publish | Global + Task 6 |

## Placeholder scan

None intentional. Task 1’s command-list helper must be filled from the repo’s existing pattern during Step 1 of Task 1.
