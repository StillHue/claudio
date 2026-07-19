# Claudio — Claude Code–style startup (local fork notes)

This monorepo ships the Claudio CLI under `openclaude-fork/` with a Claude Code–inspired
startup (Clawd scene, terracotta accent). Welcome text: **Welcome to Claude Code**.
Product name elsewhere: **Claudio**.

## Rebuild / link

```bash
cd openclaude-fork
bun run build
npm link
claudio --version
```

## Revert branding

Restore `src/constants/brand.ts` and related theme/startup files from git history, then rebuild.
