#!/usr/bin/env bash
set -euo pipefail

violations="$(
  find tests -type f -name '*.ts' \
    ! -path 'tests/db/*' \
    ! -path 'tests/integration/db/*' \
    -print0 |
  xargs -0 grep -nE 'from ["'\''](\.\./)+src/db/index\.js["'\'']|from ["'\''](\.\./)+db/db-test-utils\.js["'\'']' || true
)"

if [ -n "$violations" ]; then
  echo "Concrete DB imports are forbidden outside DB/integration tiers:" >&2
  echo "$violations" >&2
  exit 1
fi

echo "DB import discipline OK"
