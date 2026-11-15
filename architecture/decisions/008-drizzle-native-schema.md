# 008 — Drizzle-native schema, no hand-written migrations

Status: RATIFIED — Calvin, 2026-06-10. Source: ADR-006.

## Statement

The schema is Drizzle-native: constraints, RLS policies, sequences, and
derived views live in `src/db/schema.ts`; migrations are generated, never
hand-written; no PL/pgSQL triggers. Logic the schema cannot express lives in
typed TypeScript helpers under `src/db/helpers/`.

## Context

ADR-006 chose Drizzle-native primitives + TypeScript-layer enforcement over
hand-written SQL and database triggers: one declarative source of truth for
shape, one debuggable language for logic. Drift between `schema.ts` and the
committed migrations means one of them is lying.

## Enforcement

STRUCTURAL — `ci: db:check-drift` (`scripts/check-migration-drift.mjs`, runs
in the DB Guards workflow on every push and PR). Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

PL/pgSQL triggers for invariants like append-only notes — rejected in
ADR-006: opaque to TypeScript tooling and tests.
