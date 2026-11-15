# Sabotage demo evidence — 2026-06-10

Every constitution check was demonstrated catching a planted violation (red),
then passing after removal (green), per the RATIFY procedure. Plants were
temporary files or exact-string edits, all reverted; `grep sabotage` over
`src/` and `Profiles/` returns nothing.

| Check | Plant | Red evidence (verbatim excerpt) |
| --- | --- | --- |
| `depcruise: domain-is-pure` | temp `src/domain/_sabotage_demo.ts` importing `../db/index.js` | `error domain-is-pure: src/domain/_sabotage_demo.ts → src/db/index.ts` |
| `depcruise: domain-no-io` | same file importing `node:fs` | `error domain-no-io: src/domain/_sabotage_demo.ts → fs` |
| `depcruise: web-anon-client-only` | temp `src/web/lib/_sabotage_demo.ts` importing `../../db/index.js` | `error web-anon-client-only: src/web/lib/_sabotage_demo.ts → src/db/index.ts` |
| `eslint: web-service-role-ban` | same plant, via ESLint | `error '../../db/index.js' import is restricted... Service-role DB client is forbidden in src/web/` |
| `eslint: test-only-exports` | temp `src/cli/_sabotage_eslint.ts` importing `_getRegisteredProbeForTest` | `error '_getRegisteredProbeForTest' import ... is restricted` |
| `test: task write funnel guard` | temp files with `.insert(tasks)` in `src/cli` and `db.transaction(` in `src/cli/commands` | both `it`s FAIL (insert outside helpers; transaction in commands) |
| `test: contract-conformance` | bogus `sabotage-demo-op` appended to Production `contract.yaml` | `FAIL ... every contract.yaml operation has a CLI leaf under execos taskops` |
| `test: no-inference golden` | priority inferred from `/urgent\|asap/i` in `createTaskOperation` | `FAIL ... never infers priority, even from screaming urgency text (D2)` |
| `test: terminal-status goldens` | terminal-status rejection disabled in `updateTaskOperation` | `FAIL ... rejects terminal statuses through update; complete/cancel are the only terminal paths` |
| `test: dedup goldens` | duplicate-gate match filter forced empty | `FAIL ... refuses a near-duplicate open task, listing matches (D4)` (+ override-audit collateral) |
| `test: recorder goldens` | `recordTaskGoalLinked` call removed | `FAIL ... records recordTaskGoalLinked plus a system note when goalId is set` |
| `test: append-only scan` | temp file with `db.update(taskNotes)` | `FAIL ... source files do not update or delete taskNotes` |
| `ci: db:check-drift` | uncommitted column added to `schema.ts` | drift listed `modified: src\db\migrations\meta\_journal.json` + fix instructions |
| `ci: db:check-safety` | temp migration `9999_sabotage_demo.sql` with `DROP TABLE tasks;` | `DROP TABLE: DROP TABLE tasks ... create ...9999_sabotage_demo.destructive.md` |
| `test: dashboard health discovery` | `parseDashboardHealth` app-id check disabled | `FAIL parseDashboardHealth > rejects a payload with a foreign app id` |
| `behaviors: dashboard-start-non-blocking` | `await new Promise(() => {})` at top of `startDashboard` | `FAIL ... start returns the terminal promptly when a foreign process holds the port` (child killed at 25s budget) |
| `conventions: dashboard-loopback-only` | temp src file containing `"0.0.0.0"` | `FAIL ... no 0.0.0.0 bind literal anywhere under src/` |
| `conventions: priority-meta-single-source` | temp `.svelte` importing `TASK_PRIORITY_META` | `FAIL ... TASK_PRIORITY_META is referenced only by flags.ts and PriorityIndicator.svelte` |
| `conventions: shared-interaction-primitives` | same temp `.svelte` declaring `.kbd {` | `FAIL ... no local .kbd or .action-button styles outside Kbd/ActionButton` |
| `conventions: no-global-dark-remap` | same temp `.svelte` with `:global(.dark)` | `FAIL ... :global(.dark appears nowhere in src/web` |
| `conventions: profile-contract-parity` (retired by decision 019) | extra file in Developer's `OperationalContracts/` | `FAIL ... both profiles carry the same contract file set` |
| `conventions: contracts-single-source` (replaces the above, demo 2026-06-10) | stray `Profiles/Developer/OperationalContracts/stray.txt` recreated | `FAIL architecture/tests/conventions.test.ts > conventions: contracts-single-source > no profile carries an OperationalContracts tree` (1 failed, 25 passed); exact removal → 26/26 green |
| `conventions: registry-completeness` | `health` entry removed from `registry.ts` | `FAIL ... every Commander leaf appears in the registry as canonical, and vice versa` |
| `test: cli-help-skill-map` | `task list` mention mangled in Developer cli-help SKILL.md | `FAIL ... Developer CLI help skill mentions every executable command` |
| `conventions: constitution-sync` | bogus rule R25 naming `conventions: nonexistent-check` | `FAIL ... every STRUCTURAL and BEHAVIORAL rule names a check that exists` |
| `gates: test-pyramid` | temp fast-tier test importing `src/db/index.js` | `Concrete DB imports are forbidden outside DB/integration tiers` (exit 1) |
| R25 exit-code assertions (in `behaviors: dashboard-start-non-blocking`) | the original incident re-planted: entry-point exit-code clobber restored in `src/cli/index.ts` | both tests FAIL: `AssertionError: expected +0 to be 1`; exact revert (zero diff) → 2/2 green. Ratified as R25 in the live RATIFY walkthrough |
| `test: dedup goldens` (R9 amendment, W4 2026-06-10) | exact-match gate disabled in `createTaskOperation` (`deps.findExactMatches` result replaced with `[]`) | 6 FAIL incl. `refuses an exact title match (normalized) even when embeddings score below threshold` and `the exact-match gate still refuses when embed() throws (works through an embedding outage)` (6 failed, 35 passed); exact revert (zero diff) → 41/41 green |

Green confirmation after all reverts: `npm run arch:check` 26/26 passed,
`tests/services/task-operations.test.ts` 28/28, `dashboard-launcher` 26/26,
both migration guards `OK`, import gate `DB import discipline OK`.

## Latent defects the demos surfaced (both real)

1. **The ESLint web service-role ban was dead for `.ts` files.** The
   `src/**/*.ts` override came later in `.eslintrc.json` and *replaced* (not
   merged) the `no-restricted-imports` options of the `src/web/**` override,
   and the pattern group also lacked the `**/db/index.js` form that NodeNext
   imports actually use. Fixed during Phase 1 (override reordered, both
   pattern groups in the web override, `.js` pattern added); the depcruise
   rule now covers the `.ts` half independently.
2. **Dashboard subcommand failure exits were swallowed.** The four `dashboard`
   actions set `process.exitCode`, but both entry points
   (`scripts/execos.mjs` and the direct-invocation block in
   `src/cli/index.ts`) overwrote it with `main()`'s resolved value (0).
   Fixed 2026-06-10 with Calvin's approval (nonzero-only assignment in both
   entry points); the behavioral test now pins the exit codes.

## R26 `test: gate-events append-only scan` — 2026-06-10

Demo run during W5 implementation, recorded at ratification:

1. Planted `db.update(gateEvents).set({ outcome: "warned" })...` in
   `src/db/helpers/gate-events.ts` → `tests/db/append-only-scan.test.ts` RED:
   `source files do not update or delete gateEvents` (1 failed | 3 passed).
2. Reverted; planted a raw `db.insert(gateEvents).values({...})` in
   `src/services/task-operations.ts` → RED: `only src/db/helpers/gate-events.ts
   inserts into gateEvents (appendGateEvent is the single write path)`
   (1 failed | 3 passed).
3. Reverted → GREEN: 4 passed (4).

## R27 `behaviors: due-date-required` — 2026-06-11

Demo run at ratification (change-009 T16). Plants were exact-string bypass
edits in `src/services/task-operations.ts`, both reverted (working-tree diff
on the file empty afterward):

1. Planted `if (false && !input.dueAt)` over the create guard
   (task-operations.ts:587) → RED: `create refuses a task with no due date
   (dueAt omitted)` and `create refuses a task with a null due date` both
   FAIL on `expect(err.code).toBe("due_required")` (2 failed | 1 passed) —
   the operation sailed past the guard into downstream deps.
2. Reverted; planted `if (false && input.dueAt === null)` over the update
   guard (task-operations.ts:936) → RED: `update refuses to clear an
   existing task's due date (dueAt: null)` FAILS (1 failed | 2 passed).
3. Reverted → GREEN: full `arch:check` 31 passed (31), depcruise 0
   violations over 228 modules.

## R28 `conventions: bits-ui-single-library` — 2026-06-11

Demo run at ratification. Two plants, both reverted (package.json restored
via git checkout, temp file deleted; working tree clean afterward except
the unrelated in-flight toast work):

1. Planted temp `src/web/lib/_sabotage_demo.ts` importing
   `@melt-ui/svelte`, and `"@melt-ui/svelte": "^0.86.0"` added to
   package.json dependencies (not installed) → RED: `no competing UI
   component library is declared in package.json` FAILS
   (`AssertionError: expected [ '@melt-ui/svelte' ] to deeply equal []`)
   and `no src/web module imports a competing UI component library` FAILS
   (offender `src/web/lib/_sabotage_demo.ts -> @melt-ui/svelte`)
   (2 failed | 17 passed).
2. Reverted both → GREEN: conventions suite 19 passed (19); full
   `arch:check` green.
