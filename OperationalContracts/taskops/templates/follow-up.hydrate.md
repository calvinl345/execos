# Operational Prompt: Task Management (Follow-up)

## User Intent
{{intent}}

## Target Task

{{target_task}}

### Current Description
{{target_description}}

## Recent Task Notes

{{notes}}

## Warnings
{{warnings}}

## Relevant Memories & Rules

{{memories}}

## Instructions
1. Record the delegate's update exactly enough that future follow-ups have context.
2. Choose the next follow-up date. If Jordan gives one, use it. Otherwise choose the next practical date and show it in the receipt.
3. Optionally revise due date or status when the delegate's update warrants it.
4. Run:
   ```bash
   execos taskops follow-up --task-id "{{task_id}}" --update "<delegate update>" --next "<next_follow_up_phrase>" [--due "<due_phrase>"] [--status "<triage|backlog|in_progress|blocked|review|done|cancelled>"]
   ```
5. If the warning says the follow-up is after the due date, ask Jordan whether the due date should move.
