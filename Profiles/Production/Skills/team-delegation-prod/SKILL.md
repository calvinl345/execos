---
name: team-delegation-prod
description: >-
  Use when Jordan asks who should own a task, how to delegate, who to route
  client work to, or wants a follow-up or Slack handoff draft for a teammate. Read
  references/team-roster.md for role fit, capacity signals, and client PM
  mapping; combine with tasks-prod Owner Resolution so `taskops delegate`
  uses a real team slug. Does NOT replace task creation/update/follow-up
  operations in tasks-prod; does NOT send Slack or email without confirmation.
---

# Context

Delegation judgment needs stable facts about people and clients. Those facts live in `references/team-roster.md` so they stay editable and reviewable without overloading `tasks-prod` or database-freeform memory.

The **`team` table, `execos task`, and `execos taskops` are still
authoritative** for owner slugs and saved work. This skill supplies routing
context and draft language only.

# Workflow

Track progress through this workflow.

1. **Recognize intent.** Triggers include: "who should own this?", "delegate to …", "route this to the right PM", "draft a Slack to … for this task", "what's Riley good for?", client-named work where the right internal owner is unclear.

2. **Read reference.** Load `references/team-roster.md` in this skill folder (same directory as `SKILL.md` after materialization: `.claude/skills/team-delegation-prod/references/team-roster.md`).

3. **Map work to owner.**
   - Use roster **Notes** for fit, limits (e.g. marketing vs sales), and sensitivity (burnout, scope).
   - Use **Client PM map** when the task is tied to a listed client.
   - If several people fit, give **one primary recommendation** and a short alternate, with reasons from the reference.
   - If Jordan proposes an owner who looks mismatched, overloaded, or outside
     role fit, say so directly and recommend the better route.

4. **Resolve to a real slug.** Before any `taskops delegate`, follow **Owner Resolution** in `tasks-prod` (match
   `team.slug`, then `display_name`, then ask). Do not invent slugs.
   `taskops delegate` is the only operation that sets a teammate owner;
   `taskops create` and `taskops update` refuse any `--owner` other than
   `me`. To capture work for a teammate, create the task owned by me,
   then delegate it.

5. **Saved delegation or follow-up.** If Jordan wants the assignment or
   follow-up lifecycle recorded, hand the action to `tasks-prod` and use
   `execos taskops delegate`, `execos taskops follow-up`, `execos taskops
   defer`, `execos taskops follow-ups`, or `execos taskops draft-follow-ups`
   as appropriate. Follow-up dates are separate from task due dates; when
   Jordan does not provide one, let `tasks-prod` choose the default cadence and
   surface it in the receipt.

6. **Handoff drafts.** If Jordan wants text for a teammate, produce a **draft**
   with ask, deliverable, deadline, and follow-up context when relevant. For
   Slack or any external post, preview and confirm before sending. If Jordan
   asks for "draft my follow-ups", use `execos taskops draft-follow-ups` for
   the per-person context block and write fresh, short, friendly-professional
   prose from it.

7. **Report briefly.** Key insight + recommendation + owner slug (once resolved)
   + one-line why; no dumping the whole roster. If the reply references any
   tasks, append a `Referenced Tasks` Markdown table with columns `ID`, `Task`,
   `Due`, `Description`, and `Open`.

# Gotchas

- **Roster is not task state.** Due dates, follow-up dates, status, and formal
  owner live in tasks; do not treat this file as the board.
- **Jordan default.** Many tasks stay with `me` unless Jordan explicitly wants delegation; suggest, do not auto-assign without consent.
- **No direct send.** Follow-up and Slack text is a draft unless Jordan
  explicitly confirms sending through an external connector.
- **Privacy.** The reference may contain operational judgment; do not paste large excerpts into external tools without need.

# Final Verification

Before replying, confirm:

- `references/team-roster.md` was used for people/client routing judgment.
- Any proposed `--owner` was tied to an actual `team.slug` resolution path (or you asked for disambiguation).
- Saved delegation/follow-up/defer work went through `tasks-prod` and
  `execos taskops`, not ad hoc notes or SQL.
- External messages were drafts pending confirmation when required.
- Any referenced tasks were listed at the bottom in a `Referenced Tasks` table
  with ID, title, due date, description, and dashboard link.
