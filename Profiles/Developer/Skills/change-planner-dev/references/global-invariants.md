# Reference: global repo invariants (Architecture phase)

Load-bearing constraints that hold across the whole execos codebase. During
the Architecture phase, read this list and **capture every invariant that applies to
the current change as an A# item**, so the tasks that touch that area depend on it and
the constraint stays enforced through later edits. Not every invariant applies to
every change; use judgment. Maintain this file: when a new global invariant is
discovered (or one changes), add/edit it here so future change requests inherit it.

This is the judgment-applied stand-in for auto-materialized invariants (see ROADMAP
ideas 3 and 4). Each entry: the rule, and where it lives / is enforced.

## Database and data

- **`task_notes` is append-only.** All writes go through `appendTaskNote()`; there is
  NO UPDATE or DELETE on `task_notes` anywhere in `src/`. Enforced by an app-layer
  scan test (`tests/db/append-only-scan.test.ts`).
- **Drizzle-native schema, no hand-written SQL migrations, no PL/pgSQL triggers (ADR-006).**
  Constraints, RLS policies, sequences, and the derived views (`v_recent_wins`,
  `v_eligible_for_prioritization`) live in `src/db/schema.ts`. Logic the schema cannot
  express (atomic status transitions, audit-note inserts in-transaction, cycle checks,
  WIP-cap row locks) lives in `src/db/helpers/`.
- **Two DB clients.** `db` (service-role, bypasses RLS) from `src/db/index.ts`; the
  anon client from `src/db/anon-client.ts` for RLS-restricted reads.
- **Status transitions go through the matrix, and the CALLER enforces it, not the
  helper.** `updateTaskStatus` is an atomic write primitive that does NOT check the
  matrix (`src/db/helpers/task-status.ts` says so explicitly); the caller must run
  `canTransitionTask(from, to)` (`src/domain/status-transitions.ts`) FIRST. `done` and
  `cancelled` are terminal for ordinary operations; exits from them are allowed only
  through the explicit `taskops reopen` service/command. Two traps:
  (a) `updateTaskFields` will blindly `.set({ status })` if `status` is in its patch,
  bypassing the matrix, so never route a status change through `updateTaskFields`;
  (b) every NEW caller of a status-changing path (a web `+server.ts`, a new
  service/operation, the `recordFollowUp` "mark done" path) must own the
  `canTransitionTask` check itself, because shared operations are caller-agnostic and
  cannot assume a particular caller validated for them. WIP caps and atomic transitions
  are enforced in helpers under `SELECT ... FOR UPDATE`.
- **Shared operations own their own guards.** Service/operation functions in
  `src/services/` are deliberately caller-agnostic (the same function backs the CLI/agent
  AND the dashboard endpoint). Any invariant the operation depends on (matrix check,
  ownership/validation, defaults) must be enforced INSIDE the operation, never left to
  one caller, because a second caller will eventually appear.
- **Delegation / follow-up data model (change-004).** `follow_up_date` is the SINGLE
  universal resurface timestamp: it is both the delegated follow-up date AND the
  snooze/defer date for a self-owned task; deferring overwrites it. Delegated-ness is
  DERIVED from `owner`, not stored: `owner == "me"` (or null/empty, normalized via
  `normalizedOwner` in `src/domain/follow-ups.ts`) is self-owned; any other value is a
  delegate. There is no delegation status/flag and no `delegated_at` /
  `last_followed_up_at` columns; that history lives in `task_activities`. An owner must
  resolve to a `team`-table slug (`resolveOwnerToTeamSlug`); never store a free-text owner.
- **Writes are last-write-wins.** There is NO optimistic-concurrency / row-version /
  `updated_at`-precondition mechanism on `tasks`; nothing returns a 409 on a stale write.
  The only concurrency control is `SELECT ... FOR UPDATE` inside specific helpers, for
  atomicity within one operation. Do not design features assuming conflict detection that
  does not exist.
- **Task IDs** are composed via `composeTaskId()` using the settings prefix, not
  hand-built.

## Web (src/web) read/write path

- **`src/web` must NOT import the service-role db** (`**/db/index`); ESLint-enforced
  across all of `src/web/**`, server files included. Web reads via the anon client
  only (RLS read-only). Browser writes must route through code OUTSIDE `src/web`.
- **Svelte MCP is required when editing `src/web`.** Use `mcp__svelte__*`
  (list-sections, get-documentation, svelte-autofixer) for any `.svelte` /
  `+page.server.ts` / `+server.ts` / config edits; do not write Svelte 5 / SvelteKit 2
  from memory.

## Layering (do not violate)

- `src/domain/` is pure: validation, formulas, transition matrix, retrieval. No DB
  imports, no I/O.
- `src/db/` is schema + typed helpers.
- `src/cli/adapters/` declares repository interfaces; commands consume the seams; tests
  inject fakes.
- `src/cli/commands/` wires Commander subcommands and resolves `Settings` once.

## Modules and settings

- **ESM with explicit `.js` extensions** on relative imports (NodeNext).
- **Settings are loaded once** per process (`settings-loader.ts`); domain functions
  take `Settings` as a parameter and never read it themselves.
- **Test-only exports** named `_*ForTest` are blocked from import anywhere under
  `src/` (tests only).

## Tests and lifecycle

- **Three test tiers, three configs**: fast (`vitest.config.ts`, no real DB, no
  concrete DB imports, no `resetDbData`), DB (`vitest.db.config.ts`,
  `fileParallelism: false`), migration (`vitest.migration.config.ts`, destructive,
  gated). Do not collapse them.
- **Pool lifecycle**: scripts and tests must `await closeDb()` before exit.
- **Package manager is npm** (the lockfile is `package-lock.json`); never pnpm/yarn.
