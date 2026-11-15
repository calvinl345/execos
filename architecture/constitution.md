# Constitution

> **STATUS: RATIFIED — approved by Calvin on 2026-06-10 (R1–R24).**
>
> Budget: at most ~30 rules, one page. At the limit, consolidate; never append
> past it. Rules enter, change, or leave this file only by Calvin's explicit
> decision. Every `[STRUCTURAL]` and `[BEHAVIORAL]` rule names the check that
> enforces it (multiple checks joined with ` + `); `[CONTEXTUAL]` rules are
> honestly unenforced and carry `context-only`. The constitution sync test
> (`npm run arch:check`) fails if a named check disappears or a check loses
> its rule.

## Layering

- **R1** [STRUCTURAL] `src/domain` is pure: it imports nothing at runtime from `db`, `cli`, `web`, `embeddings`, or `services` (type-only row-shape imports are erased at compile time and tolerated), performs no I/O, and receives `Settings` as a parameter instead of loading it. — `depcruise: domain-is-pure + depcruise: domain-no-io` — [decisions/001-domain-purity.md](decisions/001-domain-purity.md)
- **R2** [STRUCTURAL] Every task write flows through one funnel: commands parse input, call one service operation, and format its receipt; services orchestrate transactions composing only `src/db/helpers` primitives; only `src/db/helpers` writes `tasks` rows. Reads may query directly. — `test: task write funnel guard` — [decisions/003-unified-task-write-funnel.md](decisions/003-unified-task-write-funnel.md)
- **R3** [STRUCTURAL] `src/web` never touches the service-role DB client; it reads through the anon client under RLS only. — `depcruise: web-anon-client-only + eslint: web-service-role-ban` — [decisions/002-web-read-path.md](decisions/002-web-read-path.md)
- **R4** [STRUCTURAL] The web action endpoint consumes the same service operations as the CLI; no parallel write stack exists. — `test: task write funnel guard` — [decisions/003-unified-task-write-funnel.md](decisions/003-unified-task-write-funnel.md)
- **R5** [STRUCTURAL] Test-only exports (`_*ForTest`) are never imported anywhere under `src/`. — `eslint: test-only-exports` — [decisions/015-test-only-exports.md](decisions/015-test-only-exports.md)

## Task operations

- **R6** [STRUCTURAL] The `taskops` CLI surface and `contract.yaml` stay in bijection: every write operation has hydrate and receipt templates, and templates never render with unfilled slots. — `test: contract-conformance` — [decisions/003-unified-task-write-funnel.md](decisions/003-unified-task-write-funnel.md)
- **R7** [BEHAVIORAL] Priority is never inferred from text; only an explicit `--priority` flag sets it, and a create without one stores null. — `test: no-inference golden` — [decisions/004-no-priority-inference.md](decisions/004-no-priority-inference.md)
- **R8** [BEHAVIORAL] Terminal status changes (`done`, `cancelled`) require `--yes` on every surface and route only through the complete and cancel operations. — `test: terminal-status goldens` — [decisions/005-terminal-confirmation.md](decisions/005-terminal-confirmation.md)
- **R9** [BEHAVIORAL] The duplicate gate compares against open tasks only, by embedding similarity and by normalized exact title/description match, refuses on any match unless `--allow-duplicate "<justification>"` (justification recorded in the audit note), and never blocks capture when embedding fails (exact matching still runs). — `test: dedup goldens` — [decisions/006-duplicate-gate.md](decisions/006-duplicate-gate.md)
- **R10** [STRUCTURAL] `task_notes` is append-only: no UPDATE or DELETE anywhere in `src/`; all writes route through `appendTaskNote()`. — `test: append-only scan` — [decisions/007-append-only-task-notes.md](decisions/007-append-only-task-notes.md)
- **R11** [CONTEXTUAL] One business operation has exactly one name and one canonical path; a second name for the same operation is drift. — `context-only` — [decisions/016-one-name-per-operation.md](decisions/016-one-name-per-operation.md)
- **R12** [BEHAVIORAL] Every user-meaningful task operation records an activity of a defined event type in the same transaction as the write, so each task's activity history reads as a complete, human-sensible timeline. Tasks only for now; goals join when goal activities are built. — `test: recorder goldens` — [decisions/017-mutations-are-audited.md](decisions/017-mutations-are-audited.md)
- **R26** [STRUCTURAL] `gate_events` is append-only telemetry: no UPDATE or DELETE anywhere in `src/`, and all writes route through `appendGateEvent()`. — `test: gate-events append-only scan` — [decisions/020-gate-events-telemetry.md](decisions/020-gate-events-telemetry.md)
- **R27** [BEHAVIORAL] Every task carries a due date: create refuses to store a task without one and update refuses to clear it, both with `due_required`. Enforcement is service-layer by decision; the schema column stays nullable for legacy rows. — `behaviors: due-date-required` — [decisions/021-due-date-required.md](decisions/021-due-date-required.md)

## Data

- **R13** [STRUCTURAL] The schema is Drizzle-native: `schema.ts` must match committed migrations; no hand-written SQL migrations, no PL/pgSQL triggers. — `ci: db:check-drift` — [decisions/008-drizzle-native-schema.md](decisions/008-drizzle-native-schema.md)
- **R14** [STRUCTURAL] No migration may destroy data without an explicit acknowledgment file. — `ci: db:check-safety` — [decisions/009-migration-safety.md](decisions/009-migration-safety.md)

## CLI surface

- **R25** [BEHAVIORAL] A `execos` command that reports failure exits nonzero: entry points never overwrite a failure exit code set by a command action, and no surface prints an error while exiting 0. — `behaviors: dashboard-start-non-blocking` — [decisions/018-nonzero-failure-exits.md](decisions/018-nonzero-failure-exits.md)

## Dashboard

- **R15** [BEHAVIORAL] The running dashboard is discovered through its health endpoint answering with the shared app id and its own pid; launcher bookkeeping never overrides what the endpoint reports. — `test: dashboard health discovery` — [decisions/010-dashboard-lifecycle.md](decisions/010-dashboard-lifecycle.md)
- **R16** [BEHAVIORAL] Agent-invoked commands are non-blocking: `dashboard start` returns the terminal promptly, and the server's lifetime is decoupled from its creator with no idle shutdown. — `behaviors: dashboard-start-non-blocking` — [decisions/010-dashboard-lifecycle.md](decisions/010-dashboard-lifecycle.md)
- **R17** [STRUCTURAL] The dashboard binds `127.0.0.1` only, never `0.0.0.0` or a LAN address. — `conventions: dashboard-loopback-only` — [decisions/010-dashboard-lifecycle.md](decisions/010-dashboard-lifecycle.md)

## Web UI

- **R18** [STRUCTURAL] Priority and flag visual vocabulary lives only in `flags.ts`; `PriorityIndicator.svelte` is the only module that imports `TASK_PRIORITY_META`. — `conventions: priority-meta-single-source` — [decisions/011-web-ui-single-vocabulary.md](decisions/011-web-ui-single-vocabulary.md)
- **R19** [STRUCTURAL] Keyboard chips and icon action buttons render only through `Kbd.svelte` and `ActionButton.svelte`; no component defines a local `.kbd` or `.action-button` style. — `conventions: shared-interaction-primitives` — [decisions/011-web-ui-single-vocabulary.md](decisions/011-web-ui-single-vocabulary.md)
- **R20** [STRUCTURAL] Dark mode is co-located `dark:` variants; `:global(.dark` appears nowhere in `src/web`. — `conventions: no-global-dark-remap` — [decisions/011-web-ui-single-vocabulary.md](decisions/011-web-ui-single-vocabulary.md)
- **R21** [CONTEXTUAL] State is never encoded by color alone (dual-encode with text or glyph); no legend strips: meaning renders where the state appears. — `context-only` — [decisions/011-web-ui-single-vocabulary.md](decisions/011-web-ui-single-vocabulary.md)
- **R28** [STRUCTURAL] `bits-ui` is the only UI component library in `src/web`: it stays a direct dependency, and no competing component or headless-primitive library is installed or imported. — `conventions: bits-ui-single-library` — [decisions/022-bits-ui-component-library.md](decisions/022-bits-ui-component-library.md)

## Testing

- **R22** [STRUCTURAL] The three test tiers stay separated: the fast suite has no concrete DB imports and no `resetDbData`, the DB suite runs serially, and destructive migration tests are env-gated. — `gates: test-pyramid` — [decisions/012-test-pyramid.md](decisions/012-test-pyramid.md)

## Profiles and doctrine

- **R23** [STRUCTURAL] `Profiles/` is the only authoritative copy of skills and system prompts, and the repo-root `OperationalContracts/` is the only authoritative copy of operational contracts, loaded directly at runtime; materialized copies are generated output, and no per-profile contract tree exists. — `conventions: contracts-single-source` — [decisions/019-contracts-single-source.md](decisions/019-contracts-single-source.md)
- **R24** [STRUCTURAL] Every CLI command is registered in `architecture/registry.ts` with accurate metadata (operation, status, mutates, blocking), and appears in both profiles' cli-help SKILL.md. — `conventions: registry-completeness + test: cli-help-skill-map` — [decisions/014-command-registry.md](decisions/014-command-registry.md)