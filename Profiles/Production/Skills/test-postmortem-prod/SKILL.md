---
name: test-postmortem-prod
description: >-
  Use when the user requests a postmortem, execution trace, test report, or
  diagnostic summary after running a manual or automated test scenario against
  the application. Reads the postmortem template, traces all executed CLI
  commands and outputs, identifies system rules causing friction, saves the
  report to the docs/testing/ directory, and presents it to the user.
---

# Context

Testing and validating ExecOS features often involves executing multiple task mutations, checks, and queue re-rankings. When a test behaves unexpectedly or encounters system friction (such as guarded status changes or check constraints), a detailed trace is required. 

This skill provides a standard postmortem format to record the user's message, every command run (including hydration, write, and lock phases), the exact stdout/stderr responses, the root cause of any friction, and actionable next steps. This report can then be passed directly to a client agent to automatically analyze and fix the codebase.

# Workflow

Track progress through this workflow:

1. **Recognize intent.** Triggered when the user asks for a "postmortem", "execution trace", "test report", "diagnostic summary", or "trace what happened" following a test run.
2. **Read the template.** Read the template from `templates/test-postmortem-template.md` under this skill directory.
3. **Trace the execution.** Review the current conversation logs, command output buffers, and database status to gather:
   - The exact user message/prompt that initiated the test.
   - The sequence of commands executed (hydration, writes, and re-ranking).
   - The stdout/stderr output of each command.
   - Any database check violations or system rules that altered the expected flow (such as rule AC-004 for terminal status confirmations).
4. **Draft the report.** Fill in the template sections. Ensure all task IDs, titles, and command strings match the execution logs exactly. Do not use em-dashes or en-dashes in any part of the text; use commas, periods, colons, semicolons, or parentheses instead.
5. **Write the file.** Save the completed markdown report to `docs/testing/postmortem-[topic-or-id].md`. If requested, also save it in the conversation's active artifact directory.
6. **Report to the user.** Reference the generated file path, highlight the root cause of the friction, and state the exact next steps needed to remediate the system state.

# Gotchas

- **Do not invent trace data.** If a command's output was not saved or is missing, state that it was not captured rather than guessing.
- **Dashes rule.** Do not use em-dashes or en-dashes in the final markdown output or file content. Use standard hyphens only for task/goal IDs (e.g. KS-123).
- **Include specific rules.** Always cite the specific rule ID (e.g., AC-004, AC-073) or constraint name when analyzing friction.

# Final Verification

Before finishing, confirm:

1. The completed report is saved under `docs/testing/` with a descriptive filename.
2. Every CLI command run during the trace is listed with its exact parameters.
3. The root cause analysis explicitly explains why any expected status changes or updates did not occur.
4. No en-dashes or em-dashes exist in the final output.
