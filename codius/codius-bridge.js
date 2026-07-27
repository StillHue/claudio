#!/usr/bin/env node
const http = require('http')
const https = require('https')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')

const PROVIDERS_PATH = path.join(os.homedir(), '.claude-native', 'providers.json')
const PORT = parseInt(process.env.CODIUS_PORT || '4890', 10)
const DEBUG = process.env.CODIUS_DEBUG === '1'

function log(...a) { if (DEBUG) console.error('[codius]', ...a) }

function loadProviders() {
  try {
    const raw = fs.readFileSync(PROVIDERS_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    const active = cfg.active || 'opencode'
    const provider = cfg.providers?.[active]
    if (!provider?.apiKey) return null
    return {
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      model: provider.model,
      apiKey: provider.apiKey,
    }
  } catch { return null }
}

function forwardToProvider(body) {
  const provider = loadProviders()
  if (!provider) {
    return { status: 502, body: { error: { message: 'No provider configured. Run /provider or set ~/.claude-native/providers.json' } } }
  }

  const upstreamModel = body.model || provider.model
  const upstreamBody = {
    ...body,
    model: upstreamModel,
    stream: body.stream || false,
  }
  delete upstreamBody.user

  const url = new URL(provider.baseUrl + '/chat/completions')

  return new Promise((resolve) => {
    const data = JSON.stringify(upstreamBody)
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Length': Buffer.byteLength(data),
      },
    }

    if (upstreamBody.stream) {
      options.headers['Accept'] = 'text/event-stream'
    }

    const proto = url.protocol === 'http:' ? http : https
    const req = proto.request(options, (res) => {
      if (upstreamBody.stream) {
        resolve({ status: res.statusCode, stream: true, pipe: res })
        return
      }

      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString()
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch {
          resolve({ status: res.statusCode, body: { error: { message: 'upstream parse error' } } })
        }
      })
    })

    req.on('error', (err) => {
      resolve({ status: 502, body: { error: { message: err.message } } })
    })

    req.write(data)
    req.end()
  })
}

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve(null)
      }
    })
  })
}

function handleApi(req, res) {
  log(`${req.method} ${req.url}`)

  if (req.url === '/v1/models' || req.url === '/v1/models/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
        { id: 'gpt-5.2', object: 'model' },
        { id: 'codius/proxy', object: 'model' },
      ],
    }))
    return
  }

  if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/v1/completions')) {
    parseBody(req).then(async (body) => {
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid JSON' } }))
        return
      }

      const upstreamRes = await forwardToProvider(body)

      if (upstreamRes.stream && upstreamRes.pipe) {
        res.writeHead(upstreamRes.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        upstreamRes.pipe.pipe(res)

        upstreamRes.pipe.on('error', () => {
          try { res.end() } catch {}
        })
        req.on('close', () => {
          try { upstreamRes.pipe.destroy() } catch {}
        })
        return
      }

      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify(upstreamRes.body))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'not found' } }))
}

function startBridge() {
  const server = http.createServer(handleApi)

  server.on('connect', (req, clientSocket, head) => {
    const [host, port] = req.url.split(':')
    if (host !== 'api.openai.com') {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }

    const serverSocket = net.connect(parseInt(port, 10) || 443, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      serverSocket.write(head)
      serverSocket.pipe(clientSocket)
      clientSocket.pipe(serverSocket)
    })

    serverSocket.on('error', () => clientSocket.end())
    clientSocket.on('error', () => serverSocket.end())
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`codius bridge running on http://127.0.0.1:${PORT}`)
    console.log(`Set HTTPS_PROXY=http://127.0.0.1:${PORT} and NO_PROXY=localhost,127.0.0.1`)
  })

  return server
}

if (require.main === module) {
  startBridge()
}

module.exports = { startBridge }
