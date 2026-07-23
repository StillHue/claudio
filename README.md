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

Coding agent CLI — any LLM. Terminal or Cursor.

## Install

Requires **Node.js >= 22**.

```bash
npm install -g @gaburieuru/claudio@latest
```

Verify it worked:

```bash
claudio --version
```

## Quick Start

### First run

```bash
claudio
```

On first launch, run `/provider` inside Claudio for guided provider setup (API keys, model selection, saved profiles).

### OpenAI / OpenRouter / any OpenAI-compatible API

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-your-key-here
export OPENAI_MODEL=gpt-4o

claudio
```

Windows PowerShell:

```powershell
$env:CLAUDE_CODE_USE_OPENAI="1"
$env:OPENAI_API_KEY="sk-your-key-here"
$env:OPENAI_MODEL="gpt-4o"
claudio
```

### Local Ollama

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=qwen2.5-coder:7b

claudio
```

### OpenCode Zen (pay-as-you-go, 48 models)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=https://opencode.ai/zen/v1
export OPENAI_MODEL=deepseek-v4-flash-free
export OPENCODE_API_KEY=your-key-here

claudio
```

## Features

- **Multi-provider**: OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Groq, DeepSeek, OpenCode Zen/Go, and more
- **Tool-driven workflows**: Bash, file read/write/edit, grep, glob, agents, tasks, MCP, web search
- **Streaming responses**: Real-time token output
- **Vision routing**: Images described via Groq for text-only models, so you can paste images with any provider
- **Background sessions**: Run long tasks detached (`claudio --bg "fix failing tests"`)
- **Resume/fork conversations**: `claudio --resume <id>` or `claudio --continue`
- **Cursor + official Claude Code**: Thin process wrapper keeps Anthropic’s harness; only inference is redirected (OpenCode Zen, Cohere, …). See [claude-wrapper/SETUP-GUIDE.md](./claude-wrapper/SETUP-GUIDE.md)
- **VS Code extension**: Launch integration, provider-aware Control Center, in-editor chat

## Supported Providers

| Provider | Setup | Notes |
| --- | --- | --- |
| OpenAI-compatible | `/provider` or env vars | OpenAI, OpenRouter, DeepSeek, Groq, Mistral, LM Studio, etc. |
| OpenCode Zen | `/provider` or env vars | 48 models, pay-as-you-go, `OPENCODE_API_KEY` |
| OpenCode Go | `/provider` or env vars | $10/mo subscription, 13 open models |
| Gemini | `/provider` or env vars | API key only |
| GitHub Models | `/onboard-github` | Interactive onboarding |
| Codex OAuth | `/provider` | Browser sign-in, stored credentials |
| Ollama | `/provider` or env vars | Local inference, no API key |
| Fireworks AI | `/provider` or env vars | 276 curated models |
| Xiaomi MiMo | `/provider` or env vars | `MIMO_API_KEY` |
| NEAR AI | `/provider` or env vars | Unified gateway |
| Cloudflare Workers AI | `/provider` or env vars | `CLOUDFLARE_API_TOKEN` |
| Bedrock / Vertex / Foundry | env vars | Anthropic-family cloud routes |

Full details in [cli/README.md](./cli/README.md).

## From Source

```bash
cd cli
bun install && bun run build
npm link
```

Requires Bun >= 1.3.13 for source builds.

## Cursor (official Claude Code panel)

Recommended path: keep the **official Claude Code** extension and point
`claudeCode.claudeProcessWrapper` at the native wrapper. Inference goes to
OpenCode Zen / Cohere / etc.; tools, permissions, and Thoughts UI stay native.

Full agent/human setup: **[claude-wrapper/SETUP-GUIDE.md](./claude-wrapper/SETUP-GUIDE.md)**.

Legacy: `CLAUDE_WRAPPER_MODE=claudio` still swaps in the Claudio CLI instead of
`claude.exe` — prefer native mode.

## Browser Proxy

Official Claude Edge/Chrome extension -> Fly MITM -> your Zen/OpenAI provider. See [browser-proxy/README.md](./browser-proxy/README.md).

## Cursor Agent provider

Use Cursor subscription models (Composer, Grok, …) as Claudio’s LLM via a local OpenAI-compatible proxy. See [docs/cursor-agent-provider.md](./docs/cursor-agent-provider.md) and [cursor-provider/start-proxy.cmd](./cursor-provider/start-proxy.cmd).

## Docs

- [Claude Code native wrapper (Cursor)](./claude-wrapper/SETUP-GUIDE.md)
- [Cursor Agent provider](./docs/cursor-agent-provider.md)
- [Non-Technical Setup](./cli/docs/non-technical-setup.md)
- [Windows Quick Start](./cli/docs/quick-start-windows.md)
- [macOS / Linux Quick Start](./cli/docs/quick-start-mac-linux.md)
- [Advanced Setup](./cli/docs/advanced-setup.md)
- [Smart Auto-Routing](./cli/docs/smart-routing.md)
- [Agent Routing](./cli/docs/agent-routing.md)

## Community

- [GitHub Issues](https://github.com/StillHue/claudio/issues) — bugs and features
- [GitHub Discussions](https://github.com/StillHue/claudio/discussions)

## License

MIT. See [LICENSE](./LICENSE).

Claudio is an independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic PBC.
