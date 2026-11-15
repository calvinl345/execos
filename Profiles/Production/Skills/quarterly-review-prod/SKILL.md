---
name: quarterly-review-prod
description: >-
  Use when Jordan wants a quarterly review, goal review, quarter plan, goal
  reconciliation, goal closure, or goal-first prioritization. Uses production
  `execos goal` and `execos task` commands to reconcile outcomes and supporting
  next actions. Does not get lost in routine daily task cleanup.
---

# Context

This skill is goal-first. It helps Jordan decide what goals are still alive,
what should close, what needs to change, and which outcomes matter most for the
next quarter. Task work is included only to prove or repair goal alignment.

Use natural conversation as the main UX. The agent should inspect the current
state, guide Jordan through a focused review, then update goals and supporting
tasks through production CLI commands from the repo root: `execos ...`.

# Workflow

Track progress through this workflow.

1. **Identify the quarterly timeframe.**
   - Triggers include "run my quarterly review", "review my goals", "plan the
     quarter", "what goals should I focus on", "reconcile my goals", and
     "close out the quarter".
   - Ask which quarter only if Jordan did not imply it and the distinction
     matters.
2. **Load goal-first state.**
   - Start with active and recently closed goals:

     ```bash
     execos --format json goal list --status active
     execos --format json goal list --status achieved
     execos --format json goal list --status dropped
     ```

   - For goals under discussion, inspect details and linked tasks:

     ```bash
     execos goal show G-###
     execos goal linked-tasks G-###
     ```

   - Use task lists to find relevant unlinked work:

     ```bash
     execos --format json task list --status in_progress
     execos --format json task list --status backlog
     execos --format json task list --status blocked
     ```
3. **Review goal progress.**
   - Discuss what was completed, what moved forward, what stalled, what no
     longer matters, and what changed in Jordan's life, work, or business
     context.
   - Keep questions focused on outcomes and direction, not tiny task grooming.
4. **Reconcile goals.**
   - Update active goals with:

     ```bash
     execos goal update G-### [--title "..."] [--description "..."] [--quarter YYYY-Q#]
     ```

   - Create a new goal only when Jordan clearly identifies a larger outcome:

     ```bash
     execos goal create "<title>" --quarter YYYY-Q# --description "<description>"
     ```

   - Close completed or no-longer-relevant goals only after confirmation:

     ```bash
     execos goal close-achieved G-### --yes
     execos goal close-dropped G-### --yes
     ```
5. **Check task alignment.**
   - Each active goal should have at least one clear next action when
     appropriate.
   - Link important supporting tasks with
     `execos taskops update --task-id KS-### --goal-id G-###`.
   - If a task supports the wrong goal, use
     `execos taskops update --task-id KS-### --clear-goal` before
     linking the right one.
   - If an important goal lacks a next action, create a concise task with
     `taskops create` (hydrate first with `taskops hydrate --operation create`).
6. **Choose quarterly priorities.**
   - Identify the most important goals for the next quarter and the key
     supporting tasks or projects.
   - Treat this as a decision workflow: clarify the real strategic choice,
     compare realistic options, explain tradeoffs, and recommend the path with
     the strongest leverage.
   - Challenge stale goals, weak priorities, or work that no longer matches
     Jordan's business context. Do not keep goals active just to avoid a hard
     call.
   - When useful, name what Jordan should ignore, defer, or stop doing next
     quarter.
   - Use needs-attention for a few tasks that must surface prominently:

     ```bash
     execos taskops flag-attention --task-id KS-### --reason "short reason"
     execos taskops unflag-attention --task-id KS-###
     ```

   - The current CLI has task-level needs-attention, not goal-level
     needs-attention. For a goal that needs prominent attention, flag the
     clearest supporting task.
7. **End with the quarterly summary.**
   - Include the real decision, recommended quarterly focus, goals closed, goals
     updated, new goals created, immediate next actions, and unresolved
     decisions.
   - If the summary references any task, append a `Referenced Tasks` Markdown
     table with columns `ID`, `Task`, `Due`, `Description`, and `Open`. Use
     dashboard links shaped like `http://127.0.0.1:3737/?task=KS-###`.

# Command Guidance

- There is no dedicated `daily review quarterly` command. Assemble quarterly
  review from `execos goal` and `execos task` commands.
- `goal list` supports `--status`, `--quarter`, and `--limit`.
- `goal show` includes linked-task count and a preview of linked tasks.
- `goal linked-tasks` lists all tasks linked to one goal and can filter by task
  status.
- Goal closing does not close linked tasks. Reconcile supporting tasks
  separately when needed.
- Task links are one-goal-at-a-time. Use `taskops update --clear-goal` before relinking.

# Data Hygiene

- Outcomes become goals; errands and one-off actions become tasks.
- Prefer updating an existing goal over creating a near-duplicate.
- Do not keep stale goals active just because they once mattered.
- Keep goal titles concise and outcome-oriented. Put scope and context in the
  goal description.
- Avoid routine board cleanup unless it is necessary to reconcile goals.

# Confirmation Rules

Act directly for clear, routine updates. Ask for confirmation before closing or
dropping goals, cancelling tasks, bulk changes, deleting or archiving anything
if a future CLI adds that capability, exposing sensitive document contents,
sending external reports, or touching external systems.

# Error Handling

If a command fails, summarize what failed, the likely cause if known, and the
smallest next move. If quarterly review needs a capability the CLI does not
have, name the gap and use the closest real workflow. Route product bugs or
workflow gaps to `report-issue-prod` when Jordan wants them filed.

# Examples

- "Run my quarterly review."
- "Review my goals."
- "Plan the quarter."
- "What goals should I focus on?"
- "Reconcile my goals."
- "Close out the quarter."

# Final Verification

Before replying, confirm:

1. The quarter or planning horizon was clear.
2. Production commands used `execos ...`.
3. Goal state was loaded before task cleanup.
4. Goal changes went through `execos goal`; task alignment went through
   `execos task`.
5. New goals describe larger outcomes, not ordinary tasks.
6. The final summary states closed goals, updated goals, new goals, top goals,
   immediate next actions, and unresolved decisions.
7. Any referenced tasks were listed at the bottom in a `Referenced Tasks` table
   with ID, title, due date, description, and dashboard link.
