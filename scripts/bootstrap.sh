#!/usr/bin/env bash
set -euo pipefail

install_dir="${EXECOS_INSTALL_DIR:-${HOME}/execos}"
repo_url="${EXECOS_REPO_URL:-https://github.com/calvinl345/execos.git}"
branch="${EXECOS_BRANCH:-main}"
profile="${EXECOS_PROFILE:-production}"
db_environment="${EXECOS_DB_ENVIRONMENT:-}"

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

echo "ExecOS Linux bootstrap"
echo "Install folder: ${install_dir}"
echo "Profile: ${profile}"
if [ -n "${db_environment}" ]; then
  echo "Database environment: ${db_environment}"
fi

require_command git "Install Git and rerun this command."
require_command node "Install Node.js 20+ and rerun this command."
require_command npm "npm should be installed with Node.js. Reinstall Node.js 20+ if npm is missing."

node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || printf '0')"
if [ "${node_major}" -lt 20 ]; then
  printf 'Found Node.js %s, but Jordan requires Node.js 20+.\n\n' "$(node --version 2>/dev/null || printf '<unknown>')" >&2
  print_node_hint
  exit 1
fi

if [ ! -d "${install_dir}" ]; then
  mkdir -p "$(dirname -- "${install_dir}")"
  git clone --branch "${branch}" "${repo_url}" "${install_dir}"
else
  if [ ! -d "${install_dir}/.git" ]; then
    printf 'Install folder already exists but is not a Git repository: %s\n' "${install_dir}" >&2
    exit 1
  fi

  if [ -z "$(git -C "${install_dir}" status --porcelain)" ]; then
    git -C "${install_dir}" pull --ff-only origin "${branch}"
  else
    echo "Existing clone has local changes; skipping git pull."
  fi
fi

install_args=(--profile "${profile}")
if [ -n "${db_environment}" ]; then
  install_args+=(--db-environment "${db_environment}")
fi

bash "${install_dir}/scripts/install.sh" "${install_args[@]}"
