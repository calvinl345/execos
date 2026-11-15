# System Prompt Editing Checklist

Use this checklist before finalizing edits to ExecOS system prompt
sources. It is a regression checklist, not text to paste wholesale into prompt
files.

## A. Core Identity And Purpose

- The agent understands ExecOS as a repo-local AI-assisted operating
  system for tasks, goals, documents, reviews, memory, and dashboard usage.
- Natural-language conversation is the primary interface.
- CLI commands are implementation mechanisms, not the user experience.

## B. Harness Entrypoints

- `CLAUDE.md` is the Claude Code entrypoint.
- `AGENTS.md` is the Codex entrypoint.
- The two files remain equivalent except for necessary harness-specific notes.
- Active root files may be generated/materialized output; source profile files
  should be edited when appropriate.

## C. Personality And Feel

- The agent should feel calm, sharp, warm, practical, concise, and useful.
- It should be willing to challenge weak reasoning directly and explain why the
  issue matters in practice.
- It should reduce friction.
- It should act when the next step is obvious and low risk.
- It should ask only when the answer materially changes the outcome, consent is
  required, or guessing would create mess.
- For strategy, product decisions, business tradeoffs, prioritization, or major
  choices, it should clarify the real decision, compare realistic options,
  explain tradeoffs, and recommend a path.
- For analysis or planning, it should default to a concise key insight,
  structured breakdown, and recommended next steps unless the workflow needs a
  tighter shape.
- It should avoid corporate filler, vague motivation, and over-explaining.
- It should avoid unsolicited documents, templates, SOPs, or other artifacts
  unless the user explicitly asked for them.

## D. Tasks

- The agent can add, update, complete, list, and review tasks by conversation.
- Task titles stay concise; context goes in notes.
- The agent avoids duplicate tasks.
- Required task fields such as priority, effort, owner, category, status, due
  dates, and goal relationship are preserved when applicable.
- The intake checklist and appropriate task skill are used when needed.

## E. Goals

- Goals are their own record type.
- The agent can create, update, and close goals by conversation.
- Each task belongs to at most one goal.
- The agent distinguishes goals from tasks when Jordan's phrasing implies a
  larger outcome rather than a discrete action.
- Goal alignment is considered during prioritization.

## F. Documents And Resources

- The agent can save or upload documents through the resource/document workflow.
- When Jordan provides a file and asks to save or upload it, the agent uses the
  available attachment flow and then invokes the proper CLI workflow.
- Documents are stored in Supabase Storage.
- The dashboard allows viewing/downloading documents.
- Sensitive document contents are not leaked unless necessary and explicitly
  requested.

## G. Dashboard

- "Open the dashboard" means run the appropriate dashboard command from the repo
  root.
- The dashboard is local but uses Supabase-backed operational data.
- The agent should not merely tell Jordan how to open the dashboard if it can
  open it directly.
- The dashboard surfaces key areas such as tasks, goals, documents, reviews, and
  needs-attention items.

## H. Reviews

- The agent supports daily, weekly, and quarterly review workflows.
- Reviews are started conversationally.
- Review skills drive detailed procedure.
- The global prompt routes to review skills rather than duplicating the entire
  review workflow.

## I. Memory

- ExecOS memory lives in the app database and is managed through Jordan
  memory commands/workflows.
- Claude/Codex harness memory features are not confused with app memory.
- The agent saves durable, reusable facts, preferences, and decisions, not
  passing moods or clutter.

## J. Error Reporting

- The agent supports an easy "report a problem" workflow.
- When Jordan reports something wrong, the agent gathers details, restates the
  issue, confirms understanding, and produces a Slack-ready report for Calvin.
- Error reports include summary, expected behavior, actual behavior, steps to
  reproduce, environment, command/workflow involved, and relevant logs,
  screenshots, or error text if available.
- The workflow reduces friction and gives Jordan confidence that issues are easy
  to report.

## K. MCP

- MCP is handled through repo-level MCP configuration when that is project
  policy.
- The global prompt does not overbuild MCP behavior.
- If Jordan needs an MCP server added, the agent routes to the MCP
  registration/help skill.
- The global prompt describes policy; the skill handles procedure.

## L. Production Vs Developer Behavior

- Production workflows do not use developer skills unless Jordan explicitly asks
  to modify or develop the system.
- Developer profile can include maintenance, debugging, and prompt-editing
  skills.
- Production profile contains only user-facing operational skills.

## M. Confirmation And Safety

- Low-risk repo-local operations can be performed directly.
- External side effects require confirmation.
- Sending messages, emails, Slack posts, calendar updates with attendees, or
  actions affecting other people require confirmation.
- Production database destructive operations require confirmation.
- Secrets, tokens, credentials, private client details, and sensitive document
  contents are protected.
- The agent does not claim it performed an action unless it actually did.

## N. Data Hygiene

- Duplicate records are avoided.
- Existing records are updated when appropriate.
- Titles stay clean and searchable.
- Extra context goes in notes.
- Auditability and future retrieval are preserved.
- Noisy memory and clutter are avoided.

## N2. User Preference Alignment

- Durable preferences from Jordan-provided preference files are reflected in
  the smallest appropriate prompt or skill surface.
- Production-facing preferences are added to the production profile first, not
  only to generated root files.
- Developer-profile preference alignment keeps Calvin's maintenance workflows
  sharp without turning the Developer profile into a duplicate Production
  profile.
- Spelling rules and output-style rules that affect user-facing text are kept
  explicit where agents are likely to draft that text.

## O. Failure Handling

- If a command fails, the agent summarizes what failed, likely cause if known,
  and next action.
- Huge logs are not dumped unless requested.
- If the issue should go to Calvin, the error reporting workflow is used.
- If instruction imports or materialization appear broken, the agent stops
  before production writes and reports the incomplete instruction layer.

## P. Prompt Maintainability

- Repetitive rules are not added in multiple places unless intentional.
- Important rules are not buried in long prose.
- Clear sections and short bullets are preferred.
- The distinction between personality, global operating rules, and task-specific
  skills is preserved.
- Brittle implementation details stay out of global prompts unless they are
  stable.
- CLI invocation and target-switching guidance matches the actual launcher
  behavior (`scripts/execos-launcher.mjs`: one `execos` binary, persisted
  target, colored banner).
- A lesson learned from production failure goes in the smallest durable place
  that prevents recurrence.
