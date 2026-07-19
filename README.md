# Claudio

<p align="center">
<pre style="display:inline-block;text-align:left;line-height:1.15;font-size:11px;background:transparent;border:none;margin:0">
<span style="color:#6b6b6b">                                                          </span>
<span style="color:#6b6b6b">     *                                       █████▓░     </span>
<span style="color:#6b6b6b">                                 *         ███▓░     ░░   </span>
<span style="color:#6b6b6b">            ░░░░░░                        ███▓░           </span>
<span style="color:#6b6b6b">    ░░░   ░░░░░░░░░░                      ███▓░           </span>
<span style="color:#6b6b6b">   ░░░░░░░░░░░░░░░░░░    *                ██▓░░      ▓   </span>
<span style="color:#6b6b6b">                                             ░▓▓███▓▓░    </span>
<span style="color:#6b6b6b"> *                                 ░░░░                   </span>
<span style="color:#6b6b6b">                                 ░░░░░░░░                 </span>
<span style="color:#6b6b6b">                               ░░░░░░░░░░░░░░           </span>
<span style="color:#6b6b6b">       </span><span style="color:#D97757">█████████</span><span style="color:#6b6b6b">                                        *</span>
<span style="color:#6b6b6b">      </span><span style="color:#D97757">██▄█████▄██</span><span style="color:#6b6b6b">                        *                </span>
<span style="color:#6b6b6b">       </span><span style="color:#D97757">█████████</span><span style="color:#6b6b6b">       *                                   </span>
<span style="color:#6b6b6b">·······</span><span style="color:#D97757">█ █   █ █</span><span style="color:#6b6b6b">··········································</span>
</pre>
</p>

<p align="center">
<strong>Welcome to Claude Code</strong><br/>
<em>you already know me</em>
</p>

**Claudio** is an open-source coding-agent CLI — Claude Code–style UX, any LLM provider. Install once, use in the terminal or behind the official Claude Code Cursor/VS Code extension.

> Not an official Anthropic product. CLI lineage includes Claude Code–derived code; see [LICENSE](./LICENSE).

## Install

```bash
npm install -g @gaburieuru/claudio@latest
claudio
```

Requires **Node.js ≥ 22**.

## What you get

| Piece | Role |
| --- | --- |
| **CLI** (`claudio`) | Multi-LLM coding agent |
| **Cursor extension** | Activity Bar + editor-tab terminal |
| **Claude Code wrapper** | Official Claude Code UI → Claudio engine (`claudeCode.claudeProcessWrapper`) |

## Quick start

```bash
claudio
# /provider  → pick OpenAI-compat, Groq, OpenCode Zen, local, …
```

Or from source:

```bash
cd openclaude-fork
bun install && bun run build
npm link
claudio --version
```

## Claude Code extension (Cursor / VS Code)

1. Install marketplace extension `anthropic.claude-code`
2. Set `claudeCode.claudeProcessWrapper` to the absolute path of `claude-wrapper/claudio-wrapper.js` (or a compiled `.exe` on Windows)
3. Optional: `claudeCode.disableLoginPrompt: true` when auth is via your provider profile

On Windows, prefer a real executable wrapper (`.exe`) — spawning `.cmd` can fail with `spawn EINVAL`.

## Vision (text-only models)

Paste an image in Claude Code / Claudio: if `GROQ_API_KEY` (or `CLAUDE_CODE_VISION_API_KEY`) is set, a vision model describes the image and the main coding model only receives text.

## Security

- Never commit API keys or `.env` files
- Keys live in env / OS keychain / `~/.openclaude` settings — not this repo
- Report security issues privately

## License

MIT for Claudio-authored parts (extension, wrapper, branding/docs), **2026**.  
Claude Code–derived code: see [LICENSE](./LICENSE).

## Credits

- Anthropic — Claude Code (product / lineage)
- Clawd mascot aesthetic inspired by Claude Code welcome art

## Contributing

1. Do not commit secrets or `node_modules`
2. User-facing agent identity: **Claude** (package/binary name remains `claudio`)
3. Small, reviewable PRs; build the CLI package before opening a PR
