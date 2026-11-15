---
name: weekly-review-prod
description: >-
  Use when Jordan wants a weekly review, weekly plan, task-board cleanup,
  next-week focus list, or light task-to-goal alignment check. Runs production
  `execos --format json review weekly`, then uses targeted `execos taskops`
  writes plus `execos task` and `execos goal` reads only when needed to
  reconcile records. Does not perform a full quarterly goal strategy review.
---

# Context

This skill helps Jordan clean up the board, understand what moved during the
week, and choose a small set of priorities for the coming week. It may touch
goals lightly, but the center of gravity is still task and backlog alignment.

Use natural-language conversation as the main interface. The CLI is the
implementation mechanism, not homework for Jordan. Use production commands from
the repo root: `execos ...`.

# Workflow

Track progress through this workflow.

1. **Identify the weekly timeframe.**
   - Triggers include "run my weekly review", "plan my week", "review this
     week", "what should I focus on next week", and "clean up my task board".
   - If Jordan names a specific week, use that as conversational context. The
     current CLI weekly view uses the host machine's current week.
2. **Load current state.**
   - Start with:

     ```bash
     execos --format json review weekly
     ```

   - The JSON weekly view includes descriptions for the task references. Only
     run targeted `task list`, `task show`, `goal list`, or `goal show` commands
     when a specific detail is missing or Jordan asks for it.
3. **Review the past week.**
   - Summarize what shipped, what moved forward, what slipped, what became
     irrelevant, and what blockers appeared.
   - Ask Jordan focused questions only where the CLI state leaves real
     ambiguity.
4. **Reconcile tasks.**
   - Complete confirmed done tasks:

     ```bash
     execos taskops complete --task-id KS-### --yes
     ```

   - Cancel obsolete tasks only after confirmation:

     ```bash
     execos taskops cancel --task-id KS-### --yes
     ```

   - Update stale or misfiled tasks with `taskops update`; add missing
     follow-ups with `taskops create` (hydrate first with
     `taskops hydrate --operation create`); link key tasks to goals with
     `taskops update --task-id KS-### --goal-id G-###`.
   - Clean duplicates by choosing the better existing record, updating it, and
     cancelling the duplicate only after confirmation.
5. **Review active goals lightly.**
   - Use `execos goal show G-###` or
     `execos goal linked-tasks G-###` for goals that need context.
   - Check whether active goals have next actions, whether key tasks align with
     active goals, and whether any goal needs a quarterly-review-level
     conversation.
6. **Choose weekly focus.**
   - Select a small set of priorities for the coming week.
   - Identify the highest-leverage priority first and explain why it matters in
     practice.
   - When the board is noisy, explicitly recommend what to ignore, defer, or
     stop doing for the week.
   - If a priority does not align with active goals, urgency, or meaningful
     follow-through, challenge it and offer the better alternative.
   - Mark only the most important or blocked items as needs-attention:

     ```bash
     execos taskops flag-attention --task-id KS-### --reason "short reason"
     execos taskops unflag-attention --task-id KS-###
     ```

   - Identify outreach, decisions, or missing information needed to unblock
     work.
7. **End with the weekly summary.**
   - Include a key insight, weekly wins, task changes made, top priorities for
     next week, goal alignment notes, unresolved blockers, and recommended next
     steps.
   - If the summary references any task, append a `Referenced Tasks` Markdown
     table with columns `ID`, `Task`, `Due`, `Description`, and `Open`. Use
     dashboard links shaped like `http://127.0.0.1:3737/?task=KS-###`.

# Command Guidance

- `execos --format json review weekly` is read-only. It shows shipped work,
  at-risk tasks, active goal summary, status-change activity, and next-week
  focus suggestions.
- `execos task list` supports filters for `--status`, `--priority`,
  `--category`, `--goal`, `--due-on`, `--due-by`, and `--limit`.
- There is no direct CLI command for task delete/archive. Use terminal
  cancellation only when confirmed and appropriate.
- There is no direct CLI command to append arbitrary task notes. Put durable
  context in supported fields, or save a memory only when it is reusable beyond
  the current task.
- Goal commands available for this workflow are `goal list`, `goal show`, and
  `goal linked-tasks`. Creating or closing goals belongs to quarterly review
  unless Jordan clearly asks during the weekly review.

# Data Hygiene

- Prefer updating existing tasks to creating new ones.
- Keep titles concise. Use descriptions for context and avoid stuffing history
  into titles.
- Do not turn every task into a goal.
- Link important tasks to at most one goal. If a task points to the wrong goal,
  use `taskops update --clear-goal` before linking the right one.
- Keep needs-attention scarce so it remains useful on the dashboard.

# Confirmation Rules

Act directly for routine, clearly requested task updates. Ask before destructive
changes, terminal statuses, bulk closing or archiving, uncertain duplicate
cleanup, exposing sensitive document contents, sending reports externally, or
touching external systems.

# Error Handling

If a command fails, summarize what failed, give the likely cause if known, and
offer the smallest next move. If a failure reveals a missing system capability,
name the gap plainly and use the closest real command. Route product bugs or
workflow gaps to `report-issue-prod` when Jordan wants them filed.

# Examples

- "Run my weekly review."
- "Plan my week."
- "Review this week."
- "What should I focus on next week?"
- "Clean up my task board."

# Final Verification

Before replying, confirm:

1. The week under review was clear.
2. Production commands used `execos ...`.
3. The read-only weekly view was used before reconciliation.
4. Task changes went through `execos taskops`; task and goal context came from
   `execos task` reads and `execos goal`.
5. Goal work stayed light unless Jordan explicitly wanted deeper goal strategy.
6. The final summary states wins, changes, next priorities, goal alignment, and
   unresolved blockers.
7. Any referenced tasks were listed at the bottom in a `Referenced Tasks` table
   with ID, title, due date, description, and dashboard link.
