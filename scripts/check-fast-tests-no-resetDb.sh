#!/usr/bin/env bash
set -euo pipefail

violations="$(
  find tests -type f -name '*.ts' \
    ! -path 'tests/_meta/*' \
    ! -path 'tests/db/*' \
    ! -path 'tests/integration/db/*' \
    -print0 |
  xargs -0 grep -n 'resetDbData' || true
)"

if [ -n "$violations" ]; then
  echo "resetDbData is forbidden in fast test tiers:" >&2
  echo "$violations" >&2
  exit 1
fi

echo "fast-tier resetDbData discipline OK"
