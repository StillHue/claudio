#!/usr/bin/env bash
#
# One-click setup (Linux/macOS): official Claude Code + local bridge (JS) + IDE hosts.
#
#   From a checkout with claude-wrapper/:
#
#     bash ./claude-wrapper/install.sh
#
# What it does:
#   1. Ensures official Claude Code (if missing)
#   2. Deploys wrapper under ~/.claude/wrapper
#   3. Points IDE hosts at claudio-wrapper.sh
#   4. Installs PATH shims (~/.local/bin/claude)
#   5. Centralizes providers.json / .env under ~/.claude
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="$HOME/.claude"
WRAPPER_DIR="$CLAUDE_HOME/wrapper"
LOCAL_BIN="$HOME/.local/bin"

step() { echo ""; echo "==> $1"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }
}

find_official_claude() {
  # Ask the repo resolver (covers extension bundles incl. *-server, npm, ~/.local/bin).
  node -e "
try {
  const r = require("$HERE/resolve-official-claude.js");
  const hit = r.resolveLatestOfficialClaude();
  if (hit) console.log(hit.path);
} catch (e) { /* ignore */ }
" 2>/dev/null | head -n 1
}

ensure_claude_code() {
  local found
  found="$(find_official_claude)"
  if [ -n "$found" ]; then
    echo "Claude Code found: $found"
    return 0
  fi
  step "Installing official Claude Code..."
  curl -fsSL https://claude.ai/install.sh | bash
  found="$(find_official_claude)"
  if [ -z "$found" ]; then
    echo "WARNING: official install finished but no binary resolved." >&2
    echo "Install the Claude Code extension, then re-run install.sh." >&2
  fi
}

ensure_claude_home() {
  mkdir -p "$CLAUDE_HOME" "$WRAPPER_DIR"
  local legacy="$HOME/.claude-native"
  if [ -d "$legacy" ]; then
    [ -f "$legacy/providers.json" ] && [ ! -f "$CLAUDE_HOME/providers.json" ] \
      && cp "$legacy/providers.json" "$CLAUDE_HOME/providers.json" \
      && echo "migrated providers.json -> $CLAUDE_HOME/providers.json"
    [ -f "$legacy/.env" ] && [ ! -f "$CLAUDE_HOME/.env" ] \
      && cp "$legacy/.env" "$CLAUDE_HOME/.env" \
      && echo "migrated .env -> $CLAUDE_HOME/.env"
    [ -f "$legacy/bridge.token" ] && [ ! -f "$WRAPPER_DIR/bridge.token" ] \
      && cp "$legacy/bridge.token" "$WRAPPER_DIR/bridge.token" \
      && echo "migrated bridge.token"
  fi
  if [ -f "$CLAUDE_HOME/providers.json" ]; then
    echo "providers.json already exists ($CLAUDE_HOME/providers.json)"
  else
    echo "no providers.json yet - first Claude launch will open the provider picker"
  fi
}

deploy_wrapper() {
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude node_modules --exclude .git --exclude skills --exclude .env \
      "$HERE/" "$WRAPPER_DIR/"
  else
    # cp fallback: copy everything except the excluded names.
    mkdir -p "$WRAPPER_DIR"
    ( shopt -s dotglob nullglob
      for entry in "$HERE"/* "$HERE"/.*; do
        base="$(basename "$entry")"
        case "$base" in
          .|..|node_modules|.git|skills|.env) continue;;
        esac
        cp -r "$entry" "$WRAPPER_DIR/"
      done )
  fi
  chmod +x "$WRAPPER_DIR/claudio-wrapper.sh"
  [ -f "$WRAPPER_DIR/claudio-wrapper.sh" ] \
    || { echo "claudio-wrapper.sh missing after deploy ($WRAPPER_DIR)" >&2; exit 1; }
  echo "deployed wrapper -> $WRAPPER_DIR"
}

patch_ide_settings() {
  # $1 = name, $2 = settings path
  local tmp_js
  tmp_js="$(mktemp)"
  cat > "$tmp_js" <<'PATCH_EOF'
const fs = require('fs');
const settingsPath = process.argv[2];
const exe = process.argv[3];
const wrapperDir = require('path').dirname(exe);
function defaultPickerId() {
  const fallback = 'anthropic.mistral.mistral-code-latest';
  const candidates = [require('path').join(process.env.HOME || '', '.claude', 'providers.json'),
                      require('path').join(wrapperDir, 'providers.json')];
  for (const p of candidates) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
      const active = data.active && data.providers && data.providers[data.active] ? data.active : Object.keys(data.providers || {})[0];
      const entry = active ? data.providers[active] : null;
      const model = entry && (entry.model || (Array.isArray(entry.models) && entry.models[0]));
      if (!active || !model) continue;
      const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '-');
      return `anthropic.${sanitize(active)}.${sanitize(model)}`;
    } catch { /* next */ }
  }
  return fallback;
}
const pickerId = defaultPickerId();
let raw = fs.readFileSync(settingsPath, 'utf8');
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const stripJsonc = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
let data;
try { data = JSON.parse(raw); }
catch { data = JSON.parse(stripJsonc(raw)); }
fs.copyFileSync(settingsPath, settingsPath + '.bak-claudio-install');
data['claudeCode.claudeProcessWrapper'] = exe;
if (data['claudeCode.skipApiCheck'] == null) data['claudeCode.skipApiCheck'] = true;
if (data['claudeCode.disableLoginPrompt'] == null) data['claudeCode.disableLoginPrompt'] = true;
data['claudeCode.model'] = data['claudeCode.model'] || pickerId;
fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('set claudeCode.claudeProcessWrapper =', exe);
PATCH_EOF
  node "$tmp_js" "$2" "$WRAPPER_DIR/claudio-wrapper.sh"
  local rc=$?
  rm -f "$tmp_js"
  return $rc
}

set_ide_wrappers() {
  step "Configuring Claude Code IDE hosts (Cursor / VS Code / ...)"
  local patched=0
  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}"
  for spec in "Cursor:$cfg/Cursor/User/settings.json" \
              "VS Code:$cfg/Code/User/settings.json" \
              "VS Code Insiders:$cfg/Code - Insiders/User/settings.json" \
              "VSCodium:$cfg/VSCodium/User/settings.json"; do
    local name="${spec%%:*}"
    local sp="${spec#*:}"
    if [ ! -f "$sp" ]; then
      # Only touch IDEs that already have a settings file (i.e. installed + launched).
      echo "skip $name (no settings.json)"
      continue
    fi
    echo "Configuring $name -> $sp"
    if patch_ide_settings "$name" "$sp"; then patched=$((patched + 1)); fi
  done
  if [ "$patched" -eq 0 ]; then
    echo "WARNING: no IDE settings patched. Install Cursor/VS Code + Claude Code extension, then re-run." >&2
    echo "CLI still works via PATH shims once a provider is configured." >&2
  else
    echo "Patched $patched IDE host(s)."
  fi
}

install_cli_shims() {
  step "Installing PATH shims (claude)"
  mkdir -p "$LOCAL_BIN"
  # Official native installer drops claude in ~/.local/bin, which would
  # shadow the wrapper. Keep it aside as claude-official.
  if [ -f "$LOCAL_BIN/claude" ] && [ ! -L "$LOCAL_BIN/claude" ]; then
    if ! grep -q "claudio-wrapper" "$LOCAL_BIN/claude" 2>/dev/null; then
      mv -f "$LOCAL_BIN/claude" "$LOCAL_BIN/claude-official"
      echo "renamed $LOCAL_BIN/claude -> $LOCAL_BIN/claude-official (wrapper owns claude)"
    fi
  fi
  cat > "$LOCAL_BIN/claude" <<EOF
#!/usr/bin/env bash
exec node "$WRAPPER_DIR/claude-cli.js" "\$@"
EOF
  chmod +x "$LOCAL_BIN/claude"
  echo "shim installed: $LOCAL_BIN/claude"
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *) echo "NOTE: $LOCAL_BIN is not on PATH. Add: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}

# --- main ---
echo ""
echo "Claude Code + third-party bridge installer (Linux/macOS)"
echo "Wrapper dir: $HERE"
need node
need curl
step "Checking official Claude Code"
ensure_claude_code
step "Ensuring ~/.claude + migrating legacy ~/.claude-native"
ensure_claude_home
step "Deploying wrapper -> ~/.claude/wrapper"
deploy_wrapper
set_ide_wrappers
install_cli_shims

echo ""
echo "Done."
echo "  Wrapper: $WRAPPER_DIR/claudio-wrapper.sh"
echo "  Providers: ~/.claude/providers.json"
echo "  Env: ~/.claude/.env"
echo "  Next: reload your IDE window, open Claude Code"
echo ""
