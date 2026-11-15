# Operational Prompt: Task Management (Complete)

## Target Task

{{target_task}}

## Relevant Memories & Rules

{{memories}}

## Instructions
1. Confirmation check (two-tier): if the user explicitly stated this task is done, that statement is the confirmation — run the command now, in this same turn, and offer note capture in the receipt afterward. If completion was inferred or ambiguous, ask "Mark {{task_id}} done? Anything to capture in notes?" and run the command only after the user confirms.
2. Run the completion command to mark this task done (`--yes` asserts the confirmation; add `--note` for any user-supplied note text):
   ```bash
   execos taskops complete --task-id "{{task_id}}" --yes
   ```

## Downstream Impact
Completing this task resolves dependencies that block other tasks. Newly unblocked work surfaces in the next review packet, so mention any obviously unblocked follow-on work to Jordan.
