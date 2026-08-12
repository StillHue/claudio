#!/usr/bin/env node
/** Prove short-token dedupe eats letters; current reader must not. */
const { readOpenAIStream } = require('../lib/bridge/stream')

function sseFromDeltas(deltas) {
  const body =
    deltas
      .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
}

/** Buggy logic that shipped in native31 (recentChunks). */
function buggyAssemble(deltas) {
  let fullText = ''
  let streamMode = null
  const recentChunks = new Set()
  const MAX = 10
  const out = []
  for (const chunk of deltas) {
    if (!fullText) {
      fullText = chunk
      out.push(chunk)
    } else if (streamMode === 'cumulative') {
      if (chunk.length > fullText.length && chunk.startsWith(fullText)) {
        const inc = chunk.slice(fullText.length)
        fullText = chunk
        if (inc) out.push(inc)
      } else {
        streamMode = 'incremental'
        fullText += chunk
        out.push(chunk)
      }
    } else if (streamMode === 'incremental') {
      const n = chunk.replace(/\s+/g, ' ').trim()
      if (!recentChunks.has(n)) {
        recentChunks.add(n)
        if (recentChunks.size > MAX) recentChunks.delete(recentChunks.values().next().value)
        fullText += chunk
        out.push(chunk)
      }
    } else {
      const looks =
        chunk.length > fullText.length &&
        chunk.startsWith(fullText) &&
        chunk.length >= fullText.length * 2
      if (looks) {
        streamMode = 'cumulative'
        const inc = chunk.slice(fullText.length)
        fullText = chunk
        if (inc) out.push(inc)
      } else {
        streamMode = 'incremental'
        fullText += chunk
        out.push(chunk)
      }
    }
  }
  return fullText
}

;(async () => {
  // Simulates markdown + Portuguese endings that repeat short tokens
  const deltas = [
    'O ',
    '**',
    'Benner',
    '**',
    ' (sistema ',
    '**',
    'extern',
    'o',
    '**',
    ') centro de ',
    '**',
    'cust',
    'o',
    '**',
    ' e ',
    '**',
    'sede',
    '**',
    '. ',
    '**',
    'ajust',
    'e',
    '**',
    '?',
  ]
  const expected = deltas.join('')
  const buggy = buggyAssemble(deltas)
  const emitted = []
  const result = await readOpenAIStream(sseFromDeltas(deltas), {
    onText: (d) => emitted.push(d),
  })
  console.log('expected:', expected)
  console.log('buggy:   ', buggy)
  console.log('fixed:   ', result.text)
  console.log('buggy damaged?', buggy !== expected)
  console.log('fixed ok?', result.text === expected)
  console.log('emitted join ok?', emitted.join('') === expected)
  if (result.text !== expected) process.exit(1)
  if (buggy === expected) {
    console.warn('WARN: buggy repro did not diverge — adjust fixture')
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
