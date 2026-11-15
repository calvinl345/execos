# 017 — Every user-meaningful task operation is audited

Status: RATIFIED — Calvin, 2026-06-10. Intent confirmed; formerly pending formal
ratification with the full constitution.

## Statement

Every user-meaningful task operation records an activity of a defined event
type, in the same transaction as the write, so each task's activity history
reads as a complete, human-sensible timeline. The unit is the user-meaningful
operation, not the raw CRUD write: one delegation is one
`task_delegation_updated` activity, however many rows it touches.

## Context

Calvin's intent (2026-06-10): activity history must exist for every single
thing that happens to a task, expressed in user-meaningful categories. The
defined event types live in `src/db/helpers/append-task-activity.ts` as
dedicated recorders — currently 14: `task_created`, `task_status_changed`,
`task_fields_updated`, `task_delegation_updated`, `task_followed_up`,
`task_deferred`, `task_goal_linked`, `task_goal_unlinked`,
`task_dependency_added`, `task_dependency_removed`, `task_attention_flagged`,
`task_attention_cleared`, `task_resource_attached`,
`task_mcp_action_recorded`. A new operation ships with its recorder or it
does not ship.

Scope: tasks only for now. Goals are an explicit exception — goal activities
have not been built; when they are, goals join this rule. Memory and
resources are out of scope until their operational contracts exist.

## Enforcement

BEHAVIORAL — `test: service goldens (recorders)` in
`tests/services/task-operations.test.ts` and
`tests/services/task-curation-operations.test.ts` (existing; Phase 1 verifies
every mutating service operation asserts its recorder and closes any gaps).
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

DB triggers writing audit rows — rejected by ADR-006 (decision 008).
Auditing raw CRUD instead of operations — rejected: the history must make
sense to a human reading one task's timeline.
