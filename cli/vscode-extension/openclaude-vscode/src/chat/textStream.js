/**
 * Helpers for assistant text streaming in the Claudio chat webview.
 * Some providers/shims send cumulative chunks (full text so far) or
 * re-emit the same large chunk — naive `acc += delta` duplicates UI text.
 */

/** Min length before treating an exact trailing match as a repeated chunk. */
const REPEAT_CHUNK_MIN = 16

/**
 * Merge a text_delta into accumulated assistant text.
 * @param {string} acc
 * @param {string} delta
 * @returns {string}
 */
function appendTextDelta(acc, delta) {
  if (!delta) return acc || ''
  if (!acc) return delta
  if (delta === acc) return acc

  // Cumulative stream: each event is the full text so far (strictly grows).
  if (delta.length > acc.length && delta.startsWith(acc)) {
    return delta
  }

  // Re-emitted large chunk already at the end (not tiny tokens like "." / "s")
  if (delta.length >= REPEAT_CHUNK_MIN && acc.endsWith(delta)) {
    return acc
  }

  return acc + delta
}

/**
 * Collapse consecutive identical non-empty lines.
 * Use at finalize only — not on every stream delta.
 * @param {string} text
 * @returns {string}
 */
function collapseRepeatedLines(text) {
  if (!text || typeof text !== 'string') return ''
  const lines = text.split('\n')
  const out = []
  let prevNorm = null
  for (const line of lines) {
    const norm = line.trimEnd()
    if (prevNorm !== null && norm === prevNorm && norm.length > 0) {
      continue
    }
    out.push(line)
    prevNorm = norm
  }
  return out.join('\n')
}

module.exports = {
  appendTextDelta,
  collapseRepeatedLines,
  REPEAT_CHUNK_MIN,
}
