---
name: goal-dev
description: >-
  Use when Calvin wants to create, update, list, inspect, link work to, or close
  goals in the developer profile. Wraps the `execos goal` CLI, supports
  stdin for long goal descriptions, and enforces explicit confirmation for
  terminal goal closure. Does NOT manage task CRUD except to inspect linked
  tasks or route task linking to tasks-dev.
---

# Context

This skill owns developer-profile goal management. Goals are durable quarterly
outcomes, not oversized tasks. Use goals for larger directions, targets, or
initiatives; use `tasks-dev` for discrete actions.

Use development commands from the repo root: `execos ...`. Natural language
is the user experience; CLI mechanics are implementation details.

# Workflow

Track progress through this workflow.

1. **Recognize intent.**
   - Create: "add a goal", "new Q2 goal", "track this as a quarterly goal".
   - Update: "rename G-001", "change the goal description", "move this goal to Q3".
   - Close: "we achieved G-001", "drop that goal", "close G-001".
   - Inspect: "show G-001", "what goals are active", "what tasks are linked to this goal".
2. **Create goals with the real CLI surface.**
   - Required fields: title, quarter, description.
   - If the user did not provide a quarter, infer the current quarter when safe;
     otherwise ask one targeted question.
   - For short descriptions:

     ```bash
     execos goal create "<title>" -q 2026-Q2 -d "<description>"
     ```

   - For long or multiline descriptions on Windows, use PowerShell here-string
     stdin, not Bash:

     ```powershell
     @'
     Multiline goal description.
     '@ | execos goal create "<title>" -q 2026-Q2 -d -
     ```

3. **Update fields.**

   ```bash
   execos goal update G-001 --title "<title>"
   execos goal update G-001 --description "<description>"
   execos goal update G-001 --quarter 2026-Q3
   ```

   Use `--description -` with PowerShell stdin for long generated descriptions.
4. **List and inspect.**

   ```bash
   execos --format json goal list --status active
   execos goal show G-001
   execos --format json goal linked-tasks G-001
   ```

   Use JSON when the response needs to reason over multiple records.
5. **Close goals only after confirmation.**
   - Ask plainly before terminal closure: "Close G-001 as achieved?" or
     "Close G-001 as dropped?"
   - After confirmation:

     ```bash
     execos goal close-achieved G-001 --yes
     execos goal close-dropped G-001 --yes
     ```

   Closing a goal does not close linked tasks.
6. **Route task linking to the task workflow.**
   - Link: `execos taskops update --task-id KS-001 --goal-id G-001`
   - Unlink: `execos taskops update --task-id KS-001 --clear-goal`
   - If the user asks to create or edit a task and connect it to a goal, use
     `tasks-dev` and pass `--goal-id G-001` during create when appropriate.

# Gotchas

- PowerShell here-strings (`@' ... '@`) are not Bash syntax. If using them, run
  the whole command with PowerShell.
- `goal create` has no `--status`; goals start active. Use close commands for
  terminal statuses.
- `goal update` does not close goals. Use `close-achieved` or `close-dropped`
  after confirmation.
- `goal linked-tasks` filters linked task status with `--status`; `goal list`
  filters goal status with `--status`.

# Final Verification

Before replying, confirm:

1. Developer commands used `execos ...`.
2. Goal create/update used the real flags: title, `--quarter`/`-q`, and
   `--description`/`-d`.
3. Long generated descriptions used stdin instead of fragile shell quoting.
4. Terminal closure had explicit user confirmation and `--yes`.
5. Any task creation or task linking went through `tasks-dev` rules.
