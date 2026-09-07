/**
 * Auto-prune long conversation history to prevent upstream context blowout / empty replies.
 * Truncates massive historical tool_result outputs from old turns while preserving:
 * 1. System instructions
 * 2. User intent & prompt messages
 * 3. Recent turns (last N messages) completely intact
 */

function autoPruneMessages(messages, maxBytes = 220000, keepRecent = 16) {
  if (!Array.isArray(messages) || messages.length <= keepRecent) {
    return { messages, pruned: false, beforeBytes: 0, afterBytes: 0 }
  }

  let totalBytes = 0
  try {
    totalBytes = Buffer.byteLength(JSON.stringify(messages), "utf8")
  } catch {
    return { messages, pruned: false, beforeBytes: 0, afterBytes: 0 }
  }

  if (totalBytes <= maxBytes) {
    return { messages, pruned: false, beforeBytes: totalBytes, afterBytes: totalBytes }
  }

  const cutoffIndex = Math.max(1, messages.length - keepRecent)
  const pruned = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (i >= cutoffIndex || msg.role === "system") {
      // Keep recent turns and system message completely unmodified
      pruned.push(msg)
      continue
    }

    // Historical turn: prune oversized content (e.g. 50KB tool results)
    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > 500) {
      const head = msg.content.slice(0, 300)
      const lines = head.split("\n").slice(0, 4).join("\n")
      pruned.push({
        ...msg,
        content: lines + "\n... [prior tool output pruned for context speed (" + msg.content.length + " chars)]",
      })
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      const prunedContent = msg.content.map((block) => {
        if (block?.type === "tool_result" && typeof block.content === "string" && block.content.length > 500) {
          const head = block.content.slice(0, 300)
          const lines = head.split("\n").slice(0, 4).join("\n")
          return {
            ...block,
            content: lines + "\n... [prior tool output pruned for context speed (" + block.content.length + " chars)]",
          }
        }
        return block
      })
      pruned.push({ ...msg, content: prunedContent })
    } else if (typeof msg.content === "string" && msg.content.length > 1500) {
      const head = msg.content.slice(0, 500)
      pruned.push({
        ...msg,
        content: head + "\n... [prior output pruned for context speed]",
      })
    } else {
      pruned.push(msg)
    }
  }

  let afterBytes = totalBytes
  try {
    afterBytes = Buffer.byteLength(JSON.stringify(pruned), "utf8")
  } catch {
    /* ignore */
  }

  return {
    messages: pruned,
    pruned: true,
    beforeBytes: totalBytes,
    afterBytes,
  }
}

module.exports = { autoPruneMessages }
