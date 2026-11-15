# Operational Prompt: Task Management (Defer)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Run the direct mechanical mutation:

```bash
execos taskops defer --task-id "{{task_id}}" --until "<future_resurface_phrase>"
```

This only changes `follow_up_date` and records a defer activity.
