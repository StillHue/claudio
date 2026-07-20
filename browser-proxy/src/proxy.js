import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import fs from 'node:fs'
import { URL } from 'node:url'
import { ensureCA, getHostCertificate, CA_CERT_PATH } from './ca.js'
import { checkProxyAuth, hostMatches } from './config.js'
import { bridgeMessagesToClaudio } from './bridge.js'
import { shouldInterceptPath } from './translator.js'

function denyProxyAuth(clientSocketOrRes, isSocket) {
  const body =
    'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="claudio-browser-proxy"\r\nContent-Length: 0\r\n\r\n'
  if (isSocket) {
    clientSocketOrRes.write(body)
    clientSocketOrRes.end()
  } else {
    clientSocketOrRes.writeHead(407, {
      'Proxy-Authenticate': 'Basic realm="claudio-browser-proxy"',
    })
    clientSocketOrRes.end()
  }
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function scrubHeaders(headers) {
  const out = { ...headers }
  // Avoid hop-by-hop issues
  delete out['proxy-connection']
  delete out['proxy-authorization']
  delete out.connection
  delete out['keep-alive']
  delete out['transfer-encoding']
  delete out['content-length']
  return out
}

function forwardHttps(hostname, req, body, res) {
  const headers = scrubHeaders(req.headers)
  headers.host = hostname
  if (body?.length) headers['content-length'] = String(body.length)

  const upstream = https.request(
    {
      hostname,
      port: 443,
      path: req.url,
      method: req.method,
      headers,
      rejectUnauthorized: true,
    },
    upRes => {
      const outHeaders = { ...upRes.headers }
      delete outHeaders['content-length']
      delete outHeaders['transfer-encoding']
      res.writeHead(upRes.statusCode || 502, outHeaders)
      upRes.pipe(res)
    },
  )
  upstream.on('error', err => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: `upstream: ${err.message}` },
        }),
      )
    } else {
      res.destroy(err)
    }
  })
  if (body?.length) upstream.write(body)
  upstream.end()
}

async function handleMitmRequest(hostname, req, res, config) {
  const url = new URL(req.url, `https://${hostname}`)
  const pathOnly = url.pathname
  const bodyBuf = await collectBody(req)

  const intercept =
    config.mode === 'local' &&
    hostMatches(hostname, config.mitmHosts) &&
    shouldInterceptPath(pathOnly, config.interceptPaths) &&
    (req.method === 'POST' || req.method === 'PUT')

  if (config.logRequests) {
    console.log(
      `[browser-proxy] ${req.method} https://${hostname}${pathOnly}${url.search || ''} mode=${config.mode}${intercept ? ' LOCAL' : ' passthrough'}`,
    )
  }

  if (!intercept) {
    forwardHttps(hostname, req, bodyBuf, res)
    return
  }

  let json
  try {
    json = JSON.parse(bodyBuf.toString('utf8') || '{}')
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: `bad JSON: ${err.message}` },
      }),
    )
    return
  }

  await bridgeMessagesToClaudio(json, res, config)
}

function tunnelConnect(clientSocket, hostname, port, head) {
  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head?.length) serverSocket.write(head)
    serverSocket.pipe(clientSocket)
    clientSocket.pipe(serverSocket)
  })
  serverSocket.on('error', () => clientSocket.end())
  clientSocket.on('error', () => serverSocket.end())
}

/**
 * One HTTPS server per MITM host (SNI via separate servers keyed by host).
 */
function getOrCreateFakeHttps(hostname, ca, config, cache) {
  if (cache.has(hostname)) return cache.get(hostname)

  const { key, cert } = getHostCertificate(hostname, ca)
  const fake = https.createServer({ key, cert }, (req, res) => {
    handleMitmRequest(hostname, req, res, config).catch(err => {
      console.error(`[browser-proxy] handler error: ${err.message}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: err.message },
          }),
        )
      }
    })
  })
  fake.on('tlsClientError', err => {
    console.warn(`[browser-proxy] TLS client error (${hostname}): ${err.message}`)
  })
  cache.set(hostname, fake)
  return fake
}

export function createProxyServer(config) {
  const ca = ensureCA()
  const fakeServers = new Map()

  const server = http.createServer((req, res) => {
    const u = req.url || '/'

    // Public health + CA download (no proxy auth) so Edge can fetch CA before auth
    if (u === '/health' || u.startsWith('/health?')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          service: 'claudio-browser-proxy',
          mode: config.mode,
          bridge: config.bridge,
          port: config.port,
          mitmHosts: config.mitmHosts,
          fly: Boolean(process.env.FLY_APP_NAME),
        }),
      )
      return
    }
    if (u === '/ca.crt' || u === '/ca.pem') {
      try {
        const pem = fs.readFileSync(ca.certPath || CA_CERT_PATH)
        res.writeHead(200, {
          'Content-Type': 'application/x-pem-file',
          'Content-Disposition': 'attachment; filename="claudio-browser-proxy-ca.crt"',
        })
        res.end(pem)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end(String(err.message))
      }
      return
    }

    if (!checkProxyAuth(req, config)) {
      denyProxyAuth(res, false)
      return
    }

    if (u === '/mode' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ mode: config.mode, bridge: config.bridge }))
      return
    }
    if (u === '/mode' && req.method === 'POST') {
      collectBody(req).then(buf => {
        try {
          const body = JSON.parse(buf.toString('utf8') || '{}')
          if (body.mode === 'local' || body.mode === 'passthrough') {
            config.mode = body.mode
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, mode: config.mode }))
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'mode must be local|passthrough' }))
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('claudio-browser-proxy: use CONNECT for HTTPS, or GET /health\n')
  })

  server.on('connect', (req, clientSocket, head) => {
    if (!checkProxyAuth(req, config)) {
      denyProxyAuth(clientSocket, true)
      return
    }

    const target = req.url || ''
    const [hostname, portStr] = target.split(':')
    const port = Number(portStr || 443)

    if (!hostname) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }

    // MITM allowlisted inference hosts so mode can switch without restart.
    // Non-mitm hosts: transparent tunnel (no decrypt).
    if (!hostMatches(hostname, config.mitmHosts)) {
      if (config.logRequests) {
        console.log(`[browser-proxy] CONNECT ${hostname}:${port} tunnel`)
      }
      tunnelConnect(clientSocket, hostname, port, head)
      return
    }

    if (config.logRequests) {
      console.log(`[browser-proxy] CONNECT ${hostname}:${port} MITM`)
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    const fake = getOrCreateFakeHttps(hostname, ca, config, fakeServers)
    fake.emit('connection', clientSocket)
    if (head?.length) clientSocket.unshift(head)
  })

  // Suppress uncaught socket errors
  server.on('clientError', (err, socket) => {
    console.warn(`[browser-proxy] clientError: ${err.message}`)
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })

  return { server, ca }
}
