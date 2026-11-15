#!/usr/bin/env bash
set -euo pipefail

budget_seconds="${FAST_SUITE_BUDGET_SECONDS:-30}"
start_epoch="$(date +%s)"

npm run test:unit

end_epoch="$(date +%s)"
duration="$((end_epoch - start_epoch))"

echo "fast suite duration: ${duration}s (budget: ${budget_seconds}s)"

if [ "$duration" -gt "$budget_seconds" ]; then
  echo "Fast suite exceeded budget." >&2
  exit 1
fi
