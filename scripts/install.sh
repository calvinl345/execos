#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

print_node_hint() {
  cat >&2 <<'EOF'
Node.js 20+ is required.

Ubuntu options:
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs

User-local options:
  nvm install 20
  fnm install 20
EOF
}

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "${name}" >/dev/null 2>&1; then
    printf '%s is required. %s\n' "${name}" "${hint}" >&2
    return 1
  fi
}

require_command node "Install Node.js 20+ and rerun this command."
require_command npm "npm should be installed with Node.js. Reinstall Node.js 20+ if npm is missing."

node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
if [ "${node_major}" -lt 20 ]; then
  printf 'Found Node.js %s, but Jordan requires Node.js 20+.\n\n' "$(node --version 2>/dev/null || printf '<unknown>')" >&2
  print_node_hint
  exit 1
fi

exec node "${repo_root}/scripts/installer/run.mjs" --repo-root "${repo_root}" "$@"
