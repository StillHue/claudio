const test = require('node:test')
const assert = require('node:assert/strict')
const { appendTextDelta, collapseRepeatedLines } = require('./textStream')

test('appendTextDelta concatenates incremental chunks', () => {
  let acc = ''
  acc = appendTextDelta(acc, 'Hel')
  acc = appendTextDelta(acc, 'lo')
  acc = appendTextDelta(acc, '!')
  assert.equal(acc, 'Hello!')
})

test('appendTextDelta keeps tiny incremental suffixes (not false duplicates)', () => {
  assert.equal(appendTextDelta('100', '0'), '1000')
  assert.equal(appendTextDelta('.', '.'), '..')
  assert.equal(appendTextDelta('succes', 's'), 'success')
})

test('appendTextDelta handles cumulative full-text chunks', () => {
  let acc = ''
  acc = appendTextDelta(acc, 'Tudo pronto')
  acc = appendTextDelta(acc, 'Tudo pronto. Resumo')
  acc = appendTextDelta(acc, 'Tudo pronto. Resumo do que foi feito:')
  assert.equal(acc, 'Tudo pronto. Resumo do que foi feito:')
})

test('appendTextDelta ignores exact re-emit of a large trailing chunk', () => {
  const chunk = 'Tudo pronto. Resumo do que foi feito:\n'
  let acc = appendTextDelta('', chunk)
  acc = appendTextDelta(acc, chunk)
  acc = appendTextDelta(acc, chunk)
  assert.equal(acc, chunk)
})

test('collapseRepeatedLines drops consecutive duplicate lines', () => {
  const input = [
    'Tudo pronto. Resumo do que foi feito:',
    'Tudo pronto. Resumo do que foi feito:',
    'Tudo pronto. Resumo do que foi feito:',
    'Mudanças feitas:',
    '- a',
  ].join('\n')
  assert.equal(
    collapseRepeatedLines(input),
    ['Tudo pronto. Resumo do que foi feito:', 'Mudanças feitas:', '- a'].join('\n'),
  )
})
