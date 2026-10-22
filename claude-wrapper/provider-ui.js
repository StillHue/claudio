/**
 * First-run setup page on 127.0.0.1. Opens with no model registered.
 * The API key is written to ~/.claude/.env and never into providers.json.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { randomBytes } = require('crypto')
const { claudeHomeDir, ensureDir } = require('./lib/wrapper/paths')

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function setupDefaults(wrapperDir) {
  const data =
    readJson(path.join(wrapperDir, 'providers.json')) ||
    readJson(path.join(wrapperDir, 'providers.example.json')) ||
    {}
  const id = data.active && data.providers?.[data.active] ? data.active : 'nvidia'
  const entry = data.providers?.[id] || {}
  return {
    id,
    baseUrl: entry.baseUrl || 'https://integrate.api.nvidia.com/v1',
    model: entry.model || '',
    apiKeyEnv: entry.apiKeyEnv || 'NVIDIA_API_KEY',
  }
}

function renderPage(fields, { error = '', saved = false } = {}) {
  if (saved) {
    return `<!doctype html><meta charset="utf-8"><title>Provider</title>
<body style="font:16px/1.4 sans-serif;max-width:36rem;margin:3rem auto">
<p>Provider e modelo gravados. Recarrega a janela do IDE e abre o Claude Code de novo.</p>
</body>`
  }
  return `<!doctype html><meta charset="utf-8"><title>Provider</title>
<body style="font:16px/1.4 sans-serif;max-width:36rem;margin:3rem auto">
<h1>Provider</h1>
<p>Nenhum modelo precisa estar cadastrado. Preenche e salva.</p>
${error ? `<p>${esc(error)}</p>` : ''}
<form method="post">
<label>Provedor<br><input name="id" value="${esc(fields.id)}" required></label><br><br>
<label>URL<br><input name="baseUrl" value="${esc(fields.baseUrl)}" required></label><br><br>
<label>Modelo<br><input name="model" value="${esc(fields.model)}" required></label><br><br>
<label>Variável da chave<br><input name="apiKeyEnv" value="${esc(fields.apiKeyEnv)}" required></label><br><br>
<label>Chave<br><input name="apiKey" type="password" required autocomplete="off"></label><br><br>
<button type="submit">Salvar</button>
</form>
</body>`
}

function validate(body) {
  const id = String(body.id || '').trim()
  const baseUrl = String(body.baseUrl || '').trim().replace(/\/$/, '')
  const model = String(body.model || '').trim()
  const apiKeyEnv = String(body.apiKeyEnv || '').trim()
  const apiKey = String(body.apiKey || '').trim()
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(id)) return 'Provedor inválido.'
  if (!/^https?:\/\//i.test(baseUrl)) return 'URL precisa começar com http:// ou https://.'
  if (!model || /[\r\n]/.test(model)) return 'Modelo vazio.'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) return 'Nome da variável inválido.'
  if (!apiKey || /[\r\n]/.test(apiKey)) return 'Chave vazia.'
  return { id, baseUrl, model, apiKeyEnv, apiKey }
}

function quoteEnv(value) {
  if (/[\s#'"\\]/.test(value)) return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return value
}

function upsertEnv(envFile, key, value) {
  ensureDir(path.dirname(envFile))
  const line = `${key}=${quoteEnv(value)}`
  let text = ''
  try {
    text = fs.readFileSync(envFile, 'utf8')
  } catch {
    text = ''
  }
  const lines = text.split(/\r?\n/)
  let found = false
  const next = lines.map((row) => {
    if (row.trim().startsWith(`${key}=`) || row.trim().startsWith(`${key} =`)) {
      found = true
      return line
    }
    return row
  })
  if (!found) next.push(line)
  const out = next.filter((row, i, arr) => row !== '' || i < arr.length - 1).join('\n')
  fs.writeFileSync(envFile, out.endsWith('\n') ? out : `${out}\n`, 'utf8')
}

function applySetup(fields, { wrapperDir, envFile }) {
  const providersPath = path.join(wrapperDir, 'providers.json')
  const data = {
    active: fields.id,
    providers: {
      [fields.id]: {
        baseUrl: fields.baseUrl,
        model: fields.model,
        apiKeyEnv: fields.apiKeyEnv,
        tools: true,
        format: 'chat',
        models: [fields.model],
      },
    },
    pickerModels: [fields.model],
  }
  ensureDir(wrapperDir)
  fs.writeFileSync(providersPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
  upsertEnv(envFile, fields.apiKeyEnv, fields.apiKey)
  return { providersPath, envFile }
}

function parseForm(raw) {
  const params = new URLSearchParams(raw)
  return Object.fromEntries(params.entries())
}

function openBrowser(url) {
  if (process.platform === 'win32') exec(`cmd /c start "" "${url}"`)
  else if (process.platform === 'darwin') exec(`open "${url}"`)
  else exec(`xdg-open "${url}"`)
}

function openProviderSetup({ wrapperDir, envFile, open = true, log = () => {} } = {}) {
  const dir = wrapperDir || __dirname
  const envPath = envFile || path.join(claudeHomeDir(), '.env')
  const token = randomBytes(18).toString('hex')
  let fields = setupDefaults(dir)

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const host = req.socket.remoteAddress || ''
      if (host !== '127.0.0.1' && host !== '::ffff:127.0.0.1' && host !== '::1') {
        res.writeHead(403)
        res.end('local only')
        return
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.searchParams.get('t') !== token) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(renderPage(fields))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end('method')
        return
      }
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const checked = validate(parseForm(Buffer.concat(chunks).toString('utf8')))
        if (typeof checked === 'string') {
          fields = { ...fields, ...parseForm(Buffer.concat(chunks).toString('utf8')), apiKey: '' }
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          res.end(renderPage(fields, { error: checked }))
          return
        }
        applySetup(checked, { wrapperDir: dir, envFile: envPath })
        log(`provider setup saved ${checked.id}/${checked.model}`)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(renderPage(fields, { saved: true }))
        server.close(() => resolve({ saved: true }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const page = `http://127.0.0.1:${server.address().port}/?t=${token}`
      console.error(`[claude-wrapper] Abrindo a página de provider (sem modelo cadastrado):\n  ${page}`)
      if (open) openBrowser(page)
    })
  })
}

module.exports = { renderPage, validate, applySetup, setupDefaults, openProviderSetup }

if (require.main === module) {
  openProviderSetup().then(() => process.exit(0))
}
