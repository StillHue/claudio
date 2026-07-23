#!/usr/bin/env node
/**
 * Terminal entry: official Claude Code harness (latest binary) + optional bridge.
 *
 * Default mode is native (same as Cursor). Legacy Ink fork:
 *   set CLAUDE_WRAPPER_MODE=claudio
 *
 * Usage (same argv as Anthropic Claude Code):
 *   claude
 *   claude --version
 *   claude -p "hello"
 */
process.env.CLAUDE_WRAPPER_MODE = process.env.CLAUDE_WRAPPER_MODE || 'native'
require('./claudio-wrapper.js')
