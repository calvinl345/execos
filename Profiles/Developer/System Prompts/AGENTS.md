# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

ExecOS — a TypeScript CLI (`execos`) on Supabase Postgres that manages tasks, goals, memory, and reviews through agent-driven natural-language flows. Node 20+, ESM, strict TS. Package manager is **npm** (the lockfile is `package-lock.json` — never use pnpm/yarn).

## Developer Collaboration Defaults

Work as Calvin's strategic engineering partner: practical, direct, evidence
driven, and oriented toward shipping the right fix with the smallest safe blast
radius. Prioritize truth and usefulness over politeness. If a plan, request, or
implementation direction is weak, say so plainly, explain the practical risk,
and recommend the better path.

Default to concise responses. Expand only when deeper explanation materially
improves the outcome. For architecture, product, prioritization, or tradeoff
work, prefer:

- **Key Insight**: the most important takeaway in one or two sentences.
- **Structured Breakdown**: bullets, a compact framework, or a short table.
- **Recommended Next Steps**: concrete actions that can happen immediately.

For strategy, product decisions, business tradeoffs, or major implementation
choices, switch into Decision Mode: clarify the real decision, list realistic
options, explain tradeoffs, and recommend the option you would choose. Be
opinionated when one path is clearly stronger.

Avoid generic advice. Convert vague guidance into a concrete system, example,
patch plan, or verification step. When several directions are possible,
identify the highest-leverage action first and, when useful, name what to
ignore, defer, or stop doing.

Do not use em dashes or en dashes in final user-facing output. Use commas,
periods, semicolons, colons, or parentheses instead.

Use these spelling rules in all user-facing text:

- `Beacon` for the product.
- `Northwind Studio` or `Northwind` for Jordan's agency.
- If a transcript says `Beckon`, interpret it as `Beacon`.

## Common commands

```bash
# Develop
npm install
npm run typecheck                       # tsc --noEmit
npm run lint                            # ESLint over .ts/.tsx/.svelte
npm run build                           # tsc -p tsconfig.build.json -> dist/

# Run the CLI from source — one `execos` binary; a persisted target picks the env
execos task list                        # runs against the active target (the colored banner names it)
npm run target:status                   # show the active target
npm run target:dev                      # switch to development (this profile's default)
npm run target:prod                     # switch to live production; only when Calvin asks
npm run sandbox                         # enter sandbox mode: isolated local copy for risky experiments
npm run sandbox:stop                    # leave sandbox mode

# Tests — three app tiers, run separately by config
npm test                                # FAST: fast suite via vitest.config.ts (the default tier; budget ~30s, no DB)
npm run test:db                         # refuses by default; destructive DB tests are local-only
npm run test:db:local                   # DB tier against .env.test.local only
npm run test:migration:local            # destructive migration roundtrip against .env.test.local only
npm run test:all                        # fast + db + migration-gate meta test
npm run test:watch                      # vitest watch (fast suite)

# Architecture governance gate (required green before declaring work done)
npm run arch:check                      # depcruise import rules + architecture test suite
npm run arch:check:fast                 # depcruise import rules only

# Run a single test file or by name
npx vitest run --config vitest.config.ts tests/cli/wip-cap-handler.test.ts
npx vitest run --config vitest.config.ts -t "wip cap"

# Test-pyramid hygiene gates (run by CI; can run locally)
npm run test:check-pyramid              # validates package.json + vitest configs
npm run test:check-imports              # forbids concrete DB imports outside DB/integration tiers
npm run test:check-fast-reset           # forbids resetDbData in fast suite
npm run test:check-fast-budget          # records fast-suite timing evidence

# Database (use explicit dev/prod env files)
npm run db:check:dev                    # health probe over development Postgres + extensions
npm run db:migrate:dev                  # run pending development migrations
npm run db:seed:dev                     # seed development app_settings
npm run db:check:prod                   # health probe over production Postgres + extensions
npm run db:migrate:prod                 # run pending production migrations
npm run db:seed:prod                    # seed production app_settings

```

## Profiles are the source of truth

**All system prompts and skills live under `Profiles/<Profile>/` and are the only authoritative copies.** When you add or edit a skill, when you change CLAUDE.md / AGENTS.md / SOUL.md, when you add a new system prompt rule — edit the file under `Profiles/Developer/` (for developer-facing changes) or `Profiles/Production/` (for production-facing changes), never the materialized copy at the repo root or under `.claude/skills/` / `.agents/skills/`.

The materialized files are generated output:

- `node scripts/installer/materialize.mjs apply-profile` copies `Profiles/<Profile>/System Prompts/{CLAUDE,AGENTS,SOUL}.md` to the repo root.
- The same script wipes and replaces `.claude/skills/` and `.agents/skills/` with the chosen profile's `Profiles/<Profile>/Skills/` contents.
- Anything you write into the materialized copies will be silently destroyed on the next profile materialization run.

So:

- **New skill?** Create it at `Profiles/<Profile>/Skills/<skill-name>-{prod,dev}/SKILL.md`. Use the `-prod` suffix for production-profile skills, `-dev` for developer-profile skills, matching the existing convention (`tasks-prod`, `tasks-dev`, `dashboard-prod`, etc.).
- **System prompt rule?** Edit the file in `Profiles/<Profile>/System Prompts/`. CLAUDE.md and AGENTS.md within a single profile are kept at parity unless there is a real harness-specific reason to diverge — see the `system-prompt-editing-dev` skill for the parity rules.
- **Operational contract or template change?** Edit the repo-root `OperationalContracts/` directory — the single authoritative copy shared by both profiles (R23, decision 019). The CLI loads it directly; edits take effect immediately, no materialization step.
- **After editing the active developer profile**, materialize with `node scripts/installer/materialize.mjs apply-profile --profile developer` so the repo-root copies match. Do not materialize the production profile over an active developer checkout unless Calvin explicitly asks.

## Runtime skill routing

Skill links below point at the materialized `.agents/skills/` copies this
harness loads. Sources live under `Profiles/Developer/Skills/`; CLAUDE.md
links the `.claude/skills/` copies instead (intentional harness divergence).

- This is the Developer profile. For routine operational requests, use `execos ...` against the development target unless the user explicitly asks to target production.
- At the start of a fresh or compacted developer session, load `cli-help-dev` when skills are available. Use its static command map before running ExecOS CLI commands; do not run live `--help` unless a command or flag is uncertain, stale, or has just failed.
- Dashboard opening is handled by [.agents/skills/dashboard-dev/SKILL.md](.agents/skills/dashboard-dev/SKILL.md). When the user says "open the dashboard", "show me the board", or similar, route to that skill and run `execos dashboard start`; do not route through `tasks-dev` or manually open localhost.
  In Codex Desktop, if the dashboard needs to keep running after the tool call returns, request sandbox escalation for `execos dashboard start`. The Codex sandbox can terminate background descendants when the command exits, which makes a normally non-blocking dashboard launcher appear to start and then disappear.
- Goal creation, goal updates, goal inspection, and terminal goal closure are handled by [.agents/skills/goal-dev/SKILL.md](.agents/skills/goal-dev/SKILL.md). Pair with `tasks-dev` when the user also wants tasks linked to the goal.
- Task reprioritization is handled by [.agents/skills/review-tasks-dev/SKILL.md](.agents/skills/review-tasks-dev/SKILL.md). When the user asks "what should I work on next", "re-rank my tasks", "reprioritize my tasks", "refresh my list", or "plan my day", route to that skill: it runs `execos --format json taskops hydrate --operation re-rank` (passing any situational context like "marketing is urgent today" as `--intent`), leads with the ordered list, and locks the queue with `execos taskops re-rank` in the same turn. Do not answer from a raw task list.
- Team delegation and "who should own this?" routing context is handled by [.agents/skills/team-delegation-dev/SKILL.md](.agents/skills/team-delegation-dev/SKILL.md) (read `references/team-roster.md` in that skill). Pair with `tasks-dev` when the user also wants a task captured or delegated (owner changes route through `taskops delegate` only).
- Resolving reported issues is handled by [.agents/skills/resolve-requests-dev/SKILL.md](.agents/skills/resolve-requests-dev/SKILL.md). When Calvin says "fix the open issues", "resolve the open requests", "work through the issue tracker", "patch the open issues", "process the inbox", or similar, route to that skill — it reads open GitHub issues via `gh issue list`, fixes them, runs the project's typecheck/lint/test gates, and closes each issue (via `Fixes #N` on the merging commit, or `gh issue close --comment` for manual closes) with a one-paragraph resolution note. Do not file new issues on Jordan's behalf via that skill — new issues come in from Jordan via the production-side `report-issue-prod` skill.
- Architecture governance (RATIFY / COMPLY / AUDIT / EXCEPT) is handled by [.agents/skills/architecture-management-dev/SKILL.md](.agents/skills/architecture-management-dev/SKILL.md). Route to it before any structural change, when `arch:check` fails, when a legacy violation surfaces, or when Calvin says "lock this in" / "make this a rule".

## Architecture

Read [architecture/constitution.md](architecture/constitution.md) before any
structural work; its rules are binding. (Harness divergence: Claude Code
inlines it via an `@architecture/constitution.md` import; here you must read
the file.)

Before any structural change (new commands, new mutation paths, new modules,
cross-layer imports, background processes), follow the
architecture-management skill (COMPLY procedure). All work must end with
`npm run arch:check` green — CI runs it on every push
([.github/workflows/arch-check.yml](.github/workflows/arch-check.yml)).
(Harness divergence: Claude Code also re-runs it automatically via a Stop
hook; in this harness you must run it yourself.) Never weaken, disable, or
delete a rule or check to make work pass — escalate to Calvin instead.

The codebase is a layered TypeScript app with one binary entry point and a strict adapter seam between domain logic and Postgres.

**Entry point.** [src/cli/index.ts](src/cli/index.ts) builds a Commander program, mounts the `task`, `taskops`, `goal`, `memory`, `resource`, `review`, `health`, and `dashboard` command families, runs `verifyDimensionAtBoot()` for the embedding adapter, and routes all errors through a single classifier in [src/cli/errors.ts](src/cli/errors.ts) so every failure exits with a stable code (R25: failures exit nonzero). Output mode is `text` by default; `--format json` at the root level toggles JSON for all subcommands. [architecture/registry.ts](architecture/registry.ts) is the authoritative list of every command with its metadata (R24); keep it in sync when the command surface changes.

**Task writes flow through one funnel (R2, R6).** `execos task` has been read-only since change-008; every task write is a `execos taskops` operation. Commands parse input, call exactly one service operation in [src/services/](src/services/), and format its receipt; services orchestrate transactions composing only [src/db/helpers/](src/db/helpers/) primitives; only the helpers write `tasks` rows. Each write operation carries hydrate and receipt templates under the taskops operational contract. Do not add a second write path anywhere — goal, memory, and resource writes are grandfathered under the `exceptions.md` R2 ratchet until goalops/memoryops exist.

**Layer map** (orientation only — the binding rules live in the constitution):

- `src/domain/` — pure functions (R1): validation, the tier-first prioritization engine with deterministic risk detection over hard deadlines and effort, status-transition matrix, intake parsing, dedup, retrieval. No DB imports, no I/O; `Settings` arrives as a parameter.
- `src/services/` — one service operation per business write; owns the transaction boundary for the task write funnel and the audit recording that goes with it (R12).
- `src/db/` — Drizzle schema ([src/db/schema.ts](src/db/schema.ts)) plus typed helpers under [src/db/helpers/](src/db/helpers/) for what the schema can't express (atomic status transitions, WIP-cap enforcement under `SELECT ... FOR UPDATE`, no-cycle assertion, audit-note inserts). `task_notes` is append-only (R10): every write routes through `appendTaskNote()`. Two clients: `db` (service-role, bypasses RLS) from [src/db/index.ts](src/db/index.ts) and the anon client from [src/db/anon-client.ts](src/db/anon-client.ts).
- `src/cli/adapters/` — repository interfaces (`taskRepo`, `goalRepo`, `memoryRepo`, `settingsLoader`, `clockProvider`, `embeddingAdapter`, `outputContext`) declared in [interfaces.ts](src/cli/adapters/interfaces.ts), with `production.ts` and `fakes.ts` implementations. Commands consume the seams; tests inject fakes.
- `src/cli/commands/` — Commander subcommand wiring. Commands resolve `Settings` once at startup (memoized in [settings-loader.ts](src/cli/settings-loader.ts)) and pass it explicitly into domain calls.
- `src/embeddings/` — centralized `embed()` adapter with provider-agnostic interface and a boot-time dimension check.
- `src/health/` — probe registry used by `execos health`.
- `src/web/` — SvelteKit dashboard. Reads through the anon client under RLS only (R3); the service-role client is forbidden here by ESLint and depcruise.

**Database design (R13, [decisions/008](architecture/decisions/008-drizzle-native-schema.md)).** Drizzle-native primitives + TypeScript-layer enforcement. No hand-written SQL migrations, no PL/pgSQL triggers. Constraints, RLS policies, sequences, and the two derived views (`v_recent_wins`, `v_eligible_for_prioritization`) live in [src/db/schema.ts](src/db/schema.ts); tasks carry first-class `hard_deadline` and `effort` columns (change-009). Postgres extensions (`vector`, `pg_trgm`) are enabled out-of-band via the Supabase dashboard; `scripts/check-postgres.cjs` verifies them.

## Svelte MCP — required workflow when editing `src/web/`

The project ships an MCP server at `@sveltejs/mcp` (configured in [.mcp.json](.mcp.json)) that gives you authoritative Svelte 5 + SvelteKit documentation and a static analyzer for generated `.svelte` code. The tools appear in this Codex session as `mcp__svelte__*`. **Use them — do not write Svelte 5 code from memory.** Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`, snippets, etc.) and SvelteKit 2 conventions (`+page.server.ts` load contracts, `$lib` aliases, `$env/static/private`) are recent enough that older training data is often wrong in subtle ways.

UI primitives come from `bits-ui` (R28, [decisions/022](architecture/decisions/022-bits-ui-component-library.md)): it is the only component library allowed in `src/web` — never install or import a second one (Melt UI, shadcn-svelte, etc.), and reach for the Bits primitive before hand-rolling positioning, dismissal, or focus management for a menu, dialog, popover, tooltip, combobox, or picker. Bits is headless, so all styling stays Tailwind under the R18–R21 visual vocabulary. When a Bits prop or behavior is uncertain, read the types under `node_modules/bits-ui/dist/` instead of guessing.

Required sequence whenever you touch a `.svelte`, `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+layout.server.ts`, `+server.ts`, `app.html`, `hooks.{server,client}.ts`, `svelte.config.js`, or `vite.config.ts` file:

1. **`list-sections`** first — scan the catalog for sections that match what you're about to do (e.g. "runes", "load functions", "form actions", "stores", "transitions").
2. **`get-documentation`** for every relevant section before generating code. Reading is cheap; getting runes wrong and shipping broken UI is not.
3. **`svelte-autofixer`** on every Svelte file you authored or modified, in a loop until it returns no issues. Treat unresolved findings as a blocker, not a warning.
4. **`playground-link`** is for sharing examples in conversation only. Never call it on code you wrote into project files — generating a link for in-tree code is meaningless and noisy.

Skip the MCP only for trivial mechanical edits (renaming a variable, deleting an unused import) where there is zero chance of triggering a runes/SvelteKit pitfall. When in doubt, call it.

## Tests — three app tiers plus the architecture gate

Three app tiers, three configs, three commands; the architecture suite is a fourth config run through `arch:check`. Do not collapse them.

- **Fast suite** ([vitest.config.ts](vitest.config.ts)) — runs on every push. ~30s budget. Setup file is [tests/setup-fast.ts](tests/setup-fast.ts). Excludes `tests/db/**`. **No concrete DB imports** allowed (`from "**/db/index.js"` and `resetDbData` are scanned for and rejected). All command tests in this tier use the fakes from [src/cli/adapters/fakes.ts](src/cli/adapters/fakes.ts).
- **DB suite** ([vitest.db.config.ts](vitest.db.config.ts)) — real Supabase Postgres. `fileParallelism: false` is required (the pyramid gate checks for it). Setup file is [tests/setup.ts](tests/setup.ts). Pre-Chunk-5.5 real-DB CLI tests under `tests/integration/db/cli/**` are **intentionally excluded** pending migration to fake-backed contract-tier tests; do not re-include them without that migration.
- **Migration suite** ([vitest.migration.config.ts](vitest.migration.config.ts)) — destructive roundtrip. Refuses to run unless `EXECOS_RUN_DESTRUCTIVE_DB_TESTS=1`, `EXECOS_ALLOW_DESTRUCTIVE_DB_TESTS=I_UNDERSTAND_THIS_WIPES_AN_ISOLATED_LOCAL_TEST_DATABASE`, and `EXECOS_DB_ENV=test` are all set and `DATABASE_URL` points at localhost. `npm run test:migration:local` is the supported entry; use a disposable database only.
- **Architecture suite** ([vitest.architecture.config.ts](vitest.architecture.config.ts)) — the constitution's conventions tests, behavioral goldens, and enforcement scans. Runs via `npm run arch:check` (paired with depcruise), not via `npm test`.

When adding tests:

- Pure domain logic and command behavior with fakes → fast suite (under `tests/domain/`, `tests/cli/`, `tests/contract/`, etc.).
- Anything that needs real Postgres (constraints, RLS, views, helper transactions, golden CLI flows) → DB suite under `tests/db/` or `tests/integration/db/cli-golden-flows.test.ts`.
- Migration up/down behavior → migration suite only.
- Constitution enforcement checks → `architecture/tests/`, only through the architecture-management skill's RATIFY procedure (sabotage demo required).

## Conventions specific to this repo

- **Test-only exports.** Symbols named `_*ForTest` (e.g. `_getRegisteredProbeForTest`, `_unregisterProbeForTest`) are blocked from being imported anywhere under `src/` by ESLint. They exist for `tests/**` only.
- **ESM imports.** TypeScript source uses explicit `.js` extensions on relative imports (`from "../db/index.js"`), required by NodeNext module resolution. Keep that style.
- **Settings flow.** Customizable behavior (intake keywords, staleness thresholds, etc.) lives in `app_settings` and is loaded once per process by [src/cli/settings-loader.ts](src/cli/settings-loader.ts). Domain functions take `Settings` as a parameter — they must not read it themselves.
- **Pool lifecycle.** Tests and short scripts must `await closeDb()` before exit; postgres-js will otherwise hold the process open.
- **Windows shell quirk.** `execos ...` and the bash-based gate scripts (`scripts/*.sh`) work fine in the Git Bash shell. Do not write compound `cmd.exe` one-liners with quoted paths containing spaces — they get mangled by the shell bridge.

## Context Management & Compaction Guidelines

When compacting the conversation or summarizing history due to context limits:

- **Prioritize State Over Chat:** Strip out all conversational fluff, polite filler, and historical debugging steps that have already been resolved.
- **Preserve Technical Debt:** Maintain an exact list of modified files, active architecture decisions, and current variables.
- **Maintain the Current Task:** Retain a precise, bulleted checklist of the immediate next programming steps.
- **Reference Existing Code:** Instead of repeating full code blocks in the summary, reference specific file paths and line ranges to save token space.
