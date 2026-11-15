# 018 — Command failures exit nonzero

Status: RATIFIED — Calvin, 2026-06-10 (live RATIFY walkthrough).

## Statement

A `execos` command that reports failure exits nonzero: the entry points
(`scripts/execos.mjs`, the direct-invocation block in `src/cli/index.ts`)
never overwrite a failure exit code already set by a command action, and no
surface prints an error while exiting 0.

## Context

Found 2026-06-10 by the Phase 1 sabotage demos: all four `dashboard`
subcommands set `process.exitCode` on failure, but both entry points
clobbered it with `main()`'s resolved 0, so "Dashboard is not running" and
"did not become healthy" exited 0. Anything scripted on `$?` (the
installer's stop-before-update, CI smoke steps, hooks, agents chaining
`execos dashboard start && ...`) was told the failure succeeded. Fixed in
commit a1589b1 (nonzero-only assignment in both entry points). This rule
keeps the contract from regressing; thrown errors were already covered by
the error classifier's stable exit codes.

## Enforcement

BEHAVIORAL — the exit-code assertions inside
`behaviors: dashboard-start-non-blocking`
(architecture/tests/behaviors/dashboard-start-non-blocking.test.ts), which
run the real CLI and assert exit 1 on both failure paths. Check shared with
R16, as R2/R4 share the funnel scan. Sabotage demo: 2026-06-10 — the
original incident re-planted (entry-point clobber restored) turned both
assertions red (`expected +0 to be 1`); exact revert returned them green
(see architecture/sabotage-demos.md).

## Alternatives considered

A dedicated `behaviors: nonzero-failure-exits` test file — rejected by the
deletion test: it would duplicate the existing assertions and add runtime
without adding coverage. If a future failure shape outside the dashboard
family regresses, extend the assertions and revisit the check name then.
