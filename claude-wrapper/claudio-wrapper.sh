#!/usr/bin/env bash
# Process-wrapper entry for POSIX shells (Linux/macOS).
# The IDE extension spawns this file directly (must be executable).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/claudio-wrapper.js" "$@"
