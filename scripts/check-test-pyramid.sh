#!/usr/bin/env bash
set -euo pipefail

required_scripts=(
  '"test": "vitest run --config vitest.config.ts"'
  '"test:unit": "vitest run --config vitest.config.ts"'
  '"test:db": "node scripts/refuse-db-tests.cjs"'
  '"test:migration": "vitest run --config vitest.migration.config.ts"'
  '"test:all": "npm run test && npm run test:migration:gate"'
)

for script in "${required_scripts[@]}"; do
  if ! grep -Fq "$script" package.json; then
    echo "Missing package script contract: $script" >&2
    exit 1
  fi
done

if ! grep -Fq 'fileParallelism: false' vitest.db.config.ts; then
  echo "DB suite must run with fileParallelism disabled." >&2
  exit 1
fi

if grep -Fq 'fileParallelism: false' vitest.config.ts; then
  echo "Fast suite must not globally disable file parallelism." >&2
  exit 1
fi

for file in \
  tests/db/constraints.test.ts \
  tests/db/rls.test.ts \
  tests/db/views.test.ts \
  tests/db/helpers.test.ts \
  tests/integration/db/cli/task-commands.test.ts \
  tests/integration/db/cli/review-commands.test.ts \
  tests/integration/db/cli/goal-commands.test.ts \
  tests/integration/db/cli/memory-commands.test.ts
do
  if [ ! -f "$file" ]; then
    echo "Required DB inventory file missing: $file" >&2
    exit 1
  fi
done

echo "test pyramid script/config inventory OK"
