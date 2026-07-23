#!/usr/bin/env node
/**
 * Provider setup is the terminal wizard only (safe key entry).
 * Does NOT install a Claude Code /provider skill (keys in chat = unsafe).
 */
const path = require('path')

console.log('Provider UI = terminal wizard (API key never goes into Claude chat).')
console.log('')
console.log('  node "' + path.join(__dirname, 'enable-provider.js') + '"')
console.log('')
console.log('Flow: list providers → pick id → paste key (hidden) → models sync to /model')
console.log('')
console.log('To remove an old /provider skill if present:')
console.log('  node "' + path.join(__dirname, 'uninstall-provider-skill.js') + '"')
