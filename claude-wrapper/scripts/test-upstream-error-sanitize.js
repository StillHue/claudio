#!/usr/bin/env node
const assert = require('assert')
const { sanitizeForLog, summarizeUpstreamError } = require('../lib/wrapper/log')

const dirty = sanitizeForLog(
  'Bearer sk-abcdefghijklmnopqrstuvwxyz012345 Authorization failed data:image/png;base64,AAAA',
)
assert.ok(!dirty.includes('sk-abcdefghijklmnopqrstuvwxyz012345'))
assert.ok(!/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{8,}/i.test(dirty))

const summary = summarizeUpstreamError(
  JSON.stringify({
    error: { message: 'The reasoning_content in the thinking mode must be passed back', code: 'invalid_request' },
  }),
)
assert.ok(summary.includes('reasoning_content'))
assert.ok(summary.includes('invalid_request') || summary.length > 10)

const huge = summarizeUpstreamError('x'.repeat(5000))
assert.ok(huge.length <= 240)

console.log('upstream error sanitize: OK')
