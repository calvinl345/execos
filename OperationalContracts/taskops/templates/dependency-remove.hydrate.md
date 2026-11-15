# Operational Prompt: Task Management (Dependency Remove)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Run the direct mechanical mutation:

```bash
execos taskops dependency-remove --task-id "{{task_id}}" --blocked-by "<blocking_task_id>"
```

This removes the blocked-by link between the two tasks and notes the removal on both tasks.
