/**
 * Anthropic Messages API → OpenAI Chat Completions bridge (with tool_use).
 *
 * Thin entry: routing + auth. Implementation lives under lib/bridge/.
 */
const http = require('http')
const { buildAnthropicModelsList } = require('./provider-config')
const { json, expectedBridgeToken } = require('./lib/bridge/http')
const { anthropicToOpenAIMessages, anthropicToolsToOpenAI } = require('./lib/bridge/translate')
const { handleMessages } = require('./lib/bridge/messages')
const { handleCountTokens } = require('./lib/bridge/count-tokens')
const { proxyToAnthropic } = require('./lib/bridge/proxy-anthropic')

/**
 * @param {{ getProvider: (model?: string) => any, getProvidersData?: () => any, getProvidersPath?: () => string|null, log?: Function, token?: string, host?: string, port?: number }} opts
 */
function startNativeBridge(opts) {
  const log = opts.log || (() => {})
  const token = opts.token || ''
  const host = opts.host || '127.0.0.1'
  const port = opts.port || 0

  // Shared-token gate: on when STRICT=1 and OPEN_LOCAL is not set.
  // Default (OPEN_LOCAL from wrapper): skip token check — loopback + Origin only.
  const openLocal =
    process.env.CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL === '1' ||
    process.env.CLAUDE_NATIVE_BRIDGE_STRICT !== '1'
  const maxBodyBytes = Number(process.env.CLAUDE_NATIVE_MAX_BODY_BYTES || 20 * 1024 * 1024)

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return json(res, 403, {
        type: 'error',
        error: { type: 'permission_error', message: 'CORS preflight not allowed' },
      })
    }

    const origin = String(req.headers.origin || '')
    if (origin && origin !== 'null') {
      return json(res, 403, {
        type: 'error',
        error: { type: 'permission_error', message: 'browser origin not allowed' },
      })
    }

    if (token && !openLocal) {
      const auth = req.headers.authorization || ''
      const xKey = String(req.headers['x-api-key'] || '')
      const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      const expected = expectedBridgeToken(token)
      const ok = (xKey && xKey === expected) || (bearer && bearer === expected)
      if (!ok) {
        log(
          `401 bridge auth: xApiKeyLen=${xKey.length} bearerLen=${bearer.length} expectedLen=${expected.length}`,
        )
        return json(res, 401, {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid bridge token' },
        })
      }
    }

    const contentLength = Number(req.headers['content-length'] || 0)
    if (contentLength > maxBodyBytes) {
      return json(res, 413, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'request body too large' },
      })
    }

    const url = new URL(req.url || '/', `http://${host}`)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return json(res, 200, { ok: true, service: 'claude-native-bridge' })
    }

    if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      const data = opts.getProvidersData
        ? buildAnthropicModelsList(opts.getProvidersData())
        : { data: [], has_more: false, first_id: null, last_id: null }
      log(`GET ${pathname} → ${data.data?.length || 0} model(s)`)
      return json(res, 200, data)
    }

    if (
      req.method === 'GET' &&
      (pathname.startsWith('/v1/models/') || pathname.startsWith('/models/'))
    ) {
      const id = pathname.startsWith('/v1/models/')
        ? decodeURIComponent(pathname.slice('/v1/models/'.length))
        : decodeURIComponent(pathname.slice('/models/'.length))
      const data = opts.getProvidersData
        ? buildAnthropicModelsList(opts.getProvidersData())
        : { data: [] }
      const found = (data.data || []).find((m) => m.id === id)
      if (!found) {
        return json(res, 404, {
          type: 'error',
          error: { type: 'not_found_error', message: `model ${id} not found` },
        })
      }
      return json(res, 200, found)
    }

    if (req.method === 'POST' && (pathname === '/v1/messages' || pathname === '/messages')) {
      return handleMessages(req, res, {
        getProvider: opts.getProvider,
        getProvidersData: opts.getProvidersData,
        getProvidersPath: opts.getProvidersPath,
        log,
      })
    }

    if (
      req.method === 'POST' &&
      (pathname === '/v1/messages/count_tokens' || pathname === '/messages/count_tokens')
    ) {
      return handleCountTokens(req, res)
    }

    return proxyToAnthropic(req, res, token, log)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      const listenUrl = `http://${host}:${actualPort}`
      log(`native bridge listening on ${listenUrl}`)
      resolve({
        url: listenUrl,
        port: actualPort,
        close: () =>
          new Promise((resClose, rej) => {
            server.close((err) => (err ? rej(err) : resClose()))
          }),
      })
    })
  })
}

module.exports = {
  startNativeBridge,
  anthropicToOpenAIMessages,
  anthropicToolsToOpenAI,
}
