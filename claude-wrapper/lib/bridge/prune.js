/**
 * Auto-prune long conversation history to prevent upstream context blowout / empty replies.
 * Truncates massive historical tool_result outputs from old turns while preserving:
 * 1. System instructions
 * 2. User intent & prompt messages
 * 3. Recent turns (last N messages) completely intact
 */

function autoPruneMessages(messages, maxBytes = 220000, keepRecent = 16) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, pruned: false, beforeBytes: 0, afterBytes: 0 }
  }

  let totalBytes = 0
  try {
    totalBytes = Buffer.byteLength(JSON.stringify(messages), "utf8")
  } catch {
    return { messages, pruned: false, beforeBytes: 0, afterBytes: 0 }
  }

  // Always allow aggressive mode to run even when under soft byte budget.
  if (totalBytes <= maxBytes && messages.length <= keepRecent) {
    return { messages, pruned: false, beforeBytes: totalBytes, afterBytes: totalBytes }
  }

  if (totalBytes <= maxBytes && messages.length > keepRecent && maxBytes >= 220000) {
    return { messages, pruned: false, beforeBytes: totalBytes, afterBytes: totalBytes }
  }

  const cutoffIndex = Math.max(1, messages.length - keepRecent)
  const pruned = []
  const toolResultMax = maxBytes < 120000 ? 200 : 500
  const stringMax = maxBytes < 120000 ? 600 : 1500

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (i >= cutoffIndex || msg.role === "system") {
      // Keep recent turns; still clip absurdly large recent tool dumps on tight budgets.
      if (maxBytes < 120000 && msg.role === "tool" && typeof msg.content === "string" && msg.content.length > toolResultMax) {
        pruned.push({
          ...msg,
          content: msg.content.slice(0, toolResultMax) + "\n... [pruned]",
        })
      } else {
        pruned.push(msg)
      }
      continue
    }

    if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > toolResultMax) {
      const head = msg.content.slice(0, Math.min(300, toolResultMax))
      const lines = head.split("\n").slice(0, 4).join("\n")
      pruned.push({
        ...msg,
        content: lines + "\n... [prior tool output pruned for context speed (" + msg.content.length + " chars)]",
      })
    } else if (msg.role === "user" && Array.isArray(msg.content)) {
      const prunedContent = msg.content.map((block) => {
        if (block?.type === "tool_result" && typeof block.content === "string" && block.content.length > toolResultMax) {
          const head = block.content.slice(0, Math.min(300, toolResultMax))
          const lines = head.split("\n").slice(0, 4).join("\n")
          return {
            ...block,
            content: lines + "\n... [prior tool output pruned for context speed (" + block.content.length + " chars)]",
          }
        }
        return block
      })
      pruned.push({ ...msg, content: prunedContent })
    } else if (typeof msg.content === "string" && msg.content.length > stringMax) {
      const head = msg.content.slice(0, Math.min(500, stringMax))
      pruned.push({
        ...msg,
        content: head + "\n... [prior output pruned for context speed]",
      })
    } else {
      pruned.push(msg)
    }
  }

  // Drop oldest non-system messages until under budget.
  let afterBytes = totalBytes
  try {
    afterBytes = Buffer.byteLength(JSON.stringify(pruned), "utf8")
  } catch {
    /* ignore */
  }
  while (afterBytes > maxBytes && pruned.length > keepRecent + 1) {
    const idx = pruned.findIndex((m, i) => i > 0 && m.role !== "system")
    if (idx < 0) break
    pruned.splice(idx, 1)
    try {
      afterBytes = Buffer.byteLength(JSON.stringify(pruned), "utf8")
    } catch {
      break
    }
  }

  return {
    messages: pruned,
    pruned: afterBytes < totalBytes || pruned.length < messages.length,
    beforeBytes: totalBytes,
    afterBytes,
  }
}

module.exports = { autoPruneMessages }
