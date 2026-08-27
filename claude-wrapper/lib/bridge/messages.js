/**
 * POST /v1/messages — Anthropic Messages router.
 * Delegates to chat (/chat/completions) or responses (/responses) handlers.
 */
const { json } = require('./http')
const { mapModel } = require('./translate')
const { handleChat } = require('./messages-chat')
const { handleResponses } = require('./messages-responses')

async function handleMessages(req, res, ctx) {
  const maxBodyBytes = Number(process.env.CLAUDE_NATIVE_MAX_BODY_BYTES || 20 * 1024 * 1024)
  const chunks = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > maxBodyBytes) {
      return json(res, 413, { type: 'error', error: { type: 'invalid_request_error', message: 'request body too large' } })
    }
    chunks.push(c)
  }
  let body
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON body' } })
  }

  const provider = ctx.getProvider(body.model)
  const upstreamModel = mapModel(body.model, provider)
  const upstreamFormat = provider.format || 'chat'

  try {
    const data = typeof ctx.getProvidersData === 'function' ? ctx.getProvidersData() : null
    if (data && provider?.name && upstreamModel) {
      const { persistProvidersDefault } = require('../provider/sync')
      const cfgPath = typeof ctx.getProvidersPath === 'function' ? ctx.getProvidersPath() : undefined
      const saved = persistProvidersDefault(data, provider.name, upstreamModel, cfgPath)
      if (saved.changed) ctx.log?.(`persisted default model → ${provider.name}/${upstreamModel}`)
    }
  } catch (err) {
    ctx.log?.(`persist default model skipped: ${err.message}`)
  }

  if (upstreamFormat === 'responses') {
    return handleResponses(req, res, ctx, { body, provider, upstreamModel })
  }
  return handleChat(req, res, ctx, { body, provider, upstreamModel })
}

module.exports = { handleMessages }
