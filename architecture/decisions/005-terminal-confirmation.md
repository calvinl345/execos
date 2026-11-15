# 005 — Terminal status changes are confirmed and routed

Status: RATIFIED — Calvin, 2026-06-10. Ratified in substance by
Calvin on 2026-06-09 as change-008 decision D3.

## Statement

`done` and `cancelled` happen only through `completeTaskOperation` /
`cancelTaskOperation`, every CLI surface requires `--yes` for them, and
`updateTaskOperation` rejects terminal target statuses.

## Context

Before change-008, `task complete` required `--yes` while `taskops complete`
skipped it: the same irreversible action had two safety levels depending on
the entry point. One rule, every surface. The confirmation lives at the
CLI/transport layer; services execute unconditionally once called.

## Enforcement

BEHAVIORAL — `test: terminal-status goldens` in
`tests/services/task-operations.test.ts` plus CLI-level `--yes` tests; DB-tier
coverage in `tests/integration/db/cli/task-commands.test.ts`.
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Confirmation inside the service — rejected: services are also consumed by the
web dispatcher, which has its own confirmation UX; the check belongs to the
surface.
