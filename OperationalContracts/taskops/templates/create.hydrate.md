# Operational Prompt: Task Management (Create)

## User Intent
{{intent}}

## Active Tasks (Deduplication Reference)
Inspect the active tasks list carefully to ensure this new task is not a duplicate.

{{active_tasks}}

## Duplicate Check
Embedding similarity matches against open tasks for this intent:

{{dedup_matches}}

The list above is evidence, never a verdict or an instruction. It is
ranked by embedding similarity only; exact title/description matches
are enforced separately at create time and never appear in this
preview.

- Bands are evidence tiers describing match strength: `near_identical`
  (similarity >= 0.92) and `similar` (similarity >= 0.85). A create
  refusal can additionally report an `exact` band (normalized exact
  title or description match, with `matched_on` naming the field).
- Treat the Active Tasks list as a fallback signal: compare it against
  the intent even when zero matches return, because embeddings miss
  reworded, partially overlapping, or umbrella tasks that a person
  would call the same work.
- Before judging a possible duplicate, fetch its detail first
  (`execos task show KS-NNN`) so you compare real fields, not just
  titles.

You own the duplicate decision. The create command itself refuses on
any exact or similarity match. Decide with your own judgment:

- **Obvious duplicate** (same work, however worded): do NOT create it and do NOT ask. Act on the existing task instead (update it, note it, or leave it) and report the call in the receipt summary with both IDs' evidence.
- **Obviously new work** that the gate refused anyway (e.g. a recurring instance, a deliberate twin): re-run with `--allow-duplicate "<justification>"`. The justification is mandatory, non-empty, audited in the intake note, and surfaced in the receipt; state the call in the receipt summary.
- **Genuinely uncertain**: consult Jordan with a rich side-by-side comparison — the existing task's title, description, and key metadata (status, due date, owner, category) next to the proposed task's title, description, and intended fields. Never hand back a bare ID. Then either update the existing task or, after Jordan confirms the work is new, re-run with `--allow-duplicate "<justification>"`.

## Active Goals (Goal Link Reference)
If Jordan wants to link this task to a goal, match the goal ID below.

{{active_goals}}

## Relevant Memories & Rules

{{memories}}

## Intake Guidance
This checklist is your internal process, not a script of questions for Jordan. Make reasonable default assumptions, infer description, category, due date, effort, and hard-deadline from context and the heuristics below, proceed directly to the create command, and present the completed receipt; Jordan corrects anything wrong afterward. At most one interrupt survives intake: genuine uncertainty on a duplicate, handled per the Duplicate Check section above (obvious calls are made without asking and reported in the receipt summary). Do not stop to ask about missing or ambiguous fields.

1. Description: infer what triggered this, anything time-sensitive that is not obvious, and who else is involved or waiting from the conversation, the active tasks, and the memories above; fold those inferences into the description instead of asking.
2. Priority, due date, and hard deadline (all explicit-only; these fields are guarded so they keep their meaning):
   - Priority: set `--priority` only from Jordan's expressed priority intent, never from the task's type, the client, or how urgent the subject sounds. No priority language from Jordan: omit `--priority` (it stays null). Jordan names a tier (P0/P1/P2/P3): use it. Jordan expresses priority without a tier: map conservatively: "high priority" / "important" / "urgent" / "a priority" to at least P1; "critical" / "very urgent" / "now" / "emergency" to P0 (still subject to the P0 WIP-cap confirmation). When unsure, leave it off.
   - Due date: if Jordan gave any due signal ("Friday", "next week", "before the call"), pass it via `--due` (honor it even if it lands on a weekend; an explicit date is Jordan's call). If there is no due signal at all, omit `--due`: the CLI defaults the due date to 3 business days out (weekend-avoiding) and emits a defaulted-due warning; surface that in the receipt so Jordan can adjust. Any due date you choose yourself that would land on a Saturday or Sunday rolls forward to the next business day. A defaulted or agent-chosen due date is always soft.
   - Hard deadline: set `--hard-deadline` when EITHER (a) Jordan explicitly calls it a hard deadline or identifies the task as an L10 task, OR (b) Jordan names a specific date on which an external third party imposes a concrete consequence (account suspension, late fee, filing window closing, contract lapse, penalty). The test for (b) is a real outside actor AND a dated enforced consequence: "AWS suspends the account Friday" qualifies; "the client is furious", "this is important", or "I need to get to it soon" do not. Never infer a hard deadline from a client/vendor/billing relationship alone, internal importance, emotional pressure, "I need to", "soon", or any urgency read with no dated third-party consequence. When Jordan says tasks come from his L10: due date = next L10 date (from memory), hard deadline = true; if the next L10 date is not on file, infer the most plausible date from context and flag the assumption in the receipt.
3. Effort estimate: assign a t-shirt size (S under 1 hour, M 1 to 4 hours, L half-day plus, XL multi-day) with `--effort` and state it in the receipt; Jordan corrects it if wrong. If the work looks XL, propose a split in the receipt.
4. Split check: 2 or more independent actions, owners, or due dates: propose a split in the receipt and link the pieces with `execos taskops dependency-add` once Jordan agrees.
5. Dependency check: note in the receipt whether this blocks or gets blocked by anything on the active board.
6. Delegation: decide whether Jordan should own this; consult the team roster context and, when the work looks delegable, state that recommendation in the receipt rather than blocking the create. Owner reassignment itself routes through `execos taskops delegate` after the create.
7. Batch mode: when multiple tasks arrive in one paste, run one composed hydrate (`taskops hydrate --op "create:<intent>" ...`, up to 8 work orders per call), read all the packets together, then run every create command in one chained shell invocation (separate commands with `;`, never `&&`, so one refusal cannot abort the rest), and finish with a single consolidated receipt summary table.

## Instructions
1. Verify the task Jordan wants to add is not a duplicate of an existing active task, using your own judgment per the Duplicate Check section. If it is an obvious duplicate, do NOT run the create command; act on the existing task and report it in the receipt summary. Present the side-by-side comparison only when genuinely uncertain.
2. If it is not a duplicate, generate and run the following command exactly:
   ```bash
   execos taskops create --title "<title>" --description "<description>" --category "<category>" --priority "<priority>" --due "<due_phrase>" --goal-id "<goal_id>" --effort "<S|M|L|XL>"
   ```
   *(The description must be at least one complete, informative sentence capturing all context and details Jordan provided; the CLI's technical floor is 10 characters. --category is required. --priority is explicit-only: include it only when Jordan signaled priority, mapped per the Intake Guidance; otherwise omit it. --due is optional: pass Jordan's due signal when there is one, otherwise omit it and the CLI defaults the due date to 3 business days out (soft) and flags it. Add `--hard-deadline` only when Jordan explicitly says it is a hard deadline, names an L10 task, or states a specific date on which a third party enforces a concrete consequence (e.g., suspension, late fee, filing window). Omit --effort only when no estimate was reached. Omit --owner, or pass `--owner me`; the CLI refuses any other value. To hand the task to a teammate, create it owned by me first, then run `execos taskops delegate`.)*
