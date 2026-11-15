# Vocabulary

> **STATUS: RATIFIED — approved by Calvin on 2026-06-10.**
>
> All rules, decisions, and agent communication use these terms exactly.
> Consistent language is the point: one concept, one word.

## Domain vocabulary

- **Task** — the unit of tracked work, identified as `KS-###`. Has title, description, category, priority, status, due date, owner, optional goal link, and an embedding vector.
- **Goal** — a higher-level objective tasks link to via `--goal-id`.
- **Priority** — `P0`–`P3`, set only by an explicit flag, never inferred from text. Unset priority is null and rendered as "no value set".
- **Status** — the task lifecycle state; legal moves are defined by the status-transition matrix in `src/domain/status-transitions.ts`. `done` and `cancelled` are **terminal statuses** for ordinary operations; `taskops reopen` is the explicit restorative exit.
- **WIP cap** — the limit on concurrent `P0` tasks, enforced under row locks at promotion and creation.
- **Intake** — the structured capture flow for a new task (the 6-step checklist recorded in the intake audit note).
- **Duplicate gate** — the create-time check against open tasks only: normalized exact title/description matching plus embedded cosine similarity, refusing on any match. Matches carry evidence-tier dedup bands: `exact`, `near_identical` (>= 0.92), `similar` (>= 0.85 threshold); override requires `--allow-duplicate "<justification>"`.
- **Embedding** — the vector produced by `embed()` over title + description; powers the duplicate gate and retrieval.
- **Task note** — an append-only audit record in `task_notes`, written only via `appendTaskNote()`.
- **Activity** — the activity-log entry recorded alongside a mutation (e.g. `recordTaskCreated`, `recordTaskStatusChanged`).
- **Mutation** — any write to application data (create, update, complete, cancel, delegate, follow-up, defer, dependency or attention change).
- **Delegation** — assigning a task to a team owner (slug resolved from the roster), with follow-up bookkeeping.
- **Follow-up** — a dated check-in commitment on a delegated or waiting task.
- **Defer** — pushing a task out until a date.
- **Attention flag** — the "needs attention" marker set and cleared by the flag/unflag operations.
- **Operational contract** — `contract.yaml` plus hydrate and receipt templates for a command family (today: `taskops`), authored under the repo-root `OperationalContracts/` and loaded from there directly at runtime.
- **Hydrate / hydration packet** — the rendered pre-execution context an agent reads before running a write operation.
- **Receipt** — the structured result a service operation returns and the CLI renders after a write.
- **Profile** — a complete agent doctrine set under `Profiles/<Profile>/` (Developer, Production); the only authoritative copy of skills and system prompts.
- **Materialization** — `scripts/installer/materialize.mjs apply-profile` copying a profile to the repo root, `.claude/skills/`, and `.agents/skills/`. Materialized copies are generated output. Operational contracts are not materialized; they load directly from `OperationalContracts/`.
- **Dashboard** — the local SvelteKit read surface, discovered via its `/api/health` endpoint, loopback-only.
- **Memory** — stored observations/notes with embeddings, governed by memory-policy dedup bands.
- **Review** — the periodic maintenance flows under `daily review` (staleness, attention refresh, candidates).
- **Resource** — a saved document/file attached to the system via `execos resource add`.

## Architectural and design vocabulary

- **Layer** — one of the top-level `src/` divisions (`cli`, `db`, `domain`, `embeddings`, `services`, `web`) with directional import rules.
- **Services layer** — `src/services/`: the write-orchestration layer both the CLI and the web dispatcher call; owns transactions and composes db-helper primitives.
- **Interface** — everything a caller must know to use a module: signatures, semantics, error codes, refusal shapes.
- **Implementation** — everything behind the interface that a caller must not depend on.
- **Module** — a file or directory with one responsibility and one interface.
- **Seam** — where an interface lives; a place behavior can change without editing callers in place (e.g. the adapter interfaces in `src/cli/adapters/interfaces.ts`).
- **Adapter** — a seam implementation that translates between an interface and a concrete dependency (production vs fakes).
- **Deep module** — much behavior behind a small interface (e.g. `createTaskOperation`). The goal state.
- **Shallow module** — little behavior behind a wide interface; a complexity tax.
- **Leverage** — how much downstream work a single change in one place saves.
- **Locality** — the property that understanding or changing a behavior requires opening one place, not five.
- **Canonical path** — the single sanctioned route for a business operation (e.g. task writes: command → service → helpers).
- **Front door** — the surface users and agents are told to use; everything else is either plumbing or drift.
- **Mutation** — see domain vocabulary; architecturally, anything that must route through the canonical path.
- **Plumbing** — code that only moves data between layers without adding behavior; suspect under the deletion test.

### Design tests (applied during ratification and review)

- **Deletion test** — before introducing a new module or abstraction, imagine deleting it: if complexity just moves rather than concentrates, it is a pass-through and should not exist.
- **One name per operation** — a single business operation has exactly one name and one canonical path; the appearance of a second name for the same operation is drift.
