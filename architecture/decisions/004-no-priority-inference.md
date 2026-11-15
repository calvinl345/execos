# 004 — Priority is never inferred

Status: RATIFIED — Calvin, 2026-06-10. Ratified in substance by
Calvin on 2026-06-09 as change-008 decision D2.

## Statement

No code path guesses a task's priority from its text. Priority is set only by
an explicit `--priority` flag; a create without one stores null.

## Context

The KS-198 incident: `task create` inferred P0 from a stray urgency phrase in
a description, producing an invisible decision with real WIP-cap
consequences. Priority is a judgment call that belongs to the agent and
Jordan, not a keyword heuristic. The hydration packet instructs the agent to
propose a priority; Jordan confirms.

## Enforcement

BEHAVIORAL — `test: no-inference golden` in
`tests/services/task-operations.test.ts`. Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Keeping inference behind a flag — rejected: an invisible default is exactly
the failure mode that caused the incident.
