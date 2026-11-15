# Operational Prompt: Task Management (Delegate)

## User Intent
{{intent}}

## Target Task

{{target_task}}

### Current Description
{{target_description}}

## Team Owner Candidates

{{owner_candidates}}

## Resolved Owner Open Tasks

{{owner_open_tasks}}

## Default Follow-up Date
{{default_follow_up}}

## Warnings
{{warnings}}

## Relevant Memories & Rules

{{memories}}

## Instructions
1. Resolve the responsible person to a team-table slug. If no candidate fits, ask Jordan which team member to use before writing.
2. Choose the follow-up date. Use Jordan's requested date when provided; otherwise use the default above and mention it in the receipt.
3. Run:
   ```bash
   execos taskops delegate --task-id "{{task_id}}" --owner "<team_slug>" [--follow-up "<follow_up_phrase>"] [--due "<due_phrase>"] [--notes "<context>"]
   ```
4. If the warning says the follow-up is after the due date, ask Jordan whether the due date should move.
