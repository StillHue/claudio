# Claudio browser proxy (personal)

Route the **official** Claude Chrome/Edge extension through an HTTPS MITM proxy so chat inference runs on **your** provider (OpenCode Zen / `big-pickle` / etc.) instead of Anthropic.

This does **not** copy or redistribute Anthropic’s extension. Personal use only; ToS risk is yours.

## Recommended: Fly.io (no local Node)

```powershell
cd browser-proxy
fly apps create claudio-browser-proxy   # once
fly volumes create proxy_data --region gru --size 1
fly secrets set OPENAI_BASE_URL="https://opencode.ai/zen/v1" OPENAI_MODEL="big-pickle" OPENAI_API_KEY="…" PROXY_USER="gab" PROXY_PASS="…"
fly deploy
```

Local secrets file (not in git): `%USERPROFILE%\.openclaude\browser-proxy-fly.json`

```json
{ "host": "claudio-browser-proxy.fly.dev", "port": 8080, "user": "gab", "pass": "…" }
```

Open Edge (downloads/trusts CA + loads extension):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\open-claude-fly.ps1
```

- Health: `http://claudio-browser-proxy.fly.dev:8080/health`
- CA: `http://claudio-browser-proxy.fly.dev:8080/ca.crt`

Still need Anthropic login in the extension UI (paid plan gate). After that, `/v1/messages` is answered by Zen via Fly.

## Local Node (optional)

```
Official Claude extension
    → proxy (127.0.0.1:18765)
        → mode local:       POST /v1/messages → claudio -p OR OpenAI bridge
        → mode passthrough: same request → api.anthropic.com
```

Only `api.anthropic.com` is decrypted. Other CONNECT targets are tunneled untouched.

## Quick start (local)

```powershell
cd browser-proxy
npm install
npm start
# first run writes CA to %USERPROFILE%\.openclaude\browser-proxy\ca\
npm run install-ca
```

1. Trust the CA (`scripts/install-ca.ps1` or import `ca.crt` in `certmgr.msc`).
2. Point Edge at the proxy (see below).
3. Open the Claude side panel, send **oi** — reply should come from Claudio when `mode=local`.
4. Kill switch: stop the proxy **or** `POST /mode` → `passthrough` **or** clear the browser proxy.

Healthcheck:

```powershell
curl http://127.0.0.1:18765/health
```

## Edge proxy (Windows)

### Option A — system / WinINET (simplest)

Settings → Network & internet → Proxy → Manual proxy → `127.0.0.1` port `18765`.

Or:

```powershell
netsh winhttp set proxy 127.0.0.1:18765
# clear later:
netsh winhttp reset proxy
```

Edge often follows system proxy; restart Edge after changes.

### Option B — Edge only (recommended)

Launch a dedicated profile with proxy flags:

```powershell
& "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe" `
  --user-data-dir="$env:TEMP\edge-claudio-proxy" `
  --proxy-server="http://127.0.0.1:18765"
```

Install the Claude extension in that profile from the store, trust the CA, then chat.

## Mode toggle

Config file: `%USERPROFILE%\.openclaude\browser-proxy.json`

```json
{
  "mode": "local",
  "port": 18765,
  "claudioBin": "claudio",
  "model": "big-pickle",
  "mitmHosts": ["api.anthropic.com"],
  "interceptPaths": ["/v1/messages"]
}
```

Runtime (no restart for mode):

```powershell
# local = Claudio
curl -Method POST http://127.0.0.1:18765/mode -ContentType application/json -Body '{"mode":"local"}'
# passthrough = real Anthropic
curl -Method POST http://127.0.0.1:18765/mode -ContentType application/json -Body '{"mode":"passthrough"}'
```

CLI flags / env:

- `--local` / `--passthrough` / `--mode local|passthrough`
- `CLAUDIO_BROWSER_PROXY_MODE`, `CLAUDIO_BROWSER_PROXY_PORT`, `CLAUDIO_BROWSER_PROXY_MODEL`, `CLAUDIO_BROWSER_PROXY_BIN`

## What is intercepted (v1)

| Host | Path | local mode |
| ---- | ---- | ---------- |
| `api.anthropic.com` | `POST /v1/messages` (+ `?beta=true`) | → Claudio `-p --bare --tools ""` stream-json → Anthropic SSE |
| anything else on that host | oauth, domain_info, telemetry, models, … | passthrough |
| other hosts | CONNECT | tunnel (no MITM) |

See [docs/recon.md](./docs/recon.md) for hosts/paths/auth/streaming from the installed extension (v1.0.81) — **no tokens**.

## Requirements

- Node 20+
- `claudio` on PATH (or set `claudioBin`)
- Windows user Root trust for `~/.openclaude/browser-proxy/ca/ca.crt`
- Extension updates / **certificate pinning** may break MITM → fall back to a custom extension (approach A)

## Privacy

- CA private key stays under `~/.openclaude/browser-proxy/` (not in git).
- Do not commit Anthropic CRX/source, cookies, or OAuth tokens.
- Logs: `~/.openclaude/browser-proxy/proxy.log` (paths/methods only; avoid pasting Authorization headers).
