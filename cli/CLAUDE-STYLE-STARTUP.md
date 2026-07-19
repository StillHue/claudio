# Claudio — Claude Code–style startup (local fork notes)

This monorepo ships the Claudio CLI under `cli/` with a Claude Code–inspired
startup (Clawd scene, terracotta accent). Welcome text: **Welcome to Claude Code**.
Product name elsewhere: **Claudio**.

## Rebuild / link

```bash
cd cli
bun run build
npm link
claudio --version
```

## Revert branding

Restore `src/constants/brand.ts` and related theme/startup files from git history, then rebuild.
