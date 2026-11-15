# Template: Testing Postmortem & Execution Trace Report

This template serves as a standardized postmortem format to trace a testing scenario step by step, analyze unexpected results or friction, and pass structured details to a client agent for debugging.

***

# Postmortem & Execution Trace: [Scenario Name / Target Task or Feature]

Provide a brief, 2 to 3 sentence overview of the test scenario, the goal of the test, and the key anomaly or unexpected behavior observed.

## 1. User Input (Intent)

Paste the exact prompt, user instruction, or transcript segment that triggered the agent session:

```markdown
> "[Insert exact user prompt or message here]"
```

## 2. Execution Steps & Command Trace

Detail every command proposed, executed, or analyzed during the turn, along with the reasoning behind it:

### Step 1: [e.g., Hydration & Context Gathering]
* **Reasoning**: Explain why this command was run (e.g., checking active tasks, checking dependencies, validating current state).
* **Command**:
  ```bash
  [Insert exact command run, e.g., execos taskops hydrate --operation re-rank]
  ```
* **Key Output Data**:
  ```json
  [Insert key JSON fields, status outputs, or truncated stdout here]
  ```

### Step 2: [e.g., State Mutations / Writes]
* **Reasoning**: Explain the logic behind the write commands and how they map to the user's intent.
* **Command**:
  ```bash
  [Insert exact write command(s) run, e.g., execos taskops update --task-id KS-123 ...]
  ```
* **Key Output Data**:
  ```text
  [Insert command execution receipt or confirmation output here]
  ```

### Step 3: [e.g., Re-ranking / Queue Lock]
* **Reasoning**: Explain why the final queue lock or view update was necessary.
* **Command**:
  ```bash
  [Insert exact re-rank or display command, e.g., execos taskops re-rank ...]
  ```

## 3. Observed Outcomes & State Changes

Summarize the final state of the system after the execution steps completed:

* **Applied Changes**: List what successfully changed in the database or system state (e.g., updated due dates, delegated ownership, priority promotions).
* **Unchanged / Pending State**: List what remained open, unmodified, or queued (and why).

## 4. Root Cause Analysis (RCA) & System Friction

Explain the exact technical or conversational reason why the system behaved unexpectedly or failed to execute part of the user's instruction:

* **Identified Friction**: Describe the constraint or logic mismatch (e.g., a database check constraint, validation rules, or conversational guardrails).
* **Applicable Rules / Guidelines**: Cite the specific rule or protocol that governed this behavior (e.g., *"Rule AC-004: Completing a task requires explicit, in-turn confirmation; the agent cannot auto-complete on a past statement."*).
* **Impact**: Explain how this rule directly resulted in the observed state (e.g., why a task stayed open and got pulled into the active do-next queue).

## 5. Actionable Next Steps / Proposal for Client Agent

Provide clear, structured instructions and commands that the client agent (or developer) can run to resolve the issue:

* **Immediate Remediation**: The exact commands needed to align the state (e.g., the complete command to close the task).
* **System Correction**: If this is a bug or rule conflict, suggest the specific files, rules, or schemas to update.
