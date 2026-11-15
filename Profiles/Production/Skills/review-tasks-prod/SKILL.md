---
name: review-tasks-prod
description: >-
  Use when Jordan invokes /review-tasks or asks what to do next, what should I
  work on, refresh my list, re-rank or reprioritize my tasks, plan my day,
  review my tasks, or choose today's focus. Runs production `execos --format
  json taskops hydrate --operation re-rank` (passing any situational context
  Jordan gave as --intent), leads with the ordered task list, locks the queue
  with `execos taskops re-rank` in the same turn, and applies only accepted
  priority re-tiers through the guarded `execos taskops update` path. Does not
  cancel, reschedule, split, merge, snooze, delegate, complete, or send
  external messages unless Jordan asks.
---

# Context

This skill is Jordan's manual task review and reprioritization entry point. It
answers "what should I do next?" by running the read-only re-rank hydration
packet, applying the packet's decision framework to the ranked task
candidates, and locking the resulting top-5 queue.

Jordan can supply situational context that changes today's ranking ("marketing
is really urgent today, put my marketing tasks first"). Pass that context
verbatim through `--intent` on the hydrate call; the packet instructs you to
weigh it ahead of the default heuristics while still surfacing hard-deadline
commitments and overdue items.

The only proactive write this skill may make is a task priority re-tier. All
priority writes must go through `execos taskops update --task-id KS-### --priority <P>`
so the CLI enforces the P0 WIP cap and records the audit trail. Every other edit is
reactive: do it only after Jordan explicitly asks.

# Workflow

Track progress through this workflow.

1. Recognize review intent from `/review-tasks`, "what should I do next",
   "what should I work on", "refresh my list", "re-rank my tasks",
   "reprioritize my tasks", "plan my day", "review my tasks", or similar
   phrasing. Capture any situational context in the request ("marketing is
   urgent today"). If the same message also declares tasks done or cancelled, settle those first through the tasks skill flow (the explicit statement is the confirmation) before running the re-rank hydrate, so the packet ranks only genuinely open work.
2. Run the re-rank packet, passing situational context verbatim when Jordan
   gave any:

   ```bash
   execos --format json taskops hydrate --operation re-rank [--intent "<situational context>"]
   ```

3. Read the returned prompt. Use the ranked candidate table, anomaly sections,
   active goals, and embedded decision framework as the source of truth.
4. Lead with an Action Ledger when any write receipt is present, then render
   the answer. If no write receipt is present yet, start directly with the
   answer. Render:
   - Heading: `What to work on today (<weekday>, <date>)`.
   - Coverage line: `Reviewed N active tasks. Nothing has dropped off.` Use the
     packet count when present; otherwise count the task rows visible in the
     review packet and say `Reviewed the current review packet. Nothing has
     dropped off.`
   - Top 5 table with columns `#`, `Task`, and `Why it is here`.
   - Inline priority annotations like `P1 (raised from P2)` when proposing an
     accepted re-tier.
   - `What I changed:` with the priority re-tiers applied or `Nothing yet.`, and `Queue locked: #1..#N` (listing the locked task IDs in order). This section must match the Action Ledger whenever receipts were returned.
   - `Also surfaced, outside your top 5:` for overdue, stale, new triage,
     arrived snooze, Commitments At Risk, Goals At Risk, and Newly Unblocked
     items, each with its disposition (see
     [Risk Sections And Dispositions](#risk-sections-and-dispositions)).
   - Footer: `Run /review-tasks anytime to refresh this. Say 'done <ids>' to
     clear items, or just start working.`
5. Lock the final top 5 do-next tasks into the persisted agent queue, in the
   same turn as the answer, by running:
   ```bash
   execos taskops re-rank --task <id1> --why "<rationale1>" --task <id2> --why "<rationale2>" ...
   ```
   Ensure you provide a quality rationale for each queue slot: one dense sentence, <= 200 characters, in the voice of Jordan's personal productivity assistant. Each rationale must answer why this task, why now, and why this rank. Include at least two decision signals when available: urgency, leverage, current context, sequencing, or why it beats nearby lower-ranked work. Do not use raw labels like `P1, due soon` or `Jira data pipeline setup` unless that truly explains the ranking choice. If clearing the queue, run `execos taskops re-rank --clear`. Include a `Queue locked: #1..#N` (listing the task IDs in order) confirmation in your response. Do not stop after presenting the list; presenting without locking leaves the dashboard queue stale. Pause only for a P0 promotion or a genuinely ambiguous call.
   Never lock a task the user declared done or cancelled this turn, and never park a queue slot on a "pending confirmation" task; resolve the status first.
6. If a non-P0 priority re-tier is clearly accepted by Jordan working the list
   or saying yes, apply it:

   ```bash
   execos taskops update --task-id KS-### --priority P1
   ```

7. If any proposed change would promote a task to P0, pause first. Ask explicit
   confirmation and name any currently in-progress P0 task it may displace.
   Only run the update after Jordan confirms.
8. Handle any reactive edits Jordan requests through the normal task skill or
   the relevant CLI command. Do not bundle them into the proactive review.

# Risk Sections And Dispositions

The review packet includes three risk sections beyond the ranked candidates:

- **Commitments At Risk**: hard-deadline tasks in danger of slipping.
- **Goals At Risk**: active goals whose linked work is stalled or off pace.
- **Newly Unblocked**: tasks whose blockers just cleared and are now
  actionable.

Every row in these sections carries transparency fields: the days left, the
window that pulled it into the section, and the rule that fired. Use those
fields to explain in plain language why each row surfaced; do not dump raw
field names at Jordan.

Each row requires exactly one disposition. Never silently skip a row:

1. Propose a priority re-tier (a promotion to P0 still requires explicit
   confirmation first).
2. Ask Jordan about it with one focused question.
3. State why no change is needed.

# Command Guidance

- Primary read command: `execos --format json taskops hydrate --operation re-rank [--intent "<situational context>"]`.
- Priority write command: `execos taskops update --task-id KS-### --priority P0|P1|P2|P3`.
- Queue write command: `execos taskops re-rank --task KS-### --why "..." [--task KS-### --why "..."]...` or `execos taskops re-rank --clear`.
- Do not use SQL, taskops write internals, or service helpers for priority or queue changes.
- Do not run `execos review refresh-attention` from this skill. The review task
  workflow is independent of the old Needs Attention refresh path.
- Use `execos task show KS-###` only when the packet lacks details needed for a
  user-facing answer.
- `execos taskops create` and `execos taskops update` now accept
  `--hard-deadline` and `--effort`, plus `--clear-effort` on update. They are
  ordinary field edits, not part of the proactive re-tier write; apply them
  only when Jordan asks or accepts a proposal, through the normal task skill
  path.

# Confirmation Rules

- Non-P0 re-tiers can be applied when Jordan accepts the review list or gives a
  clear yes.
- P0 promotions always require explicit confirmation first.
- Cancel, reschedule, merge, split, snooze, delegate, complete, and rewrite
  operations require explicit Jordan request.
- If the review packet and Jordan's stated intent disagree, ask one focused
  question before writing.

# Error Handling

- If the re-rank hydrate fails, summarize the failed command and the smallest
  next move. Do not invent a review from memory.
- If a priority update hits the P0 WIP cap, present the CLI's options plainly
  and let Jordan choose. Do not silently downgrade.
- If a task ID from the packet cannot be updated, stop and report which ID
  failed.

# Examples

- "/review-tasks"
- "What should I do next?"
- "What should I work on today?"
- "Refresh my list."
- "Plan my day."
- "Review my tasks."

# Final Verification

Before replying, confirm:

1. The packet came from `execos --format json taskops hydrate --operation re-rank`, with Jordan's situational context passed via `--intent` when he gave any.
2. The final queue was locked with `execos taskops re-rank` in the same turn, and the response includes `Queue locked: #1..#N`.
3. The answer included the ordered top tasks instead of asking for approval to
   show them. When a re-rank or priority update receipt was returned, the reply
   led with the receipt-required Action Ledger before the task list.
4. The only proactive writes were the `taskops re-rank` queue lock and
   accepted priority re-tiers through `execos taskops update`.
5. Any P0 promotion was explicitly confirmed before the update.
6. No cancel, reschedule, merge, split, snooze, delegate, complete, or external
   write happened unless Jordan asked for it.
7. Every Commitments At Risk, Goals At Risk, and Newly Unblocked row got
   exactly one disposition: a proposed re-tier, a question to Jordan, or a
   stated reason no change is needed.
8. Referenced tasks are clear by ID and title.
9. No task the user declared done or cancelled this turn appears in the locked queue.
