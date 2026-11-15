# Operational Prompt: Task Management (Update)

## User Intent
{{intent}}

## Target Task

{{target_task}}

### Current Description
{{target_description}}

## Active Goals (Goal Link Reference)

{{active_goals}}

## Relevant Memories & Rules

{{memories}}

## Intake Guidance
Apply the checks that the update touches; skip the rest. These checks are your internal process: decide each one yourself from context, run the update, and state the assumptions you made in the receipt so Jordan can correct them. Do not stop to ask about missing or ambiguous fields.

- Priority: change `--priority` only from Jordan's expressed priority intent, never from the task's type or how urgent the subject sounds. No priority language means leave the tier as-is. Map an expressed-but-untiered signal conservatively: "high priority" / "important" / "urgent" to at least P1; "critical" / "very urgent" / "now" / "emergency" to P0 (still subject to the P0 WIP-cap confirmation).
- Hard deadline: set `--hard-deadline true` when EITHER (a) Jordan explicitly calls it a hard deadline or identifies the task as an L10 task, OR (b) Jordan names a specific date on which an external third party imposes a concrete consequence (account suspension, late fee, filing window closing, contract lapse, penalty). The test for (b) is a real outside actor AND a dated enforced consequence: "AWS suspends the account Friday" qualifies; "the client is furious", "this is important", or "I need to get to it soon" do not. Never infer a hard deadline from a client/vendor/billing relationship alone, internal importance, emotional pressure, or urgency with no dated third-party consequence. When Jordan says the task comes from his L10: due date = next L10 date (from memory), hard deadline = true. If the next L10 date is not on file, infer the most plausible date from context and flag the assumption in the receipt.
- Effort estimate: assign a t-shirt size (S under 1 hour, M 1 to 4 hours, L half-day plus, XL multi-day) with `--effort` and state it in the receipt; Jordan corrects it if wrong. If the work looks XL, propose a split in the receipt.
- Split and dependency check: 2 or more independent actions, owners, or due dates: propose a split in the receipt and link the pieces with `execos taskops dependency-add` once Jordan agrees. Also note whether this task blocks or gets blocked by anything on the active board.

## Instructions
1. Generate and run the update command:
   ```bash
   execos taskops update --task-id "{{task_id}}" [options]
   ```
   Supported options:
   * `--title "<new title>"`
   * `--description "<new description>"` *(at least one complete, informative sentence capturing the task's context; the CLI's technical floor is 10 characters)*
   * `--status "<triage|backlog|in_progress|blocked|review>"` *(Note: terminal statuses like done/cancelled must be done via taskops complete)*
   * `--priority "<P0|P1|P2|P3>"`
   * `--due "<due_phrase>"`
   * `--hard-deadline "<true|false>"` *(true only when Jordan explicitly says it is a hard deadline, names an L10 task, or states a specific date on which a third party enforces a concrete consequence such as suspension or a late fee; never from relationship, importance, or urgency alone)*
   * `--effort "<S|M|L|XL>"` *(t-shirt size estimate)*
   * `--clear-effort` *(remove the existing effort estimate; mutually exclusive with --effort)*
   * `--goal-id "<G-id>"` *(link this task to a goal; pick the ID from the Active Goals list above)*
   * `--clear-goal` *(remove the existing goal link; mutually exclusive with --goal-id)*

   Owner is not an update field: `taskops update` refuses any `--owner` value other than `me`. To reassign a task to a teammate, run `execos taskops delegate`, which resolves the owner against the team roster and sets the follow-up date.
