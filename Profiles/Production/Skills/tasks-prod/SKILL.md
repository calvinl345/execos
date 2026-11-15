---
name: tasks-prod
description: >-
  Use when the user wants to create, update, complete, cancel, list, or
  organize tasks in ExecOS. Triggers on phrases like 'add a task',
  'I need to ...', 'remember to ...', 'log that ...', 'track that', 'mark
  KS-### done', 'move KS-### to in_progress', 'flag KS-### for attention',
  'show my tasks', 'what is KS-###', 'what is due tomorrow', 'what tasks are
  due today', 'tell me about the task due Friday', 'delegate KS-###',
  'follow up on KS-###', 'defer KS-###', 'draft my follow-ups'. Wraps the `execos task` and `execos taskops` CLIs and
  enforces scope-lock rules - 6-step intake on every new task, explicit
  confirmation before terminal status, owner-to-team resolution, and the
  AC-073 P0 WIP cap proactive-options UX. Does NOT handle goals, reviews,
  memory, documents, email triage, or dashboard launching - separate skills
  cover those.
---

# Context

This skill drives task management in ExecOS through the `execos task`
and `execos taskops` CLIs. The CLI enforces invariants at the database layer
(status transition matrix, P0 WIP cap, append-only `task_notes`, no circular
dependencies, ID composition, audit notes). The skill enforces the
conversational rules the database can't see: intake checklist, terminal-status
confirmation, owner-to-team resolution, follow-up lifecycle judgment, and the
WIP cap proactive-options UX.

**Always go through the CLI.** Never propose direct SQL or write to the schema
directly. The CLI is the only path that produces the right notes, IDs, follow-up
activity, and audit trail. This is the "invariants in tools, judgment in
skills" split (CC-001).

**All task writes go through `execos taskops <operation>`.** `execos task` is
read-only (`list`, `show`, `dependency list`); the old `task` write
subcommands are removed and print a pointer to the `taskops` replacement.
Hydrate first: run `execos taskops hydrate --operation <op>` before a write so
the packet supplies current state, and so create previews likely duplicates.

# Workflow

Track your progress through this workflow. Identify the user's intent, then jump to the matching branch. Most turns hit exactly one branch.

1. **Recognize intent.** Match the user's phrasing against the branches in [Action Routing](#action-routing). If two branches both plausibly match, ask one clarifying question rather than guessing.
2. **Run the matching branch.** Each branch spells out the exact
   `execos taskops ...` write or `execos task ...` read invocation, the conversational
   rules to enforce, and any pre-flight (intake checklist, owner resolution,
   follow-up defaulting, confirmation prompt).
3. **Handle CLI errors.** If the CLI exits non-zero, route through [Error Handling](#error-handling). The P0 WIP cap is the most consequential — present the four AC-073 options verbatim, never silently auto-downgrade.
4. **Confirm with an Action Ledger.** When a write receipt is present, lead
   with one checklist line per receipt in execution order. Quote the user's
   triggering statement for completions, cancellations, and delegations. If
   you show a task table after the ledger, include only tasks mutated this
   turn.

# Reference

## Action Routing

### Create a task

Triggers: "add a task", "I need to ...", "remember to ...", "log that ...", "track that"

Run the **6-step intake checklist** before invoking the CLI. The checklist is your internal process, not a script of questions: make reasonable default assumptions, infer each field from context and the heuristics here, proceed directly to the create, and present the completed receipt so Jordan can correct anything wrong. At most one interrupt survives intake: genuine uncertainty on a duplicate, per the duplicate judgment rules below. The CLI writes an `intake_checklist_completed` note from the values you pass, so missing fields means a missing note:

1. **Title** — short imperative phrase from the user's words.
2. **Description** — at least one complete, informative sentence capturing all context and details the user provided. If the user gave only a title, infer the intent from conversation context and write the sentence yourself; flag the inference in the receipt.
3. **Category** — infer from context (`client`, `business`, `product`, `house`, `personal`). Cannot be null; fall back to `personal` and call out the ambiguity in the description.
4. **Priority** — explicit-only. Set `--priority` only from Jordan's expressed priority intent, never from the task's type, the client, or how urgent the subject sounds. No priority language: omit it (the task stays unprioritized under `triage`). Jordan names a tier (P0/P1/P2/P3): use it. Jordan expresses priority without a tier: map conservatively: "high priority" / "important" / "urgent" / "a priority" to at least P1; "critical" / "very urgent" / "now" / "emergency" to P0 (subject to the P0 WIP-cap confirmation). When unsure, leave it off; don't fabricate a priority to look thorough.
5. **Due date** — if Jordan gave any due signal ("Friday", "next week", "before the call"), pass it via `--due "..."` (the CLI parses in the host time zone; honor an explicit date even if it lands on a weekend). If there is no due signal at all, omit `--due`: the CLI defaults the due date to 3 business days out (weekend-avoiding) and emits a defaulted-due warning; surface that note in the receipt so Jordan can adjust. Any due date you choose yourself that would land on a weekend rolls forward to the next business day. Then the hard-deadline question: pass `--hard-deadline` when EITHER (a) Jordan explicitly calls it a hard deadline or identifies it as an L10 task, OR (b) Jordan names a specific date on which an external third party imposes a concrete consequence (account suspension, late fee, filing window closing, contract lapse). The test for (b) is a real outside actor plus a dated enforced consequence: "AWS suspends the account Friday" qualifies, while "the client is furious", "this is important", or "I need to get to it soon" do not. Never infer it from a client/vendor/billing relationship alone, internal importance, or urgency with no dated third-party consequence. A defaulted or agent-chosen due date is always soft.
6. **Goal link / owner** — if a goal or quarterly initiative is mentioned, propose `--goal-id G-NNN`. Owner is set only by delegation: `taskops create` refuses any `--owner` other than `me` (or omitted). If a teammate is named as the doer, create the task owned by me first, then run `execos taskops delegate` per [Delegate, follow up, or defer](#delegate-follow-up-or-defer); the delegate operation resolves the owner against the team roster and sets the follow-up date.

**Effort estimate.** Alongside the due date, propose an effort size and pass it via `--effort`: `S` is under 1 hour, `M` is 1 to 4 hours, `L` is half a day or more, `XL` is multi-day. If the work looks `XL`, propose splitting it into smaller tasks before creating anything. On updates, `--effort` revises the estimate and `--clear-effort` removes a stale one.

Then hydrate. The create hydration packet previews likely duplicate matches
against open tasks before anything is written:

```
execos taskops hydrate --operation create --intent "<one-line task summary>"
```

**Duplicate judgment is yours, not the embedding's.** The packet's embedding
matches are a fallback signal, never the verdict. Read the packet's Active
Tasks list and judge for yourself whether the new task already exists, even
when zero embedding matches come back — embeddings miss reworded, partially
overlapping, or umbrella tasks. Run `execos task show KS-NNN` on any suspected
duplicate so you compare real fields, not just titles.

Then invoke the write. Short titles can be positional, but `--title` is also
supported and is safer for shell-variable based calls:

```
execos taskops create --title "<title>" -d "<description>" \
  [-p P1|P2|P3] -c <category> --due "<phrase>" [--hard-deadline] \
  [--effort S|M|L|XL] [-s triage|backlog|in_progress|blocked|review] \
  [--goal-id G-NNN] [--note "<context>"] [--return-detail]
```

The CLI never infers priority, and neither should you from the task's subject.
Set `--priority` only from Jordan's expressed priority intent (see intake step 4
for the conservative tier mapping), state the call in the receipt, and otherwise
leave it off. `--due` is optional: pass Jordan's signal when there is one,
otherwise omit it and the CLI defaults the due date to 3 business days out (soft)
and flags it.

The duplicate gate refuses on any match and reports evidence tiers, not
instructions: `exact` (normalized exact title or description match, with
`matched_on`), `near_identical` (similarity >= 0.92), `similar` (similarity
>= 0.85). You own the decision. An obvious duplicate: do not create and do
not ask — act on the existing task and report the call in the receipt
summary. Obviously new work the gate refused anyway (recurring instance,
deliberate twin): re-run with `--allow-duplicate "<justification>"` — the
justification is mandatory, non-empty, audited, and surfaced in the receipt.
Only when genuinely uncertain, consult Jordan with a **rich side-by-side
comparison** — the existing task's title, description, and key metadata
(status, due date, owner, category) next to the proposed task's title,
description, and intended fields — never a bare ID.

Prefer `--return-detail` for agent-created tasks so the create call returns the
full task record and recent notes. Echo back the returned `KS-###` with the
captured fields. The agent does not invent IDs.

New tasks default to `triage`. `taskops create --status ...` only accepts
non-terminal starting states. To close a task immediately after creation,
create it first, then use `taskops complete --task-id KS-NNN --yes` or
`taskops cancel --task-id KS-NNN --yes` after explicit confirmation.

For long or multiline user input, do not paste the full body into one shell
argument. Use a concise description and preserve the raw context as an initial
note. Prefer stdin (`--description -` or `--note -`) for agent-generated text,
and reserve `--description-file <path>` / `--note-file <path>` for preexisting
files the user asked you to ingest. Only one stdin-backed field can be used per
CLI command.

**Batch the round trips.** When a single user message implies multiple
operations — several new tasks, or a mix of creates, updates, and other writes
across one or many tasks — do not run a hydrate/write/receipt cycle per
operation. Run **one composed hydrate** (`taskops hydrate --op ...`, see
Batched Writes below) to get every packet in a single call, apply the intake
checklist internally across the whole set, then run all the write commands in
**one chained shell invocation** (separate commands with `;`, never `&&`), and
close with a single consolidated Action Ledger covering every operation. No
per-task question rounds; assumptions go in the receipt. Mention deliberately
skipped items as `No action:` lines after the ledger.

**Every item ends the turn dispositioned.** Before hydrating a multi-item message, enumerate every distinct ask in it. Each item must end the turn in exactly one state: executed (covered by a receipt and a ledger line), asked about (one focused question), or declined with a one-line `No action:` reason. The consolidated ledger accounts for every item; an item that silently drops, or stalls in "pending confirmation" while the rest of the batch proceeds, is a defect. Explicit completions and cancellations belong in the same composed batch as `complete:KS-NNN` / `cancel:KS-NNN` ops.

**L10 pattern.** "These are from my L10" (or similar) means each task is due by
the next L10 date with a hard deadline: recall the next L10 date from memory
(`execos memory recall --query "next L10 date"`), pass it via `--due`, and set
`--hard-deadline`. If the next L10 date is not on file, infer the most
plausible date from context and flag the assumption in the receipt.

### Update fields

Triggers: "rename KS-NNN", "change priority of KS-NNN", "move KS-NNN to in_progress"

If the new status is **`done` or `cancelled`**, jump to [Closing a task](#closing-a-task) instead — those need explicit confirmation.

If the change is **giving the task to a teammate** ("set KS-NNN's owner to Owen"), jump to [Delegate, follow up, or defer](#delegate-follow-up-or-defer) — `taskops update` refuses any `--owner` other than `me` and points at `taskops delegate`.

Otherwise:

```
execos taskops update --task-id KS-NNN \
  [--title "..."] [--description "..."] \
  [--priority Px] [--status <status>] \
  [--due "..."] [--hard-deadline] \
  [--effort S|M|L|XL | --clear-effort] [--goal-id G-NNN | --clear-goal]
```

`--status` here accepts non-terminal statuses only; terminal moves go through
`taskops complete` / `taskops cancel`. For non-obvious updates, hydrate first:
`execos taskops hydrate --operation update --task-id KS-NNN --intent "<what is changing>"`.

If the task already has a due date, ordinary updates can leave it unchanged. If it has no due date, include `--due "..."` with the update. Do not use `--clear-due`; the CLI rejects due-date removal.

Status transitions are checked against the [Status Cheatsheet](#status-cheatsheet). Each transition writes an automatic `note_type='status_change'` row with `{from, to, by, at}` (AC-074) — do not also append a manual note describing the same transition.

### Delegate, follow up, or defer

Triggers: "delegate KS-NNN to Elena", "follow up with Sam next week",
"Elena says this is 50% done", "defer KS-NNN until Friday", "snooze this",
"what follow-ups are due", "draft my follow-ups"

Use `execos taskops` for the follow-up lifecycle. Ordinary field edits stay on
`execos taskops update`; do not fold follow-up behavior into it.

**Delegate.** Run hydration first when the user is asking the agent to decide
or infer anything:

```
execos taskops hydrate --operation delegate --task-id KS-NNN --intent "delegate to <person>"
```

Resolve the owner to a real `team.slug` using [Owner Resolution](#owner-resolution).
If no follow-up date is given, choose the default yourself: midpoint between
today and the due date; if that is less than about two days away, tomorrow; if
there is no due date, one week out. Do not stop to confirm that default. The
receipt shows the chosen follow-up date so Jordan can correct it.

Then invoke:

```
execos taskops delegate --task-id KS-NNN --owner <slug> \
  [--follow-up "..."] [--due "..."] [--notes "..."]
```

If the chosen follow-up date is after the work due date, surface the warning and
ask whether to move the due date. That date conflict is the exception to the
"act with receipt" default.

**Record a follow-up result.** Use this when Jordan relays what the delegate
said. The update text is required and becomes an append-only task note.

```
execos taskops hydrate --operation follow-up --task-id KS-NNN --intent "<what they said>"
execos taskops follow-up --task-id KS-NNN --update "<what they said>" \
  --next "<next follow-up date>" [--due "..."] [--status backlog|in_progress|blocked|review|done|cancelled]
```

If the status is `done` or `cancelled`, apply [Closing a task](#closing-a-task)
first and get explicit confirmation in this turn.

**Defer or snooze.** This is a mechanical resurface-date write and can be called
directly for delegated and non-delegated tasks:

```
execos taskops defer --task-id KS-NNN --until "<date>"
```

The same `follow_up_date` field is used for delegated follow-ups and ordinary
snoozed tasks. Deferring does not change the task's normal status.

**List or draft follow-ups.** These are read/hydrate operations:

```
execos taskops follow-ups
execos taskops draft-follow-ups
```

`follow-ups` returns due or overdue surfaced items grouped by owner. Delegated
items should be framed as "follow up with <person>"; owner `me` items are
snoozed tasks. `draft-follow-ups` gives per-person context blocks. Write fresh,
short, friendly-professional draft text from that context; do not send Slack or
email from this skill.

## Due Date Heuristics

Honor Jordan's due signal; do not fabricate one from the task's nature.

- Jordan gave a due signal ("Friday", "next week", "before the call"): use it. Honor an explicit date even if it lands on a weekend; an explicit date is Jordan's call.
- No due signal at all: omit `--due`. The CLI defaults the due date to 3 business days out (weekend-avoiding), emits a defaulted-due warning, and the task still surfaces in the queue. Flag the defaulted date in the receipt so Jordan can adjust.
- Any due date you pick yourself (not the CLI default) that would land on a Saturday or Sunday rolls forward to the next business day; Jordan does not work weekends.

A defaulted or agent-chosen due date is always soft (never `--hard-deadline` on its own; the hard-deadline decision is separate, per the intake hard-deadline criteria). When the task waits on someone else and Jordan gave a check-in signal, use that check-in point rather than the final desired outcome.

### Closing a task

Triggers: "mark KS-NNN done", "I shipped KS-NNN", "kill KS-NNN", "cancel KS-NNN"

1. **Confirmation is two-tier (AC-004).**
   - **Explicit tier**: if the user explicitly stated the task is done or should be cancelled — first person, unambiguous task reference, completed or decided action ("I already went shopping, so that's done", "mark KS-217 done", "I shipped the header fix", "kill KS-301") — that statement IS the confirmation. Invoke the CLI in this same turn without asking again, then offer note capture in the receipt afterward ("Marked done. Anything worth a note?"). Asking "are you sure?" after an explicit statement is a defect, not diligence.
   - **Inferred tier**: if completion is deduced or ambiguous — indirect evidence, an unclear task referent, partial-completion language ("mostly done", "almost wrapped"), or your own inference from context — ask first: *"Mark KS-NNN done? Anything to capture in notes?"* (or "...cancelled — what's the reason?") and invoke only after the user confirms. Do not skip this tier's question.
2. Capture any user-supplied note text and pass it via `--note "..."` so it lands alongside the automatic `status_change` row.
3. Invoke. `--yes` is required on both; it asserts that the user confirmed in
   this turn:
   - Done: `execos taskops complete --task-id KS-NNN --yes [--note "..."]`
   - Cancelled: `execos taskops cancel --task-id KS-NNN --yes [--note "reason"]`
4. **Reopen only through the contract.** If the user later wants to undo a `done` or `cancelled` task, or you need to correct a same-session mistaken completion/cancellation, use `execos taskops reopen --task-id KS-NNN [--to backlog|in_progress|blocked|review] [--note "..."]`. Do not restore closed tasks through `taskops update`.

### Flag / unflag for attention

Triggers: "flag KS-NNN", "this needs attention", "remind me about KS-NNN", "unflag KS-NNN", "clear the flag"

- Set: `execos taskops flag-attention --task-id KS-NNN [--reason "..."]`
- Clear: `execos taskops unflag-attention --task-id KS-NNN`

The reason text is what shows on the dashboard's Needs Attention panel — keep it terse and actionable ("overdue 2d", "Owen replied", "follow-up overdue"), not narrative.

### Link / unlink a goal

Triggers: "link KS-NNN to G-NNN", "this is part of the Q2 onboarding goal", "unlink KS-NNN from its goal"

Goal links ride on the update operation:

- Link: `execos taskops update --task-id KS-NNN --goal-id G-NNN`
- Unlink: `execos taskops update --task-id KS-NNN --clear-goal`

A task links to **at most one goal** (AC-006). The CLI rejects double-links — propose unlinking the existing one first if the user wants to switch.

### Manage task dependencies

Triggers: "KS-A blocks KS-B", "KS-B depends on KS-A", "add a dependency", "remove the blocker", "what blocks KS-NNN"

Use dependencies only for task-to-task blocking relationships. `blocked` status is still a separate status choice; adding an edge records the graph the dashboard/detail views read.

- Add: `execos taskops dependency-add --blocked <blocked-task-id> --blocked-by <blocker-task-id>`
- Remove: `execos taskops dependency-remove --blocked <blocked-task-id> --blocked-by <blocker-task-id>`
- List: `execos task dependency list <task-id>`

`--task-id` works as an alias for `--blocked` on both write operations.

If adding an edge returns `task_dependency_cycle`, surface it plainly: *"That would create a circular dependency, so Jordan refused it."* Do not bypass by editing SQL.

### List or show

Triggers: "show my tasks", "show KS-NNN", "list P1 tasks", "what's blocked",
"what's due tomorrow", "what tasks are due today", "tell me about the task due
Friday"

- All: `execos --format json task list`
- Filtered: `execos --format json task list --status in_progress` / `--priority P0` / `--category client` / `--due "tomorrow"` / `--due-on "tomorrow"` / `--due-by "2026-05-13"`
- One task in detail: `execos task show KS-NNN`

Use `--format json` for task summaries and filtering because JSON list output
already includes title, description, due date, status, priority, category, and
dashboard-relevant fields. Only run `task show` afterward when you need recent
notes or full single-task detail.

For **"what should I work on next?"**, **"re-rank my tasks"**, or
**"reprioritize my tasks"**, route to `/review-tasks`, or run `execos --format
json taskops hydrate --operation re-rank` if you are already inside this skill
and need the packet (pass Jordan's situational context as `--intent`, and lock
the result with `execos taskops re-rank` per that packet's instructions). Do
not answer from a raw task list alone. The re-rank packet is the source of
truth for the ordered do-next list, surfaced anomalies, and any priority
re-tier proposal. Existing `daily review` views remain valid for EOD, weekly,
or diagnostic review output when that is the explicit request.

## Referenced Tasks Table

For read-only answers, any user-facing reply that references a task must end
with a `Referenced Tasks` Markdown table:

| ID | Task | Due | Description | Status |
| --- | --- | --- | --- | --- |
| `<task-id>` | `<task title>` | `<due date>` | `<task description>` | `<status cell>` |

The last column is status-aware, never a hardcoded `Open` link: read each task's
real status from CLI output and render it. A non-terminal task (triage, backlog,
in_progress, blocked, review) links to the dashboard as
`[Open](http://127.0.0.1:3737/?task=<task-id>)`. A `done` task shows `Done` and a
`cancelled` task shows `Cancelled` as plain text (no link). Never invent a status;
if it cannot be verified, show `Unknown`.

Prefer task titles in prose. Do not leave Jordan with only `KS-###` IDs. Use
ID, title, due date, description, and status from CLI output. `execos
--format json task list` includes descriptions and due dates and is usually
enough for multi-task summaries. Plain text `task list` is only a quick glance;
if you used plain text, run `task show` or repeat the list with `--format json`
before filling the table. Use `Unavailable` rather than inventing missing task
fields only when `task show` fails or shell access is unavailable. If the task
is verified to have no due date, say `None`.

For write turns, the receipt's Action Ledger is the primary task reference.
Do not append a full task list. If a table is still useful, include only tasks
mutated this turn.

## Batched Writes (Composed Hydrate)

When one user message implies **two or more write operations** — several new
tasks, or a mix of creates, updates, completes, delegations, and other writes —
do not run a hydrate/write/receipt cycle per operation, and do not chain
individual hydrate commands. Run **one composed hydrate** that returns every
context packet in a single call:

```
execos taskops hydrate \
  --op "create:<one-line intent for the first new task>" \
  --op "create:<one-line intent for the second new task>" \
  --op "complete:KS-012" \
  --op "delegate:KS-014:<one-line delegation intent>"
```

Each `--op` is one work order: `create:<intent>` for new tasks, or
`<operation>:<task-id>[:<intent>]` for writes targeting an existing task
(update, complete, cancel, delegate, follow-up, defer, dependency-add,
dependency-remove, flag-attention, unflag-attention). The intent is always the
final segment and may itself contain colons. All write operations are
supported; read operations (list, show, review, follow-ups, draft-follow-ups)
are terminal views — invoke those directly instead.

The composed packet renders the shared context (active tasks, active goals,
team roster) once, each operation type's instructions once, and one numbered
work order per `--op` carrying that operation's own data: the intent, that
draft's duplicate matches (create), the target task and current description,
the default follow-up date (delegate), warnings, and per-intent memories. Each
work order names the exact subcommand to run next.

Executing the batch:

- **Cap: 8 work orders per call.** A larger request is refused, never
  truncated. Process bigger batches in waves: hydrate up to 8, execute and
  verify that wave's receipts, then hydrate the next wave.
- **Chain the writes with `;`, NEVER `&&`.** Every write must get its chance
  to run: a refusal (duplicate gate, validation, WIP cap) exits nonzero, and a
  `&&` chain would silently abort every write after it.
- **Verify one receipt per work order.** N work orders means N receipts. A
  missing receipt is the recovery signal: that write refused or failed — read
  its error, resolve that work order individually (for example the duplicate
  side-by-side comparison flow), and re-run only that command. Close with a
  single consolidated Action Ledger covering every operation, followed by any
  `No action:` lines for mentioned items you did not mutate.
- Single-operation hydrate (`--operation/--intent/--task-id`) is unchanged;
  use it when only one write is planned. Never mix the single-operation flags
  with `--op` in the same call.

## Owner Resolution

When a task's owner is someone other than the user, resolve the user's text to a `team` row via this 4-step sequence (AC-072) — downstream skills (delegation, Slack DM) read `slack_user_id` from the resolved row, so getting this right matters:

**Delegation fit.** When recommending who should own work or drafting a handoff, read teammate and client context in the `team-delegation-prod` skill (`references/team-roster.md`) so suggestions match roles, limits, and client PMs. Then run the steps below; the roster does not replace slug resolution.

1. Try matching against `team.slug` exactly.
2. If no slug match, try `team.display_name` exactly.
3. If still none, try unambiguous substring against `display_name`. If multiple rows match, treat as ambiguous (skip to step 4).
4. Otherwise ask: *"I don't have a teammate matching '<text>'. Pick existing (here are the options) or add new (slug + display name)?"*

Only invoke `taskops delegate` after the owner resolves to a real slug. (`taskops create` and `taskops update` do not take teammate owners — they refuse any `--owner` other than `me`.)

## Status Cheatsheet

Allowed task status transitions. The DB rejects anything not listed.

| From → To       | backlog | in_progress | blocked | review | done | cancelled |
|-----------------|:-------:|:-----------:|:-------:|:------:|:----:|:---------:|
| triage          | ok | ok | ok | ok | ok | ok |
| backlog         | —  | ok | ok | ok | ok | ok |
| in_progress     | ok | —  | ok | ok | ok | ok |
| blocked         | ok | ok | —  | ok | ok | ok |
| review          | ok | ok | ok | —  | ok | ok |
| done, cancelled | terminal — no transitions out |

Mental model: `blocked` = waiting on **another task** to finish. `review` = waiting on **someone external** (client signoff, vendor reply). The dashboard splits these into the WAITING and DELEGATED columns, so picking the right one is user-visible.

## Error Handling

### P0 WIP cap reached

Triggered when moving a P0 task to `in_progress` while N P0 tasks are already in-progress (default cap = 3). The CLI surfaces the cap and the existing P0 IDs. Present the four resolution options below **verbatim** — the agent never silently auto-downgrades:

> *"You're at your P0 WIP cap (3 P0 tasks already in-progress: KS-A, KS-B, KS-C). What would you like to do?*
> *(a) Make this task P1 instead and proceed.*
> *(b) Move one of the existing P0 tasks to backlog/blocked/review to make room (which one?).*
> *(c) Bump the WIP cap to 4 (this changes a setting; your call).*
> *(d) Keep this in backlog at P0 for now; promote later when room opens.*
> *Or tell me what makes sense."*

Then act on the user's pick and append a resolution note:

- (a) → re-invoke with `--priority P1`. Note: `wip_cap_resolution: downgraded_to_P1`.
- (b) → list the 3 existing P0s with one-line context; user picks one; `taskops update` to move it; then re-attempt the original. Note: `wip_cap_resolution: demoted_KS-X_to_<status>`.
- (c) → confirm explicitly, then bump `app_settings.p0_wip_cap`. If the current CLI does not expose this surface, say so and stop — do not edit `app_settings` via SQL.
- (d) → create / update with `--priority P0 --status backlog`. Note: `wip_cap_resolution: held_in_backlog`.
- Free-text ("let me think") → save as `triage` and wait.

### Status transition rejected

The DB raises a CHECK violation. Surface the matching matrix entry to the user — *"Can't go from `done` to `in_progress` — terminal."* — and offer to create a new task referencing the closed one.

### Description too short

CLI rejects (technical validation floor: 10 characters). This means the description failed the real bar too — at least one complete, informative sentence capturing all context and details the user provided. Rewrite it from the available context into a proper sentence and re-run; do not pad with filler to clear the threshold, and do not stop to interrogate the user.

### Goal link when goal is `achieved` or `dropped`

DB allows it (linked tasks survive goal closure), but flag conversationally: *"G-NNN is closed — link anyway, or want me to find an active goal?"*

# Gotchas

- **Do not mix shells.** On Windows, `Select-String`, `$variables`, and here-strings are PowerShell syntax. If you need them, use the PowerShell tool for the whole command. Do not pipe Bash output into PowerShell cmdlets.
- **Use JSON for agent parsing.** For task summaries, prefer `execos --format json task list ...`; it includes descriptions and avoids one `task show` per task.
- **Long text goes through stdin or real files.** For pasted task specs, pipe a PowerShell here-string into `--description -` or `--note -`. Use `--description-file` / `--note-file` only for preexisting files. Do not cram a full multiline body into one quoted CLI command.
- **Title can be positional or `--title`.** Prefer `--title` when using shell variables or long text: `execos taskops create --title "Title" -d "Description" -c personal --due "tomorrow"`.
- **Due-date lookup is a task-list filter.** For "what's due tomorrow?", use `execos --format json task list --due "tomorrow"` or `--due-on "tomorrow"` so descriptions come back in the same call.
- **Enums are exact case.** Priority is `P0` / `P1` / `P2` / `P3` (capital P). Status is lowercase exact (`in_progress`, not `inProgress` or `in-progress`). Category is hyphenated lowercase (`client`, etc.).
- **Goal IDs are `G-NNN`**, not `KG-NNN`. (`KG` is a dashboard display fallback for some demo data — never the real ID.)
- **Two `app_settings` warnings** print on every `execos task` invocation right now (legacy + typed key for `task_id_prefix` and `p0_wip_cap`). Harmless. Don't try to fix them from this skill.
- **Don't say "I can't do that yet" before checking.** When uncertain about a flag, run `execos taskops <subcommand> --help` (or `execos task <subcommand> --help` for reads) and read the actual surface.
- **Append-only notes.** Never propose editing or deleting `task_notes` rows — the application-layer scan rejects any UPDATE/DELETE pattern in source. New context = new note via the CLI.

# Final Verification

Before declaring an action complete, confirm each:

1. **Intake**: Did every new task get a title, a description of at least one complete informative sentence carrying all user-provided context, a category, and a due date (Jordan's signal or the CLI's 3-business-day default, flagged in the receipt when defaulted)? Were priority and hard-deadline set explicit-only (from Jordan's stated intent, never inferred from the subject or context), and goal / delegation decided deliberately, with assumptions stated in the receipt instead of asked as questions?
2. **Terminal confirmation**: For any move to `done` or `cancelled`, did the user explicitly confirm *in this turn*?
3. **WIP cap UX**: For a P0-cap rejection, did you present the four options verbatim and re-attempt only after the user picked?
4. **Owner resolution**: If the work belongs to a teammate, was the task created owned by me and the owner resolved through the four-step sequence before `taskops delegate` fired?
5. **Action Ledger**: For any write receipts, did the reply lead with one
   checklist line per receipt in execution order, quote triggers for
   completions, cancellations, and delegations, include `No action:` lines for
   deliberately skipped mentions, and limit any task table to mutated tasks?
6. **Write path**: Did every write go through `execos taskops`, with hydrate
   run first, and was any duplicate refusal resolved by your own judgment
   (obvious calls reported in the receipt summary, genuine uncertainty taken
   to the user) with any `--allow-duplicate "<justification>"` override
   carrying a real justification?
