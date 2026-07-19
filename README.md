# Claudio

**Claudio** is an open-source coding-agent CLI and Cursor/VS Code integration, branded for a Claude Code–style experience while remaining multi-provider.

> **Lineage:** Anthropic [Claude Code](https://code.claude.com) (proprietary CLI) → community [OpenClaude](https://github.com/Gitlawb/openclaude) → **Claudio** (this repository).

Claudio is **not** an official Anthropic product. The CLI under `openclaude-fork/` is based on OpenClaude, which itself contains code derived from Claude Code. Read [LICENSE](./LICENSE) and `openclaude-fork/LICENSE` before redistributing.

## What you get

| Path | Role |
| --- | --- |
| `openclaude-fork/` | CLI binary **`claudio`** — multi-LLM coding agent; splash shows **Welcome to Claude Code**; product chrome uses the name **Claudio** |
| `openclaude-cursor-ext/` | Cursor/VS Code extension — Activity Bar icon + full editor-tab terminal (OpenCode-style) |
| `openclaude-wrapper/` | Optional process wrapper so the **official** Claude Code extension UI can launch **Claudio** via `claudeCode.claudeProcessWrapper` |

## Security

- **Never commit API keys, tokens, or `.env` files.** Use `.env.example` patterns only.
- Provider keys belong in your local environment or OS keychain — not in this repo.
- Before contributing, run a secret scan on your diff (`git diff` / `gitleaks` / IDE scan).
- The official Claude Code extension + wrapper path executes your local `claudio` binary; treat that binary like any privileged developer tool.
- Report security issues privately when possible; do not open public issues that include live credentials.

## Requirements

- Node.js **≥ 22** (see fork engines)
- [Bun](https://bun.sh) recommended for building the CLI
- Windows, macOS, or Linux

## Install (no clone needed)

```bash
npm install -g @gaburieuru/claudio@latest
# or
bun install -g @gaburieuru/claudio@latest

claudio
```

Publishing: pushes to `main` that bump `openclaude-fork/package.json` `version` above the npm registry version auto-publish `@gaburieuru/claudio` via `.github/workflows/publish-claudio-npm.yml` (requires repo secret `NPM_TOKEN`).

## Quick start (from source)

```bash
cd openclaude-fork
bun install
bun run build
npm link
claudio --version
# → 0.25.0 (Claudio)
```

Configure providers via environment variables / OpenClaude docs in `openclaude-fork/docs/`. Prefer project-local `.env` (gitignored) over committing secrets.

## Cursor / VS Code extension

```bash
cd openclaude-cursor-ext
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
# Install the generated .vsix into Cursor/VS Code
```

Settings (optional):

- `claudio.command` — default `claudio`
- `claudio.args` — extra CLI args

## Official Claude Code UI → Claudio engine

1. Install the marketplace extension `anthropic.claude-code`.
2. Point the process wrapper at this repo’s script (adjust the absolute path):

```json
{
  "claudeCode.claudeProcessWrapper": "C:\\Users\\YOU\\claudio\\openclaude-wrapper\\openclaude-wrapper.cmd"
}
```

On Unix, invoke the `.js` with `node` or add a small shell wrapper. The wrapper drops the extension’s bundled binary argument and runs your linked `claudio` instead.

**Compatibility:** the official extension protocol and the fork version may diverge. If the panel fails, use the CLI or the Claudio editor-tab extension.

## License

MIT for Claudio-authored parts (extension, wrapper, branding/docs), **2026**.  
Upstream Claude Code–derived code: see [LICENSE](./LICENSE) notice and `openclaude-fork/LICENSE`.

## Credits

- [OpenClaude](https://github.com/Gitlawb/openclaude) — multi-provider Claude Code–style CLI
- Anthropic — Claude Code (proprietary product / original lineage)
- Claude asterisk mark used for IDE chrome is brand-inspired; trademarks belong to their owners

## Contributing

1. Do not commit secrets, personal `.env`, or `node_modules`.
2. Keep user-facing brand strings as **Claudio**; welcome splash remains **Claude Code**.
3. Prefer small, reviewable PRs.
4. Run `bun run build` in `openclaude-fork` (and extension build if you touch it) before opening a PR.
