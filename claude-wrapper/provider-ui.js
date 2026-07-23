#!/usr/bin/env node
/**
 * Local provider setup UI (127.0.0.1 only).
 * Started from Claude via /provider — API key never enters the chat transcript.
 *
 *   node provider-ui.js
 *   node provider-ui.js --no-open
 */
const http = require('http')
const { randomBytes } = require('crypto')
const { exec } = require('child_process')
const {
  refreshCatalog,
  loadCatalog,
  listProviders,
  enableProvider,
} = require('./provider-catalog')

const sessionToken = randomBytes(24).toString('hex')
const noOpen = process.argv.includes('--no-open')

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect a provider · Claude</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  :root {
    color-scheme: dark;
    --bg: #141413;
    --card: #1c1c1a;
    --text: #faf9f5;
    --muted: #b0aea5;
    --border: #2e2e2b;
    --accent: #d97757;
    --accent-hover: #e0896a;
    --ok: #9aaf7a;
    --err: #e08a7c;
    --focus: #6a9bcc;
    --input-bg: #141413;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: Lora, Georgia, "Times New Roman", serif;
    font-size: 15px;
    line-height: 1.5;
    background: var(--bg);
    color: var(--text);
  }
  main { max-width: 440px; margin: 56px auto; padding: 0 20px; }
  .mark {
    font-family: Poppins, Arial, sans-serif;
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--accent);
    margin: 0 0 18px;
  }
  h1 {
    font-family: Poppins, Arial, sans-serif;
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0 0 8px;
    color: var(--text);
  }
  p.sub {
    font-family: Lora, Georgia, serif;
    color: var(--muted);
    margin: 0 0 28px;
    font-size: 14px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 1px 2px rgba(20, 20, 19, 0.04);
  }
  label {
    display: block;
    font-family: Poppins, Arial, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted);
    margin: 16px 0 8px;
  }
  label:first-of-type { margin-top: 0; }
  select, input {
    width: 100%;
    padding: 11px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--input-bg);
    color: var(--text);
    font-family: Poppins, Arial, sans-serif;
    font-size: 14px;
  }
  select:focus, input:focus {
    outline: 2px solid color-mix(in srgb, var(--focus) 55%, transparent);
    outline-offset: 1px;
    border-color: var(--focus);
  }
  button {
    margin-top: 22px;
    width: 100%;
    padding: 12px 16px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: #141413;
    font-family: Poppins, Arial, sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--accent-hover); }
  button:disabled { opacity: 0.55; cursor: wait; }
  .msg { margin-top: 16px; font-size: 13px; font-family: Lora, Georgia, serif; }
  .ok { color: var(--ok); }
  .err { color: var(--err); }
  .meta {
    margin-top: 8px;
    color: var(--muted);
    font-family: Poppins, Arial, sans-serif;
    font-size: 11px;
    word-break: break-all;
  }
</style>
</head>
<body>
<main>
  <p class="mark">Claude</p>
  <h1>Connect a provider</h1>
  <p class="sub">Local only (127.0.0.1). Key is saved to ~/.claude-native/providers.json — not to Claude chat.</p>
  <div class="card">
    <label for="provider">Provider</label>
    <select id="provider"></select>
    <div class="meta" id="pinfo"></div>
    <label for="key">API key</label>
    <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste key"/>
    <label for="model">Default model (optional)</label>
    <input id="model" type="text" placeholder="Leave empty for catalog default"/>
    <button id="go" type="button">Save &amp; sync /model picker</button>
    <div class="msg" id="msg"></div>
  </div>
</main>
<script>
const TOKEN = ${JSON.stringify(sessionToken)};
const providerEl = document.getElementById('provider');
const pinfo = document.getElementById('pinfo');
const keyEl = document.getElementById('key');
const modelEl = document.getElementById('model');
const msg = document.getElementById('msg');
const go = document.getElementById('go');
let providers = [];

function setMsg(text, ok) {
  msg.textContent = text || '';
  msg.className = 'msg ' + (ok ? 'ok' : 'err');
}

async function load() {
  const r = await fetch('/api/providers');
  const data = await r.json();
  providers = data.providers || [];
  providerEl.innerHTML = providers.map(p =>
    '<option value="' + p.id + '">' + p.name + ' (' + p.id + ') · ' + p.modelCount + ' models</option>'
  ).join('');
  updateInfo();
}

function updateInfo() {
  const p = providers.find(x => x.id === providerEl.value);
  if (!p) { pinfo.textContent = ''; return; }
  pinfo.textContent = (p.apiKeyEnv ? ('Env: ' + p.apiKeyEnv + ' · ') : '') + (p.baseUrl || '');
}

providerEl.addEventListener('change', updateInfo);

go.addEventListener('click', async () => {
  setMsg('');
  go.disabled = true;
  try {
    const r = await fetch('/api/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Provider-UI-Token': TOKEN },
      body: JSON.stringify({
        providerId: providerEl.value,
        apiKey: keyEl.value,
        model: modelEl.value || undefined,
        token: TOKEN,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    keyEl.value = '';
    setMsg('Saved ' + data.provider + ' · ' + data.modelCount + ' models · picker ' + data.pickerId + '. Return to Claude → Reload / restart → /model', true);
    setTimeout(() => fetch('/api/shutdown', { method: 'POST', headers: { 'X-Provider-UI-Token': TOKEN } }).catch(() => {}), 800);
  } catch (e) {
    setMsg(e.message || String(e), false);
  } finally {
    go.disabled = false;
  }
});

load().catch(e => setMsg(e.message || String(e), false));
</script>
</body>
</html>`
}

function openBrowser(url) {
  const plat = process.platform
  if (plat === 'win32') exec(`cmd /c start "" "${url}"`)
  else if (plat === 'darwin') exec(`open "${url}"`)
  else exec(`xdg-open "${url}"`)
}

async function main() {
  console.log('Loading provider catalog…')
  let catalog = await refreshCatalog().catch(() => null)
  if (!catalog) catalog = await loadCatalog({ refresh: false })
  if (!catalog?.providers?.length) {
    console.error('Catalog empty. Check network / models.dev')
    process.exit(1)
  }

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '')
    if (host && !/^127\.0\.0\.1(?::\d+)?$/i.test(host) && !/^localhost(?::\d+)?$/i.test(host)) {
      return json(res, 403, { error: 'host not allowed' })
    }
    const origin = String(req.headers.origin || '')
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return json(res, 403, { error: 'origin not allowed' })
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')

    if (req.method === 'GET' && url.pathname === '/') {
      const body = htmlPage()
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(body)
    }

    if (req.method === 'GET' && url.pathname === '/api/providers') {
      const list = listProviders(catalog, { bridgeOnly: true }).map((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKeyEnv: p.apiKeyEnv,
        modelCount: p.modelCount,
      }))
      return json(res, 200, { providers: list })
    }

    if (req.method === 'POST' && url.pathname === '/api/enable') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        return json(res, 400, { error: 'invalid JSON' })
      }
      const headerTok = String(req.headers['x-provider-ui-token'] || '')
      if (body.token !== sessionToken && headerTok !== sessionToken) {
        return json(res, 401, { error: 'invalid session token' })
      }
      try {
        // Reload catalog in case sync changed
        catalog = (await loadCatalog({ refresh: false })) || catalog
        const result = enableProvider(catalog, body.providerId, {
          apiKey: body.apiKey,
          model: body.model,
          setActive: true,
        })
        return json(res, 200, {
          provider: result.provider,
          model: result.model,
          modelCount: result.modelCount,
          pickerId: result.pickerId,
          path: result.path,
        })
      } catch (err) {
        return json(res, 400, { error: err.message || String(err) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/shutdown') {
      const headerTok = String(req.headers['x-provider-ui-token'] || '')
      if (headerTok !== sessionToken) return json(res, 401, { error: 'invalid session token' })
      json(res, 200, { ok: true })
      setTimeout(() => {
        server.close()
        process.exit(0)
      }, 100)
      return
    }

    return json(res, 404, { error: 'not found' })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`
  console.log(`Provider UI: ${url}`)
  console.log('Pick a provider, paste API key, save. Then return to Claude and /model.')
  if (!noOpen) openBrowser(url)

  // Auto-exit if left open too long
  setTimeout(() => {
    console.error('Provider UI timed out (10 min). Exiting.')
    server.close()
    process.exit(1)
  }, 10 * 60 * 1000).unref?.()
}

main().catch((err) => {
  console.error('[provider-ui]', err.message || err)
  process.exit(1)
})
