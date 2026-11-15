# Operational Prompt: Task Management (Unflag Attention)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Run the direct mechanical mutation:

```bash
execos taskops unflag-attention --task-id "{{task_id}}"
```

This clears the needs-attention flag on the task and records the change.
