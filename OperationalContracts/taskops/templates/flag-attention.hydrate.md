# Operational Prompt: Task Management (Flag Attention)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Run the direct mechanical mutation:

```bash
execos taskops flag-attention --task-id "{{task_id}}" --reason "<reason>"
```

This sets the needs-attention flag on the task and records the reason. `--reason` is required.
