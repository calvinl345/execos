# ExecOS operations guide

This is the full install and operations manual from the original deployment. For an overview of the project, see the [README](../README.md).


ExecOS is a repo-local, AI-assisted operating system for tasks,
goals, documents, reviews, and a local dashboard. Jordan uses it by opening
Claude Code or Codex in the repo folder and talking to the agent. All
operational data lives in Supabase, so the same setup works from any machine
that has the repo cloned and configured.

> [!NOTE]
> **V1 is intentionally repo-local.** The installer publishes a lightweight
> `execos` command on PATH, but it points back to this cloned repo and loads
> this repo's env files. There is no separate bundled app install and no
> system-wide agent configuration. Everything Jordan owns lives in the cloned
> repo folder. The installer may also repair user-level `PATH` entries for
> third-party prerequisites such as GitHub CLI (`gh`).

---

## What this is

The repository ships four things side-by-side:

- **Application code** — a TypeScript CLI (`execos`) plus a local SvelteKit
dashboard.
- **Agent instructions** — `AGENTS.md`, `CLAUDE.md`, and an optional
`SOUL.md`, materialized from the active profile.
- **Skills** — short procedures the agent follows for common workflows
(tasks, dashboard, save-resource, and so on).
- **Setup scripts** — installer and profile-apply scripts under `scripts/`.

Day to day:

- **The agent** is the primary interface. Ask it to manage tasks, goals,
documents (resources), reviews, memory, and the dashboard.
- **The dashboard** is a local web app that renders the same data as a
board.
- **Supabase** is the database and file storage. Pointing a fresh clone at
the same Supabase project gives you the same ExecOS.

---

## Quick start


| Use case                          | Profile                  |
| --------------------------------- | ------------------------ |
| Normal day-to-day operation       | `production` *(default)* |
| Working on ExecOS itself | `developer`              |


> [!TIP]
> The installer infers the database environment from the profile.
> You almost never need to pass `-DbEnvironment` — that override is reserved
> for intentional mismatches during testing.
>
> Production database steps are explicit. A production install or update that
> runs Postgres checks, migrations, seed, and task embedding backfill must pass
> `-AllowProductionDatabaseChanges` on Windows or
> `--allow-production-database-changes` on Linux. Use `-SkipDatabase` /
> `--skip-database` when you only want to capture credentials or refresh code.

**Jump to setup:**

- [Install on Windows](#install-on-windows)
- [Install on Linux](#install-on-linux)

---

## Install on Windows

### 1. Install prerequisites

Git, GitHub CLI, and Node.js 20+:

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id OpenJS.NodeJS.LTS -e
git --version
gh --version
node --version
npm --version
```

### 2. Sign in to GitHub

Authenticate the GitHub CLI (used by the in-app issue reporter):

```powershell
gh auth login
```

Follow the browser prompts, then continue below.

### 3. Pick the path that matches your situation

**Fresh install** — clone and run the installer:

```powershell
git clone https://github.com/calvinl345/execos.git $HOME\execos
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -AllowProductionDatabaseChanges
```

Use `-SkipDatabase` instead of `-AllowProductionDatabaseChanges` if you are
only capturing credentials or rehearsing setup before clone verification.

**Update an existing checkout** — pull the latest changes and rebuild without re-entering credentials:

```powershell
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -SkipDatabase
```

Use `-AllowProductionDatabaseChanges` instead of `-SkipDatabase` when the
release intentionally mutates production data.

**Rerun setup only** — no code changes, just re-validate / refresh credentials:

```powershell
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -SkipDatabase
```

**Developer profile** — for working on ExecOS itself:

```powershell
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile developer
```

### 4. Optional installer flags

```powershell
# Keep full scrollback (no clear-screen between prompts)
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -NoClearScreen -SkipDatabase

# Skip database steps when iterating on installer behavior
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -SkipDatabase

# Rebuild/re-validate from existing .env without credential prompts
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -UseExistingCredentials -SkipDatabase

# Allow production database checks, migrations, seed, and embedding backfill after clone verification
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -AllowProductionDatabaseChanges

# Intentional profile/database mismatch for testing only
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile developer -DbEnvironment production -SkipDatabase
```

---

## Install on Linux

### 1. Install prerequisites

Sign in to GitHub:

```bash
sudo apt update && sudo apt install gh -y
gh auth login
```

Install Node.js 20+ and npm:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

The installer re-verifies the Node.js version and stops with a setup hint if
it's too old.

### 2. Pick the path that matches your situation

**Fresh install** — clone and run the installer:

```bash
git clone https://github.com/calvinl345/execos.git ~/execos
cd ~/execos
bash scripts/install.sh --allow-production-database-changes
```

Use `--skip-database` instead of `--allow-production-database-changes` if you
are only capturing credentials or rehearsing setup before clone verification.

**Update an existing checkout** — pull latest and rebuild without re-entering credentials:

```bash
cd ~/execos
bash scripts/update.sh --skip-database
```

Use `--allow-production-database-changes` instead of `--skip-database` when
the release intentionally mutates production data.

**Developer bootstrap** — `bootstrap.sh` can clone or update the repo and rerun the installer for developer installs. Production installs and updates should use `install.sh` / `update.sh` with the explicit acknowledgement flag:

```bash
EXECOS_PROFILE=developer bash scripts/bootstrap.sh
```

**Developer profile** — for working on ExecOS itself:

```bash
bash scripts/install.sh --profile developer
```

### 3. Optional installer flags

```bash
# Keep full scrollback
bash scripts/install.sh --no-clear-screen --skip-database

# Skip database steps while iterating on installer behavior
bash scripts/install.sh --skip-database

# Rebuild/re-validate from existing .env without credential prompts
bash scripts/install.sh --use-existing-credentials --skip-database

# Allow production database checks, migrations, seed, and embedding backfill after clone verification
bash scripts/install.sh --allow-production-database-changes

# Intentional profile/database mismatch for testing only
bash scripts/install.sh --profile developer --db-environment production --skip-database
```

> [!TIP]
> On WSL, clone into the Linux filesystem (e.g. `~/execos`).
> Running from `/mnt/c/...` works but is much slower, and Windows-built
> `node_modules` cannot be reused by Linux.

## What the installer does

> [!NOTE]
> The installer checks prerequisites, prompts for Supabase and OpenAI
> credentials, validates them through a temporary gitignored env file, then
> runs dependency install, TypeScript build, dashboard web build, database
> check, migrations, seed, strict task embedding backfill, a CLI health
> check, and `npm link` so `execos ...` works from a fresh shell.
>
> Only after those checks pass does it back up and write the final env file,
> then materialize the selected agent profile. If setup fails, generated agent
> prompts stay in an "installation incomplete" state and tell agents to ask you
> to rerun the installer. Linux also keeps a local gitignored partial retry
> cache so reruns can reuse values that already passed validation.

---

## First things to try

Open the agent in the repo folder and try saying:

**See your day**

- "Open my dashboard."
- "Show me what needs attention."

**Capture and plan**

- "Add a task to follow up with Sarah tomorrow."
- "Upload this document to the dashboard."
- "Create a goal for improving my follow-up process."

**Review**

- "Run my daily review."
- "Start my weekly review."

**Feedback**

- "Report a problem."

The agent reads those as intent and follows the skills the install profile
materialized — you don't need to type CLI flags by hand.

---

## Daily use

1. Open a terminal **or** open Claude Code or Codex with this folder as the
  workspace.
2. Talk to the agent about tasks, goals, documents, reviews, memory, or the
  dashboard.
3. The agent will use the materialized `AGENTS.md`, `CLAUDE.md`, and skills
  from your install profile.

> [!IMPORTANT]
> Conversation with the agent is the default path. The CLI below is the
> escape hatch — useful as a reference, useful when something is wrong, but
> not where day-to-day usage lives.

The CLI is always available:

```powershell
cd $HOME\execos
execos task list
execos review morning
execos review weekly
execos dashboard start
execos health
```

There is one `execos` command. Which database it talks to is decided by a
persisted target, not by separate binaries: the installer sets the target to
match the profile, and every invocation prints a colored banner naming the
active target (grey for development, red for live production, green for
sandbox). Inspect or switch it with:

```powershell
npm run target:status
npm run target:dev
npm run target:prod
npm run sandbox        # isolated local sandbox copy for safe experiments
npm run sandbox:stop
```

## Dashboard

```powershell
execos dashboard start
```

- **URL:** `http://localhost:3737` by default. Override with
`DASHBOARD_PORT` or `EXECOS_DASHBOARD_PORT` in your env file.
- **What it shows:** tasks, goals, and uploaded documents/resources — the
same data the CLI works with.
- **How it runs:** the Node server and browser are local; reads and writes
go through Supabase. Dashboard data reads use the anon key under Row
Level Security. Private document downloads are served through short-lived
signed URLs created server-side; the service-role key never goes to the
browser. The dashboard remains read-only relative to the service-role CLI.

To stop or recover:

```powershell
execos dashboard stop
execos dashboard stop --force
```

> [!TIP]
> The dashboard is single-instance. A second `dashboard start` detects the
> running process, reuses the existing URL, and opens your browser to it
> instead of starting a duplicate.

---

## Tasks and goals

- **Tasks** can be created, updated, completed, reprioritized, and
inspected through conversation. They carry priority, owner, due dates,
effort estimates (`S`/`M`/`L`/`XL`), goal links, and related metadata that
the agent and CLI expose. Extra context belongs in descriptions and notes.
- **Due dates are required for new tasks.** If Jordan does not provide one,
the agent should infer a sensible date from urgency, effort, dependencies,
and when the task could reasonably be completed.
- **Hard deadlines are distinct from ordering preferences.** When an
external party holds Jordan accountable on a date (an L10 commitment, a
client promise, a vendor cutoff, billing), the task is marked as a hard
deadline and prioritization treats it as a commitment at risk as the date
nears. The agent asks when it is ambiguous.
- **A task can belong to at most one goal** (optional).
- **Goals** are first-class records, with a quarter label among their
fields. You create, refine, and close them by talking to the agent the
same way you manage tasks.

The exact field model lives in code; you don't need the schema to use the
system day to day.

Useful task CLI reference. `execos task` is read-only; every task write goes
through the `execos taskops` operations:

```powershell
execos taskops create --title "Follow up with Sarah" -d "Check on next steps after the handoff." -c business --due "tomorrow"
execos task list --due "tomorrow"
execos task list --due-on "Friday"
execos task list --due-by "2026-05-20"
```

For long or multiline text, stream generated content through stdin with `-`
instead of fighting shell quoting:

```powershell
@'
Long description with URLs, bullets, and line breaks.
'@ | execos taskops update --task-id KS-007 --description -
```

## Documents

- Hand the agent a **local file path** and ask it to save or upload the
document.
- The `execos resource` command uploads the file to the private Supabase
Storage bucket and records its metadata in Postgres.
- The dashboard can list and download those documents. Downloads use
short-lived signed URLs, so a link is generated when the page or task drawer
loads.

```powershell
execos resource add "C:\path\to\file.pdf" -c personal --task KS-123
```

The save-resource skill defines categories and guardrails. The agent
should confirm the destination and category before uploading.

## Reviews

Most review views are read-only. `review morning`, `review eod`,
`review weekly`, and `review next` report current state without changing the
task audit trail. `review refresh-attention` is the exception: it updates the
task-level Needs Attention flags that the review views surface.


| Cadence             | Purpose                                                               | Typical agent ask                                         | CLI                                                                               |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Daily (morning)** | Top prioritized work, active goals, needs-attention list              | "Run my morning review" / "What should I focus on?"       | `execos review morning`                                                |
| **Daily (close)**   | What moved, what stalled, tomorrow's top picks                        | "Run my end-of-day review"                                | `execos review eod`                                                    |
| **Weekly**          | What shipped, what's at risk, goal summary, suggested next-week focus | "Start my weekly review"                                  | `execos review weekly`                                                 |
| **Quarterly**       | Reviewed through goals, since each goal carries a quarter label       | "What are my active quarterly goals?" / "Plan my quarter" | Use goal conversations; `review morning` and `review weekly` surface goal context |


There's also a single-task view: `execos review next` returns
the top-prioritized task with a one-line reason.

To refresh the task-level Needs Attention flags:

```powershell
execos review refresh-attention --limit 3
```

---

## Reporting problems

When something is wrong, tell the agent **"Report a problem"** (or just
describe the bug in your own words).

The agent should:

1. Ask a few clarifying questions.
2. Restate the issue in one short paragraph.
3. Confirm that summary with you.
4. Produce a Slack-ready message for Calvin using the template below.

```text
Summary:
(one line)

Expected:
...

Actual:
...

Steps to reproduce:
1. ...
2. ...

Environment:
- OS:
- Repo path / machine:
- Profile (production vs developer), if known:

Command or workflow:
- ...

Attachments:
- Screenshot, log snippet, or error text (paste or describe)
```

> [!CAUTION]
> Do not paste live Supabase keys, database URLs with passwords, or any
> other credentials into Slack or chat.

## Updating

After Calvin pushes fixes, the simplest path is to run the updater:

```powershell
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -SkipDatabase
```

The updater pulls the latest code, reuses the existing `.env.production.local`
without credential prompts, stops the checkout's recorded dashboard process,
rebuilds the CLI and dashboard, runs `health`, and starts the dashboard again.
Use this code-only update path when database credentials are being captured,
when clone rehearsal has not passed yet, or when the release has no database
changes.

When the production database should actually be mutated, make the acknowledgement
explicit:

```powershell
cd $HOME\execos
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -AllowProductionDatabaseChanges
```

Production database steps are fail-closed. Without
`-AllowProductionDatabaseChanges`, the installer refuses to run production
checks, migrations, seed, or embedding backfill. With the flag, the updater reuses
`.env.production.local`, pulls the latest code, rebuilds, checks Postgres and
required extensions, applies pending migrations with a pre-migration backup,
seeds app settings, backfills missing task embeddings in strict mode, runs
`health`, and starts the dashboard again.

### Production database rollout

For a new or newly separated production Supabase project, use this sequence:

1. Capture credentials without touching the database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -DbEnvironment production -SkipDatabase
```

This writes `.env.production.local` and validates the non-database setup, but
does not run Postgres checks, migrations, or seed.

2. Start the local Supabase stack, then clone production-shaped data into local
and activate sandbox mode:

```powershell
npx supabase start
npm run target:prod
npm run sandbox:start
```

The sandbox command reads from `.env.production.local`, writes only to the
local Supabase stack, writes `.env.local.local`, and verifies row counts.

3. Verify pending migrations against the local clone:

```powershell
npm run db:verify-migration
```

This applies pending migrations only to the local stack and fails if tables,
columns, or rows are lost.

4. Rehearse the install-time task embedding backfill against the local clone:

```powershell
node scripts/run-with-env.cjs .env.local.local node --import=tsx scripts/backfill-task-embeddings.ts --strict
```

Optional SQL check in local Supabase Studio:

```sql
select count(*) as open_null_embeddings
from tasks
where status not in ('done', 'cancelled')
  and embedding is null;
```

The expected result is `0`.

5. After clone verification passes, run the production database update:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -AllowProductionDatabaseChanges
```

Manual update path (only if you know what changed)

```powershell
npm ci
npm run build
npm run build:web
npm run db:migrate:prod
npm run db:seed:prod
node scripts/run-with-env.cjs .env.production.local node --import=tsx scripts/backfill-task-embeddings.ts --strict
execos health
```

Restart the agent or IDE window only when prompts or skills changed and the
tool is holding a cached copy.

---

## Profiles and environments

There are two independent knobs:


| Knob                                                  | Controls                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile** (`-Profile`, or `apply-profile.ps1`)      | Which agent prompts and skills are copied into the repo (`Production` or `Developer`).                                                                            |
| **Database environment** (`-DbEnvironment`, optional) | Which gitignored Supabase env file is written (`.env.production.local` vs `.env.development.local`) and which environment-specific CLI/database commands the installer runs. |


If you omit `-DbEnvironment`, the installer infers it from the profile:

- `production` profile → `production` database environment.
- `developer` profile → `development` database environment.

Normal Jordan use is **production profile + production database**.

### Installer defaults


| Command                                    | Profile    | Env file                 | Default target |
| ------------------------------------------ | ---------- | ------------------------ | -------------- |
| `.\scripts\install.ps1`                    | Production | `.env.production.local`  | `production`   |
| `.\scripts\install.ps1 -Profile developer` | Developer  | `.env.development.local` | `development`  |


Rare overrides

Only when you intentionally want a mismatch — for example, exercising
production prompts against a dev database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -DbEnvironment development

# Dangerous: developer prompts against production data
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile developer -DbEnvironment production -SkipDatabase
```

### Credentials the installer collects

Only the credentials Jordan itself needs for the selected database
environment:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `OPENAI_API_KEY` *(embeddings and memory retrieval)*

MCP credentials for Slack, Notion, calendar tools, and similar are
configured in the **agent harness**, not by this installer. The repo's
`.mcp.json` currently wires only the Svelte MCP, used by Claude/Codex
when editing SvelteKit files.

> [!WARNING]
> Destructive automated tests use `.env.test.local` (created from
> `.env.test.example`). Do not point that file at a hosted production
> project.

## Profile source files

The source of truth lives under `Profiles/`:

- `Profiles/Production/System Prompts/` — production `AGENTS.md`,
`CLAUDE.md`, optional `SOUL.md`.
- `Profiles/Production/Skills/` — production skills (suffix `-prod`).
- `Profiles/Developer/System Prompts/` — developer `AGENTS.md`,
`CLAUDE.md`.
- `Profiles/Developer/Skills/` — developer skills (suffix `-dev`).

Applying a profile materializes those files into the repo's active
locations:

- `AGENTS.md`, `CLAUDE.md`, optional `SOUL.md`
- `.agents/skills/`
- `.claude/skills/`

The materialized files are install output and are gitignored. _Edit
under `Profiles/`_, then re-apply:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-profile.ps1 -Profile production
powershell -ExecutionPolicy Bypass -File .\scripts\apply-profile.ps1 -Profile developer
```

Cross-platform:

```bash
node scripts/installer/materialize.mjs apply-profile --profile production
node scripts/installer/materialize.mjs apply-profile --profile developer
```

---

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

**Test tiers** (`AGENTS.md` and `CLAUDE.md` carry the full policy):


| Command                        | Tier      | Notes                                                                                                                                                                            |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                     | Fast      | No real database. CI default; ~30s budget.                                                                                                                                       |
| `npm run test:db`              | DB        | Refuses by default until a local DB test env is configured.                                                                                                                      |
| `npm run test:db:local`        | DB        | Local harness only: loads `.env.test.local`, refuses non-local targets, enables local test DB extensions, migrates the local DB, runs the DB suite, then resets local test data. |
| `npm run test:migration:local` | Migration | Local harness only: destructive roundtrip against disposable local DB infrastructure, with schema restore/data reset afterward.                                                  |
| `npm run test:all`             | Combined  | Fast suite plus the migration-gate meta test.                                                                                                                                    |
| `npm run arch:check`           | Architecture | Governance gate: dependency-cruiser import rules plus the architecture test suite (constitution checks). Required green before work is done.                                  |
| `npm run arch:check:fast`      | Architecture | Dependency-cruiser import rules only.                                                                                                                                          |


Create `.env.test.local` once from `.env.test.example` using values from
`supabase status` after `supabase start`. Never copy hosted Supabase project
keys or hosted Postgres URLs into `.env.test.local`.

Hygiene gates (also run in CI)

```bash
npm run test:check-pyramid
npm run test:check-imports
npm run test:check-fast-reset
npm run test:check-fast-budget
```

### Architecture and governance

Architectural rules are ratified in
[architecture/constitution.md](../architecture/constitution.md) and are binding;
every rule names the check that enforces it, and the reasoning lives in
[architecture/decisions/](../architecture/decisions/). Every CLI command is
registered with its metadata in
[architecture/registry.ts](../architecture/registry.ts). `npm run arch:check`
runs the whole enforcement layer locally, and CI runs it on every push
(`.github/workflows/arch-check.yml`). Rules enter, change, or leave only by
Calvin's explicit decision; never weaken or disable a check to get green.

## Maintainer notes

- **Package manager:** npm only (`package-lock.json`). Do not use pnpm or
yarn.
- **Architecture governance:** the constitution under `architecture/` is
binding. Run `npm run arch:check` before declaring any change done.
- **Secrets:** `.env`, `.env*local`, env backups, `node_modules/`,
`dist/`, `.svelte-kit/`, and `.cache/` are gitignored. Never commit
credentials or paste them into chat.
- **Append-only audit:** `task_notes` is append-only in application code.
All writes must go through `appendTaskNote()`.
- **Dashboard data path:** dashboard table reads use the Supabase anon key
and RLS. Private Storage downloads use server-side signed URLs minted with
the service-role key, but the dashboard still performs no database writes.
- **Embeddings:** memory features require a valid `OPENAI_API_KEY` in the
env file.

## Current status

**Working today**

- TypeScript CLI for `task` (read-only), `taskops` (the contract-governed
task write surface), `goal`, `memory`, `review`, `resource`, `health`, and
`dashboard`, behind one launcher with a persisted target (development,
production, or sandbox).
- Task prioritization with hard deadlines (external commitments) and effort
estimates.
- A ratified architecture constitution with mechanical enforcement
(`npm run arch:check`, enforced in CI).
- Supabase Postgres schema, Drizzle migrations, seed script, and health
probes.
- Local SvelteKit dashboard with a single-instance launcher on Windows,
macOS, and Linux.
- Windows installer (`scripts/install.ps1`) and Linux installer
(`scripts/install.sh`), both with profile materialization, live
log streaming, an elapsed-time heartbeat, and a step progress bar.
- Repository MCP config for Svelte assistant tooling (`.mcp.json`).

**Not yet**

- Calendar and external-connector enrichment paths referenced in review
code, which remain placeholders until the corresponding MCP integrations
are present in your agent environment.

