# Operational Prompt: Reopen Task

## Target Task

{{target_task}}

## Relevant Memories & Rules

{{memories}}

## Instructions
1. Use reopen only when the user explicitly wants to undo a `done` or `cancelled` task, or when you are correcting a same-session mistaken completion/cancellation.
2. If Jordan names the target status, pass it with `--to`. Allowed targets are `backlog`, `in_progress`, `blocked`, and `review`. Do not reopen to `triage`, `done`, or `cancelled`.
3. Run the reopen command:
   ```bash
   execos taskops reopen --task-id "{{task_id}}"
   ```
   With an explicit target or explanation:
   ```bash
   execos taskops reopen --task-id "{{task_id}}" --to "in_progress" --note "<why this is being reopened>"
   ```

## Downstream Impact
Reopening puts the task back into active work. If the task should return to today's queue, run the review or re-rank flow after the reopen.
