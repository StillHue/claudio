/**
 * Quarantine / restore ~/.claude/.credentials.json while the bridge is active.
 * Avoids Claude Code presenting /login OAuth to ANTHROPIC_BASE_URL.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { debugLog } = require('./log')

const CLAUDE_CREDENTIALS = path.join(os.homedir(), '.claude', '.credentials.json')
const CLAUDE_CREDENTIALS_BAK = path.join(
  os.homedir(),
  '.claude-native',
  'login-credentials.bak.json',
)
/** Legacy bak path (same folder as credentials) — migrate away so Claude stops detecting login. */
const CLAUDE_CREDENTIALS_BAK_LEGACY = path.join(
  os.homedir(),
  '.claude',
  '.credentials.json.claudio-bridge',
)
const CRED_QUARANTINE_REF = path.join(os.homedir(), '.claude-native', 'credentials-quarantine.ref')

function quarantineClaudeLoginCredentials() {
  const dir = path.join(os.homedir(), '.claude-native')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(CLAUDE_CREDENTIALS_BAK_LEGACY)) {
      if (!fs.existsSync(CLAUDE_CREDENTIALS_BAK)) {
        fs.renameSync(CLAUDE_CREDENTIALS_BAK_LEGACY, CLAUDE_CREDENTIALS_BAK)
      } else {
        fs.unlinkSync(CLAUDE_CREDENTIALS_BAK_LEGACY)
      }
      debugLog('migrated legacy credentials bak out of ~/.claude')
    }
  } catch (err) {
    debugLog(`legacy bak migrate failed: ${err.message}`)
  }
  if (fs.existsSync(CLAUDE_CREDENTIALS)) {
    const tmp = CLAUDE_CREDENTIALS_BAK + '.tmp'
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      fs.renameSync(CLAUDE_CREDENTIALS, tmp)
      try {
        if (fs.existsSync(CLAUDE_CREDENTIALS_BAK)) fs.unlinkSync(CLAUDE_CREDENTIALS_BAK)
      } catch {
        /* keep tmp as bak below */
      }
      fs.renameSync(tmp, CLAUDE_CREDENTIALS_BAK)
      debugLog('quarantined ~/.claude/.credentials.json → ~/.claude-native/')
    } catch (err) {
      try {
        if (fs.existsSync(tmp) && !fs.existsSync(CLAUDE_CREDENTIALS)) {
          fs.renameSync(tmp, CLAUDE_CREDENTIALS)
        }
      } catch {
        /* ignore */
      }
      debugLog(`credentials quarantine failed (live preserved if possible): ${err.message}`)
    }
  }
  let n = 0
  try {
    n = parseInt(fs.readFileSync(CRED_QUARANTINE_REF, 'utf8').trim(), 10) || 0
  } catch {
    n = 0
  }
  try {
    fs.writeFileSync(CRED_QUARANTINE_REF, String(n + 1), { mode: 0o600 })
  } catch {
    /* ignore */
  }
}

function restoreClaudeLoginCredentials() {
  let n = 1
  try {
    n = parseInt(fs.readFileSync(CRED_QUARANTINE_REF, 'utf8').trim(), 10) || 1
  } catch {
    n = 1
  }
  n = Math.max(0, n - 1)
  if (n === 0) {
    try {
      fs.unlinkSync(CRED_QUARANTINE_REF)
    } catch {
      /* ignore */
    }
  } else {
    try {
      fs.writeFileSync(CRED_QUARANTINE_REF, String(n), { mode: 0o600 })
    } catch {
      /* ignore */
    }
  }
  if (process.env.CLAUDE_NATIVE_RESTORE_LOGIN !== '1') return
  if (n !== 0) return
  try {
    if (fs.existsSync(CLAUDE_CREDENTIALS_BAK) && !fs.existsSync(CLAUDE_CREDENTIALS)) {
      fs.renameSync(CLAUDE_CREDENTIALS_BAK, CLAUDE_CREDENTIALS)
      debugLog('restored ~/.claude/.credentials.json')
    }
  } catch (err) {
    debugLog(`credentials restore failed: ${err.message}`)
  }
}

module.exports = {
  quarantineClaudeLoginCredentials,
  restoreClaudeLoginCredentials,
  CLAUDE_CREDENTIALS,
  CLAUDE_CREDENTIALS_BAK,
}
