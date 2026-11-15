# 009 — No silent data destruction in migrations

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

No migration may destroy data (drop a table or column, truncate, narrow a
type) without an explicit acknowledgment file committed alongside it.

## Context

Migrations run against production data via `db:migrate:prod`. A generated
migration can include destructive statements that look routine in review. The
safety gate forces destruction to be a stated decision, not a side effect.

## Enforcement

STRUCTURAL — `ci: db:check-safety` (`scripts/check-migration-safety.mjs`,
runs in the DB Guards workflow on every push and PR).
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Review-only vigilance — rejected: deterministic gates beat attention.
