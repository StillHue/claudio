/**
 * Proxy allow-listed requests to the real Anthropic API (api.anthropic.com)
 * so system features (WebSearch, WebFetch, etc.) keep working when
 * ANTHROPIC_BASE_URL points at the local bridge for model inference.
 *
 * Reads the fallback API key from CLAUDE_NATIVE_ANTHROPIC_API_KEY.
 * When unset, requests that hit this proxy return 503 with a clear message.
 *
 * Hardening:
 *   - Only paths starting with /v1/ or /api/ are proxied (never an open proxy).
 *   - Client headers are dropped (hop-by-hop + everything else); a minimal,
 *     explicit header set is forwarded plus the injected credentials.
 */
const https = require('https')
const { json } = require('./http')

const ANTHROPIC_REAL_HOST = 'api.anthropic.com'
const ANTHROPIC_REAL_PORT = 443

// Hop-by-hop headers must never be forwarded (RFC 7230 §6.1) plus a few
// connection-scoped extras. Kept for reference / documentation of intent.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
])

/** Only a minimal, explicit allowlist of client headers is forwarded upstream. */
function buildForwardHeaders(reqHeaders, realKey, contentLength) {
  const src = reqHeaders || {}
  const headers = {
    host: ANTHROPIC_REAL_HOST,
    'x-api-key': realKey,
    authorization: `Bearer ${realKey}`,
    accept: src['accept'] || 'application/json',
  }
  // Forward only well-known, safe request-shaping headers.
  for (const k of ['content-type', 'anthropic-version', 'anthropic-beta', 'user-agent']) {
    if (src[k] && !HOP_BY_HOP.has(k)) headers[k] = src[k]
  }
  if (contentLength > 0) headers['content-length'] = contentLength
  return headers
}

function proxyToAnthropic(req, res, token, log) {
  const urlPath = req.url || '/'
  // Sanitize path to prevent path traversal
  const sanitizedPath = urlPath.replace(/\.\./g, '').replace(/\\/g, '/').replace(/\/+/g, '/')

  // Allowlist first — never act as an open proxy, even when a real key is set.
  if (!(sanitizedPath.startsWith('/v1/') || sanitizedPath.startsWith('/api/'))) {
    log(`proxy blocked (path not allowed): ${req.method} ${sanitizedPath}`)
    return json(res, 404, {
      type: 'error',
      error: { type: 'not_found_error', message: `path not found: ${sanitizedPath}` },
    })
  }

  const realKey =
    process.env.CLAUDE_NATIVE_ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_REAL_API_KEY ||
    ''

  if (!realKey) {
    log(
      `proxy-to-anthropic skipped: CLAUDE_NATIVE_ANTHROPIC_API_KEY not set (${req.method} ${sanitizedPath})`,
    )
    return json(res, 503, {
      type: 'error',
      error: {
        type: 'api_error',
        message:
          'This endpoint requires the real Anthropic API. ' +
          'Set CLAUDE_NATIVE_ANTHROPIC_API_KEY in your env (or ~/.claude/settings.json) ' +
          'so the bridge can proxy system-tool requests to api.anthropic.com.',
      },
    })
  }

  log(`proxy ${req.method} ${sanitizedPath} → ${ANTHROPIC_REAL_HOST}`)

  // Collect the request body
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const headers = buildForwardHeaders(req.headers, realKey, body.length)

    const proxyReq = https.request(
      {
        hostname: ANTHROPIC_REAL_HOST,
        port: ANTHROPIC_REAL_PORT,
        path: sanitizedPath,
        method: req.method,
        headers,
        rejectUnauthorized: true,
        timeout: 60000,
      },
      (proxyRes) => {
        // Stream the response back
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
        proxyRes.pipe(res)
      },
    )

    proxyReq.on('error', (err) => {
      log(`proxy error: ${err.message}`)
      if (!res.headersSent) {
        json(res, 502, {
          type: 'error',
          error: {
            type: 'api_error',
            message: `proxy to api.anthropic.com failed: ${err.message}`,
          },
        })
      } else {
        res.end()
      }
    })

    proxyReq.on('timeout', () => {
      proxyReq.destroy()
      if (!res.headersSent) {
        json(res, 504, {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'proxy to api.anthropic.com timed out after 60s',
          },
        })
      }
    })

    if (body.length > 0) proxyReq.write(body)
    proxyReq.end()
  })

  req.on('error', (err) => {
    log(`proxy body read error: ${err.message}`)
    if (!res.headersSent) {
      json(res, 502, {
        type: 'error',
        error: {
          type: 'api_error',
          message: `failed to read request body: ${err.message}`,
        },
      })
    }
  })
}

module.exports = { proxyToAnthropic, ANTHROPIC_REAL_HOST, ANTHROPIC_REAL_PORT }
