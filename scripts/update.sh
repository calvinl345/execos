#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
branch="${EXECOS_BRANCH:-main}"
skip_pull=false
install_args=()
profile="production"
db_environment=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      shift
      if [ "$#" -eq 0 ]; then
        printf 'Missing value for --branch\n' >&2
        exit 1
      fi
      branch="$1"
      ;;
    --skip-pull)
      skip_pull=true
      ;;
    *)
      if [ "$1" = "--profile" ] && [ "$#" -gt 1 ]; then
        profile="$2"
      elif [ "$1" = "--db-environment" ] && [ "$#" -gt 1 ]; then
        db_environment="$2"
      fi
      install_args+=("$1")
      ;;
  esac
  shift
done

resolved_environment="${db_environment}"
if [ -z "${resolved_environment}" ]; then
  if [ "${profile}" = "developer" ]; then
    resolved_environment="development"
  else
    resolved_environment="production"
  fi
fi

if [ "${resolved_environment}" = "development" ]; then
  env_file=".env.development.local"
elif [ "${resolved_environment}" = "production" ]; then
  env_file=".env.production.local"
else
  printf 'Unknown database environment: %s\n' "${resolved_environment}" >&2
  exit 1
fi

echo "ExecOS updater"
echo "Repo: ${repo_root}"
echo "Branch: ${branch}"

if [ ! -d "${repo_root}/.git" ]; then
  printf 'Repo root is not a Git checkout: %s\n' "${repo_root}" >&2
  exit 1
fi
if [ ! -f "${repo_root}/${env_file}" ]; then
  printf 'Cannot update without %s. Run scripts/install.sh once first.\n' "${env_file}" >&2
  exit 1
fi

if [ "${skip_pull}" = false ]; then
  if ! git -C "${repo_root}" diff --quiet || ! git -C "${repo_root}" diff --cached --quiet; then
    printf 'Tracked changes are present. Commit, stash, or rerun with --skip-pull.\n' >&2
    exit 1
  fi
  git -C "${repo_root}" pull --ff-only origin "${branch}"
else
  echo "Skipping git pull"
fi

bash "${repo_root}/scripts/install.sh" --use-existing-credentials "${install_args[@]}"

echo
echo "ExecOS update complete."
echo "The updater ran the dashboard start command after finishing."
