#!/usr/bin/env node
/**
 * Terminal entry: official Claude Code harness + local bridge.
 *
 * Usage (same argv as Anthropic Claude Code):
 *   claude
 *   claude --version
 *   claude -p "hello"
 */

// Load env vars from ~/.claude/settings.json so the bridge can see keys
// like CLAUDE_NATIVE_ANTHROPIC_API_KEY needed for system tools.
try {
  const fs = require('fs')
  const path = require('path')
  const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json')
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const settings = JSON.parse(raw)
    if (settings.env && typeof settings.env === 'object') {
      for (const [key, value] of Object.entries(settings.env)) {
        if (value && !process.env[key]) {
          process.env[key] = String(value)
        }
      }
    }
  }
} catch {
  /* ignore */
}

require('./claudio-wrapper.js')
