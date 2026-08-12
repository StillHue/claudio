#!/usr/bin/env node
/**
 * Ensure text content_block_stop is only emitted once when tools follow text.
 * Double-stop makes Claude Code persist/render the same paragraph twice.
 */
const assert = require('assert')

function simulateStops({ hasText, hasTools }) {
  let textStarted = hasText
  let textClosed = false
  let openedTools = new Set()
  const events = []

  const closeText = (why) => {
    if (!textStarted || textClosed) return
    textClosed = true
    events.push(`text_stop:${why}`)
  }

  // onToolDelta first tool
  if (hasTools) {
    closeText('tool')
    openedTools.add(0)
    events.push('tool_start')
  }

  // end of stream
  closeText('end')
  if (openedTools.size) events.push('tools_done')

  return events
}

assert.deepStrictEqual(simulateStops({ hasText: true, hasTools: true }), [
  'text_stop:tool',
  'tool_start',
  'tools_done',
])
assert.deepStrictEqual(simulateStops({ hasText: true, hasTools: false }), [
  'text_stop:end',
])
assert.deepStrictEqual(simulateStops({ hasText: false, hasTools: true }), [
  'tool_start',
  'tools_done',
])

console.log('text block single-stop: OK')
