# 003 — Unified task write funnel (change-008)

Status: RATIFIED — Calvin, 2026-06-10. Ratified in substance by
Calvin on 2026-06-09 as change-008 decisions D1–D5.

## Statement

Every task write flows through one funnel: commands parse input, call ONE
service operation, and format its receipt; services orchestrate transactions
composing only `src/db/helpers` primitives; only `src/db/helpers` writes
`tasks` rows. The web dispatcher consumes the same services (no parallel write
stack), and the `taskops` CLI surface stays in bijection with its operational
contract. Reads may query the DB directly; the funnel constrains writes.

## Context

By June 2026 three parallel task write stacks existed (inline in `task.ts`,
inline in `taskops.ts`, services for the web). Drift between them caused real
damage: `task create` silently inferred priority (the KS-198 P0 incident)
while `taskops create` did not; terminal confirmation was required on one
surface and skipped on another; the intake dedup check ran against an empty
candidate list. Live testing showed agents bypassing the operational contract
through legacy commands. change-008 collapsed everything into one funnel and
deleted the legacy write commands. Deep design was specified in
`docs/architecture/operations-architecture.md`, absorbed into this system and
removed on 2026-06-10 (full text in git history).

## Enforcement

STRUCTURAL — `test: task write funnel guard`
(`tests/cli/task-write-funnel-scan.test.ts`: no `.insert/.update/.delete(tasks)`
outside `src/db/helpers`, no `db.transaction(` in commands) and
`test: contract-conformance` + taskops template rendering
(`tests/cli/contract-conformance.test.ts`, `tests/cli/taskops.test.ts`).
Exception: shrink-only ratchet for `goal.ts`/`memory.ts`/`resource.ts`
transactions until goalops/memoryops (see exceptions.md).
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Keeping legacy write commands as visible deprecated aliases — rejected
(change-008 D1): one write surface means one contract catalog and one set of
semantics.
