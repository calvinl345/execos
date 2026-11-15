# Operational Prompt: Task Management (Cancel)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Cancelling is a terminal status change with two-tier confirmation: if the user explicitly said to cancel or drop this task, that statement is the confirmation — run the command now. If cancellation was inferred or ambiguous (casual "kill it" sometimes means deprioritize), confirm first and capture the reason. Then run:

```bash
execos taskops cancel --task-id "{{task_id}}" --yes
```

The `--yes` flag is required for terminal transitions. This transitions the task to cancelled and logs the change.
