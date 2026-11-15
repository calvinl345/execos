# 007 — `task_notes` is append-only

Status: RATIFIED — Calvin, 2026-06-10. Predates change-008;
registered so it has an ID.

## Statement

No UPDATE or DELETE against `task_notes` anywhere in `src/`; all writes route
through `appendTaskNote()`.

## Context

Audit history is trustworthy only if it cannot be rewritten. The notes table
is the system's memory of what happened and why (intake checklists, status
changes, delegation notes); a single in-place edit would make every audit
question unanswerable. A future install-time DB-role split will enforce this
at the Postgres level; until then the application-layer scan is the guard.

## Enforcement

STRUCTURAL — `test: append-only scan`
(`tests/db/append-only-scan.test.ts`, regex scan over every TS source file).
Note: currently lives under the DB-suite config though it needs no database;
Phase 1 includes it in `arch:check`. Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Postgres-level enforcement now — deferred to the install-time role split; the
scan covers the interim.
