# 012 — Three test tiers, kept separate

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

Three tiers, three configs, three commands: the fast suite (~30s budget, no
concrete DB imports, no `resetDbData`, fakes only), the DB suite (real
Postgres, serial file execution), and the destructive migration suite (gated
behind `EXECOS_RUN_DESTRUCTIVE_DB_TESTS=1`, disposable database only).

## Context

Fast feedback on every push requires the fast suite to never touch Postgres;
DB correctness requires real Postgres without parallel-file interference;
migration roundtrips are destructive and must be impossible to run by
accident. Collapsing tiers re-creates the slow, flaky, dangerous default this
structure was built to escape.

## Enforcement

STRUCTURAL — `gates: check-pyramid / check-imports / check-fast-reset`
(`scripts/check-test-pyramid.sh`, `check-import-discipline.sh`,
`check-fast-tests-no-resetDb.sh`) + `tests/_meta/fast-suite-boundaries.test.ts`
and `tests/_meta/migration-gate.test.ts`. Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

One suite with env switches — rejected: accidental destructive runs and an
unbounded fast path.
