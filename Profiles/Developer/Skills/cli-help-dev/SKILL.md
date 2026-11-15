---
name: cli-help-dev
description: >-
  Use at the start of a fresh or compacted developer session, before running an
  unfamiliar ExecOS CLI command, when flags are uncertain, or when Calvin asks
  what commands exist. Provides the compact command map for `execos`. Does
  NOT replace workflow skills such as tasks-dev, goal-dev, save-resource-dev,
  or review skills; use those for the actual workflow rules.
---

# Context

This is the compact CLI reference for ExecOS developer-profile
operation. It exists so the global prompt does not have to carry a full command
manual every turn.

Default developer invocation:

```bash
execos <command>
```

One `execos` binary serves every environment; a persisted target picks the
env file, and the launcher prints a colored banner naming the active target
(grey: development, red: live production, green: sandbox). Check or switch
with `npm run target:status`, `npm run target:dev`, or `npm run target:prod`;
`npm run sandbox` enters an isolated local sandbox.

For machine-readable output, global `--format` goes before the command:

```bash
execos --format json task list
```

Use this static map first. Do not run `--help` just because this skill loaded.
Run `execos <family> --help` or
`execos <family> <command> --help` only when the map below does
not cover the needed flag, the command surface seems stale, or a command failed.

# Command Map

`execos task` is read-only. Every task write goes through `execos taskops`;
those rows are contract-governed (hydrate and receipt templates under the
taskops operational contract), and hydrate-first is the write doctrine.

| Command | What It Does | Common Shape |
| --- | --- | --- |
| `task list` | List ALL open tasks by default (read-only, no row cap); add `--all` to include `done` and `cancelled`, `--limit <n>` to cap rows. Filters: `--status`, `--priority`, `--category`, `--goal`, `--due/--due-on/--due-by`, `--hard-deadline` (hard external commitments only), `--overdue` (due before today). Output includes hard_deadline, effort, and queue rank fields. | `--format json task list --hard-deadline` / `task list --overdue` |
| `task show` | Show one task with description and recent notes (read-only). | `task show KS-001` |
| `task dependency list` | List blockers and tasks blocked by a task (read-only). | `task dependency list KS-001` |
| `taskops hydrate` | Contract. Hydrate context and the operation prompt before any write; for create it previews duplicate matches. | `taskops hydrate --operation create --intent "..."` |
| `taskops hydrate` composed batch | Contract. One hydrate call returns the packets for up to 8 planned writes: repeat `--op` once per work order (`create:<intent>` or `<operation>:<task-id>[:<intent>]`); over 8 refuses (split into waves); do not mix `--op` with `--operation/--intent/--task-id`. | `taskops hydrate --op "create:..." --op "complete:KS-001" --op "delegate:KS-002:..."` |
| `taskops create` | Contract. Create task through the dedup-gated service (exact title/description match plus embedding similarity, open tasks only). Category and due date required; priority is explicit only, never inferred; `--allow-duplicate "<justification>"` overrides a duplicate refusal (justification mandatory, audited); `--hard-deadline` marks the due date as an external commitment; `--effort` records the size (`S`/`M`/`L`/`XL`). | `taskops create --title "..." -d "..." -c personal --due "tomorrow" --return-detail` |
| `taskops create` stdin text | Contract. Safer long task capture for generated text. | `taskops create --title "..." --description - -c business --due "next Thursday" --return-detail` |
| `taskops create` file text | Contract. Ingest preexisting text files. | `taskops create --title "..." --description-file desc.txt --note-file raw.txt -c business --due "next Thursday" --return-detail` |
| `taskops update` | Contract. Update task fields, including goal link (`--goal-id`) and unlink (`--clear-goal`). Non-terminal status only. `--effort`/`--clear-effort` revise or remove the estimate; `--hard-deadline true` or `--hard-deadline false` sets or clears the commitment marker. | `taskops update --task-id KS-001 --priority P1 --goal-id G-001` |
| `taskops complete` | Contract. Mark task done, requires confirmation flag. | `taskops complete --task-id KS-001 --yes` |
| `taskops cancel` | Contract. Mark task cancelled, requires confirmation flag. | `taskops cancel --task-id KS-001 --yes` |
| `taskops reopen` | Contract. Reopen a `done` or `cancelled` task to backlog, previous active status, or an explicit active status. | `taskops reopen --task-id KS-001 --to in_progress` |
| `taskops delegate` | Contract. Delegate a task to a team owner with follow-up date. | `taskops delegate --task-id KS-001 --owner noah --follow-up "next Wednesday"` |
| `taskops follow-up` | Contract. Record a delegate update and next follow-up. | `taskops follow-up --task-id KS-001 --update "50% done" --next "Friday"` |
| `taskops defer` | Contract. Snooze any open task or follow-up to resurface later. | `taskops defer --task-id KS-001 --until "next week"` |
| `taskops dependency-add` | Contract. Mark one task blocked by another (`--task-id` is an alias for `--blocked`). | `taskops dependency-add --blocked KS-002 --blocked-by KS-001` |
| `taskops dependency-remove` | Contract. Remove a task dependency edge. | `taskops dependency-remove --blocked KS-002 --blocked-by KS-001` |
| `taskops flag-attention` | Contract. Add Needs Attention flag. | `taskops flag-attention --task-id KS-001 --reason "blocked on Owen"` |
| `taskops unflag-attention` | Contract. Clear Needs Attention flag. | `taskops unflag-attention --task-id KS-001` |
| `taskops follow-ups` | Contract. Hydrate due follow-ups grouped by person. | `taskops follow-ups` |
| `taskops draft-follow-ups` | Contract. Hydrate grouped context for Slack follow-up drafts. | `taskops draft-follow-ups` |
| `taskops show` | Contract. Hydrate and show specific task details and memories. | `taskops show KS-001` |
| `taskops list` | Contract. Hydrate and show active tasks and goals. | `taskops list` |
| `taskops hydrate --operation re-rank` | Contract. Hydrate the re-rank packet: ranked do-next candidates, anomalies, risk sections, current queue. Optional `--intent` carries Jordan's situational context ("marketing is urgent today") and shapes the ranking. | `--format json taskops hydrate --operation re-rank --intent "..."` |
| `taskops re-rank` | Contract. Execute the re-rank: replace the agent do-next queue (1-5 repeatable tasks) or clear it with `--clear`. Run it in the same turn as the packet; do not stop after presenting the list. | `taskops re-rank --task KS-001 --why "high priority" --task KS-002 --why "important"` |
| `goal create` | Create quarterly goal. | `goal create "..." -q 2026-Q2 -d "..."` |
| `goal create` stdin text | Safer long goal description for generated text. | `goal create "..." -q 2026-Q2 -d -` |
| `goal update` | Edit goal title, description, or quarter. | `goal update G-001 --title "..."` |
| `goal close-achieved` | Close goal as achieved, requires confirmation flag. | `goal close-achieved G-001 --yes` |
| `goal close-dropped` | Close goal as dropped, requires confirmation flag. | `goal close-dropped G-001 --yes` |
| `goal list` | List/filter goals by status or quarter. | `goal list --status active --quarter 2026-Q2` |
| `goal show` | Show one goal and linked-task summary. | `goal show G-001` |
| `goal linked-tasks` | List every task linked to a goal. | `goal linked-tasks G-001 --status in_progress` |
| `review next` | Top prioritized eligible task with reasons and task detail in JSON. | `--format json review next` |
| `review morning` | Top five priorities, active goals, Needs Attention with task detail in JSON. | `--format json review morning` |
| `review refresh-attention` | Write refreshed dashboard Needs Attention flags. | `review refresh-attention --limit 3` |
| `review eod` | End-of-day closeout view with task descriptions in JSON. | `--format json review eod` |
| `review weekly` | Weekly review view with task descriptions in JSON. | `--format json review weekly` |
| `memory save` | Save scoped memory. | `memory save --scope clients/acme/topic --content - --applicability "..."` |
| `memory recall` | Search active memories. | `memory recall --query "..." --limit 5` |
| `memory list` | List memories by scope/state. | `memory list --scope clients/acme --state active` |
| `memory forget` | Soft-delete memory, requires confirmation flag. | `memory forget M-abc123 --yes` |
| `memory audit` | Audit memories under a required scope. | `memory audit --scope clients/acme` |
| `memory update` | Supersede memory with replacement content. | `memory update M-abc123 --content -` |
| `memory sync-to-notion` | Retry Notion sync for a memory. | `memory sync-to-notion M-abc123` |
| `resource add` | Upload document/resource, optionally link tasks. | `resource add "<path-to-file.pdf>" -c personal --task KS-001 --notes -` |
| `dashboard start` | Start or reuse local dashboard. | `dashboard start` |
| `dashboard stop` | Stop repo-owned dashboard process. | `dashboard stop` |
| `dashboard status` | Report whether the dashboard is serving. | `dashboard status` |
| `dashboard serve` | Run the dashboard server in the foreground (internal; `start` spawns it detached). | `dashboard serve --port 3737` |
| `health` | Run local health probes. | `health --strict` |

# Field Cheatsheet

- Categories: `client`, `business`, `product`, `house`, `personal`.
- Priorities: `P0`, `P1`, `P2`, `P3`.
- Effort sizes: `S` (under 1 hour), `M` (1 to 4 hours), `L` (half a day or
  more), `XL` (multi-day).
- Hard deadline: `--hard-deadline` on create marks the due date as an external
  commitment (L10, client, vendor, billing); on update pass `true` or `false`.
  Omit it when the date is only an ordering preference.
- Task statuses: `triage`, `backlog`, `in_progress`, `blocked`, `review`,
  `done`, `cancelled`.
- Goal statuses: `active`, `achieved`, `dropped`.
- IDs: tasks look like `KS-001`, goals like `G-001`, memories like `M-...`.
- Dates accept natural phrases such as `today`, `tomorrow`, `Friday at 3pm`,
  or `2026-05-21`.

# Gotchas

- Loading this skill should not add a shell round trip. Use the map first; run
  live help only when uncertain.
- Global `--format json` must come before the command: `execos
  --format json task list`.
- On Windows, do not pipe Bash output into PowerShell cmdlets. If using
  `Select-String`, `$variables`, or here-strings, use PowerShell for the whole
  command.
- Do not pack long pasted specs into a single shell argument. Prefer stdin
  with `-` for generated text; use `--*-file <path>` for preexisting files.
  Only one stdin-backed field can be used per command.
- CLI reference does not replace workflow policy. Use `tasks-dev` for task
  intake/reference-table rules, `goal-dev` for goal creation/update/closure,
  review skills for reviews, and resource skills for document filing.

# Final Verification

Before relying on a command, confirm:

1. The target banner (or `npm run target:status`) shows development or
   sandbox, not live production, before any mutating command.
2. Known commands used the static map without an unnecessary help call.
3. Any uncertain flag was checked with `--help`.
4. Any parsed multi-record output used `--format json` when practical.
