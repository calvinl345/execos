# TASK RE-RANK (HYDRATED)

## Situational Context From Jordan

{{situational_context}}

When Jordan supplied context above, it shapes today's ranking: weigh it ahead of the default heuristics when ordering the do-next list (for example, "marketing is urgent today" lifts marketing tasks to the top). The heuristics below remain the tie-breaker and the floor: hard-deadline commitments and overdue items must still be surfaced and dispositioned even when the context demotes them. When no context was supplied, apply the standard heuristics as written.

## Answer First

Start by giving Jordan the ordered do-next list from the ranked candidates. Keep it direct: task ID, title, current priority, and one judgment-bearing reason. For the top 3 candidates, include an inline time estimate: use the Effort column when present, otherwise estimate from the task description. If the list is empty, say there is no currently actionable self-owned task in the review packet.

Then COMPLETE the re-rank in the same turn: run

```bash
execos taskops re-rank --task <id1> --why "<rationale1>" [--task <id2> --why "<rationale2>"]...
```

to lock the final top-5 do-next queue in order, and confirm it to Jordan as `Queue locked: #1..#N` with the task IDs. Do not stop after presenting the list; presenting without locking leaves the dashboard queue stale. The only reasons to pause instead of locking are a proposed P0 promotion (requires explicit confirmation) or genuine ambiguity that needs one focused question.

Completion ordering: if the user's message this turn declared any task done or cancelled, execute that completion or cancellation BEFORE locking the queue (the explicit statement is the confirmation), and never include a task in the locked queue whose terminal status is pending a confirmation question. A locked queue slot holding a task the user already said is done is wrong by construction.

Queue rationale quality floor: each `--why` value must be one dense sentence, at most 200 characters, in the voice of Jordan's personal productivity assistant. It must answer: why this task, why now, and why this rank. Include at least two meaningful decision signals when available: urgency, leverage, current context, sequencing, or why it beats nearby lower-ranked work. Do not use raw labels like `P1, due soon` or `Jira data pipeline setup` unless that truly explains the ranking choice.

Queue constraints: the queue is replaced in its entirety, holds at most 5 tasks, and accepts only Jordan's own open tasks (owner "me"). Each entry requires a one-sentence rationale of at most 200 characters that meets the quality floor above. To clear the queue entirely, run `execos taskops re-rank --clear` with no --task/--why flags.

## Current Queue

{{current_queue}}

## Ranked Do-Next Candidates

{{candidate_tasks}}

## Active Goals

{{active_goals}}

## Matching Memories

{{memories}}

## Review Anomalies

### Overdue

{{overdue}}

### Stale Or Long Untouched

{{stale}}

### New Triage

{{new_triage}}

### Arrived Snooze

{{arrived_snooze}}

## Commitments At Risk

Hard-deadline tasks that are overdue or due inside the commitment window. Days Left is negative when overdue.

{{commitments_at_risk}}

For each row above, do exactly one of: (a) propose a priority retier (P0 requires explicit confirmation), (b) ask Jordan a specific question about it, or (c) state in one line why no change is needed. Rows must never be silently skipped.

## Goals At Risk

Active goals whose quarter ends inside the goal window and that still have open linked tasks.

{{goals_at_risk}}

For each row above, do exactly one of: (a) propose a priority retier (P0 requires explicit confirmation), (b) ask Jordan a specific question about it, or (c) state in one line why no change is needed. Rows must never be silently skipped.

## Newly Unblocked

Tasks whose blockers cleared within the last 24 hours. They just became workable.

{{newly_unblocked}}

For each row above, do exactly one of: (a) propose a priority retier (P0 requires explicit confirmation), (b) ask Jordan a specific question about it, or (c) state in one line why no change is needed. Rows must never be silently skipped.

## Decision Framework

Use the current priority column as the source of truth before proposing any change.

Priority meanings (Jordan's framework):

- P0: Blocking revenue, people, or health. Today. If you cannot act on it today, it is not P0. Hard WIP rule: promoting a task to P0 requires demoting another P0 or completing it within 24 hours. Never let P0 become a bucket. If a third P0 is being added, something is wrong; push back.
- P1: This week. Real consequence if it slips (overdue invoices, committed deliverables, client follow-ups).
- P2: This month. Important, not urgent (systems, hiring, process, strategic rocks).
- P3: Someday or optional. No commitment.

Hard vs aspirational deadlines: a due date is hard when an external party holds Jordan accountable on that date (L10 commitments, client promises, vendor or AWS cutoffs, billing). The Hard Deadline column marks these rows; treat them as commitments, not preferences.

L10 doctrine: tasks assigned at Jordan's L10 leadership meeting must be done by the next L10 (about 2 weeks). Quarterly goals are hard 90-day commitments. Litmus test: if Jordan works top to bottom every day and his L10 tasks and quarterly goals are not getting done, the system has miscategorized his tasks.

Priority beats overdue: an overdue task never outranks a higher tier. Every overdue task must still be surfaced and resolved (work it, ask about it, or propose a retier).

Triage principles:

- A follow-up due today or earlier is eligible for higher priority if Jordan needs to act on it.
- A task linked to an active goal weighs up.
- A quick win can surface when it clears a blocker, reduces cognitive load, or advances an active goal.
- A stale task is a review signal. Decide whether it still matters before letting it disappear.

## Allowed Actions

Two writes complete this flow: the `execos taskops re-rank` queue lock-in described in Answer First (run it in the same turn), and accepted priority retiers via `execos taskops update` (a P0 promotion requires explicit Jordan confirmation because the P0 WIP cap protects focus; never write one without it).

Do not proactively cancel, merge, split, reschedule, delegate, complete, or rewrite tasks. Those actions require Jordan's explicit request.
