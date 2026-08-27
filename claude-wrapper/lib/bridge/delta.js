/**
 * Shared delta dedup for OpenAI streaming (chat + responses).
 * Guards against cumulative resends and short-token dedup bugs.
 */
function takeDelta(prev, next) {
  if (!next) return { text: prev || '', emit: '' }
  if (!prev) return { text: next, emit: next }
  if (next === prev) return { text: prev, emit: '' }
  if (next.length > prev.length && next.startsWith(prev)) {
    return { text: next, emit: next.slice(prev.length) }
  }
  if (next.length >= 40) {
    if (prev.length >= next.length && prev.startsWith(next)) {
      return { text: prev, emit: '' }
    }
    if (prev.endsWith(next)) {
      return { text: prev, emit: '' }
    }
    let i = 0
    const max = Math.min(prev.length, next.length)
    while (i < max && prev[i] === next[i]) i++
    if (i >= 40) {
      return { text: next, emit: next.slice(i) }
    }
  }
  return { text: prev + next, emit: next }
}

module.exports = { takeDelta }
