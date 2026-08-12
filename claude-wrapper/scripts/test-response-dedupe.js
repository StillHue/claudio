#!/usr/bin/env node
const assert = require('assert')
const { takeDelta, readOpenAIStream } = require('../lib/bridge/stream')
const { visibleTextAgainstReasoning } = require('../lib/bridge/translate')

// Cumulative growth
assert.deepStrictEqual(takeDelta('Hel', 'Hello'), { text: 'Hello', emit: 'lo' })
// Exact resend
assert.deepStrictEqual(takeDelta('Hello', 'Hello'), { text: 'Hello', emit: '' })
// Duplicate full chunk appended by buggy gateways (would become HelloHello)
assert.deepStrictEqual(takeDelta('Entendi! Vou rodar o diagnóstico completo agora.', 'Entendi! Vou rodar o diagnóstico completo agora.'), {
  text: 'Entendi! Vou rodar o diagnóstico completo agora.',
  emit: '',
})
// Incremental unique
assert.deepStrictEqual(takeDelta('Hello ', 'world'), { text: 'Hello world', emit: 'world' })
// Shared-prefix rewrite instead of blind append
{
  const prev = 'Entendi! Vou rodar o diagnóstico.'
  const next = 'Entendi! Vou rodar o diagnóstico completo do sistema.'
  const r = takeDelta(prev, next)
  assert.strictEqual(r.text, next)
  assert.strictEqual(r.emit, ' completo do sistema.')
  assert.ok(!r.text.includes('Entendi! Vou rodar o diagnóstico.Entendi!'))
}

// Stream: duplicate full paragraph must not concatenate
;(async () => {
  const para =
    'Entendi! Vou rodar o diagnóstico completo do seu Claude Code. Isso envolve várias verificações.'
  const body =
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: para } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: para } }] })}`,
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(body))
      c.close()
    },
  })
  const emitted = []
  const result = await readOpenAIStream(stream, { onText: (d) => emitted.push(d) })
  assert.strictEqual(result.text, para)
  assert.strictEqual(emitted.join(''), para)
  assert.ok(!result.text.includes(para + para), 'must not double the paragraph')

  // Identical reasoning+content → one visible text (thinking kept separately by caller)
  assert.strictEqual(visibleTextAgainstReasoning(para, para), para)
  assert.strictEqual(
    visibleTextAgainstReasoning('thinking only', 'thinking only\n\nAnswer here'),
    'Answer here',
  )
  assert.strictEqual(visibleTextAgainstReasoning('', 'just text'), 'just text')

  console.log('stream/text dedupe: OK')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
