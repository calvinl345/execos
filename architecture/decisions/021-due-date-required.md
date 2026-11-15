# 021 — Due date required on every task

Status: RATIFIED — Calvin, 2026-06-11 (change-009 S19/A17; rule requested by
Jordan, layer chosen by Calvin).

## Statement

Every task carries a due date. `createTaskOperation` refuses to store a task
without one and `updateTaskOperation` refuses to clear one; both refusals are
`TaskServiceError("due_required")` and are identical on every surface that
reaches the funnel (CLI, web dispatcher, future callers). Enforcement lives
in the services/CLI layer, not the database: the `tasks.due_date` column
stays nullable so legacy rows that predate the rule remain readable without
a backfill migration.

## Context

Jordan asked for a validation that every created task gets a due date.
Research during change-009 planning (2026-06-11) found the rule already
implemented exactly where Calvin wants it: create throws `due_required`
(src/services/task-operations.ts:587), update rejects `dueAt: null`
(task-operations.ts:935), the CLI makes `--due` required, and the task
skills document "Due date (required)". What was missing was protection
against silent regression: nothing pinned the behavior, and a refactor of
the validate block could have dropped it without any gate noticing. This
decision elevates the existing behavior to constitution rule R27.

## Enforcement

BEHAVIORAL — `behaviors: due-date-required`
(architecture/tests/behaviors/due-date-required.test.ts): a golden with
fully stubbed deps asserting create without `dueAt` (omitted and null) and
update with `dueAt: null` all throw `due_required`, and that the refusal
happens before any downstream work (every dep past the guard throws if
reached). Runs in the architecture suite via `npm run arch:check`. Sabotage
demo recorded in architecture/sabotage-demos.md.

## Alternatives considered

- **DB-layer NOT NULL constraint**: rejected by Calvin (S19 ruling). It
  would require backfilling or destroying legacy null rows, push a business
  rule into the schema where refusal UX is worst (constraint violation
  instead of a typed service error), and contradict the established pattern
  that shared operations own their guards.
- **CHECK constraint on new rows only**: not expressible cleanly in
  Postgres without a trigger; PL/pgSQL triggers are banned by R13.
- **CONTEXTUAL rule (unenforced)**: pointless here; the behavior already
  exists, so the cheapest honest enforcement is a golden that pins it.

## Amendment — CLI defaults `--due` instead of requiring it (batch-009 ISS-008)

Status: AMENDED — Calvin, 2026-06-14 (batch-009 ISS-008, Option A).

The invariant is UNCHANGED: every task still carries a due date, and the
service layer still owns enforcement. What changed is only the CLI's
behavior when the operator gives no due date.

Previously the create command declared `--due` as a `requiredOption`, so a
create with no due date failed at argument parsing. Scenario testing showed
the agent then fabricated due dates inconsistently. Per ISS-008 the CLI now
makes `--due` optional and, when it is omitted, defaults the due date to
`DEFAULT_DUE_BUSINESS_DAYS` (3) business days out, weekend-avoiding, at
end-of-day local (`addBusinessDaysInTz` in src/domain/dates.ts). The create
output flags, via the existing `warnings` channel, that the date was
defaulted so it can be surfaced to Jordan. A defaulted due date is always
soft (never a hard deadline).

R27 itself is not weakened:

- `createTaskOperation` STILL refuses an undefined/null `dueAt` with
  `TaskServiceError("due_required")`, and `updateTaskOperation` still
  refuses to clear one. The CLI now always supplies a `dueAt` (explicit or
  defaulted), so it never hits that refusal, but every other caller (web
  dispatcher, future callers) remains guarded.
- The behavioral golden (`architecture/tests/behaviors/due-date-required.test.ts`)
  is intentionally UNCHANGED: it pins the service-layer refusal, which is
  the actual invariant. Only the CLI-surface integration test changed (from
  "requires --due for every created task" to "defaults the due date when
  --due is omitted") in tests/integration/db/cli/task-commands.test.ts.
