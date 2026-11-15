# Operational Prompt: Task Management (Dependency Add)

## User Intent
{{intent}}

## Target Task

{{target_task}}

## Instructions
Run the direct mechanical mutation:

```bash
execos taskops dependency-add --task-id "{{task_id}}" --blocked-by "<blocking_task_id>"
```

This records that the target task is blocked by the named task, refuses dependency cycles, and notes the link on both tasks.
