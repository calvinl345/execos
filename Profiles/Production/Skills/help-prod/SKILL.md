---
name: help-prod
description: >-
  Use only when Jordan clearly asks for help understanding what Jordan Daily
  OS can do, asks "what can I do?", asks for a list of available workflows,
  or uses /help. Print a polished, sectioned Markdown help guide that lists
  ONLY capabilities that are actually built and configured right now. Do not
  trigger for ordinary task-specific help such as "help me finish KS-123",
  "help draft this email", or any request where Jordan already named the
  workflow he wants.
---

# Context

This skill is the on-demand capabilities guide for ExecOS. It answers
"what can I do here?" with a concise, sectioned Markdown reference grounded in
what is **actually built and configured today**, not aspirational features.

Do not run shell commands for the help output itself. You may need to read
`.mcp.json` once to render the live MCP section accurately.

# Workflow

1. Confirm Jordan is asking for a capabilities guide, not for help with a
   specific task, document, review, memory, or bug.
2. Read `.mcp.json` at the repo root to get the current set of configured MCP
   servers. Filter the list using the rules in **MCP Filtering** below.
3. Print the guide using the **Help Guide Shape** below. Keep section
   ordering, headers, and emoji prefixes stable so Jordan can scan it the
   same way each time.
4. End with a one-line invitation. No long explanation.

# MCP Filtering

The MCP section must reflect what is actually configured in `.mcp.json` AND
relevant to a production user. Apply these rules:

- **Include** servers that Jordan would use directly during normal operation
  (mail, calendar, chat, notes, ticketing, CRM, storage, search). Examples
  of user-facing servers: `superhuman-mail`, `gmail`, `google-calendar`,
  `slack`, `notion`, `linear`, `github` (when used for issue triage), CRM
  connectors, and similar.
- **Exclude** developer-only or framework-tooling servers that exist to help
  build or maintain the system itself. Known developer-only servers to
  exclude: `svelte`, `playwright`, `puppeteer`, `chrome-devtools`, lint or
  codegen helpers, MCP registries used during development. When in doubt
  about a new server, exclude it from the production help unless its purpose
  is clearly user-facing.
- If `.mcp.json` is missing or no user-facing servers are configured, render
  the MCP table with a single italic row: `_No user-facing MCP servers
  configured yet._` Then keep the "add or change" line.

Never invent servers that are not in `.mcp.json`. Never mention dev-only
servers in production help, even if they are configured.

# Skill / Workflow Filtering

Only mention capabilities that have a working production skill or a working
CLI command in the current repo. Never mention developer-only skills (for
example, anything that exists only under a developer profile, or
`skill-design-prod`-style maintenance flows). Never mention features that are
not implemented yet (for example, do not promise inbox triage, Slack
handoffs, or Notion decision-log sync as standalone capabilities unless those
flows actually exist in the production profile).

# Help Guide Shape

Render the response in this exact section order. Adjust wording lightly for
the conversation, but keep the section headers, table columns, and ordering
stable.

```markdown
## ExecOS Help

### 🗂️ Daily Operations

| What | Try saying |
| --- | --- |
| **Tasks**: capture, update, prioritize, flag, complete, link to goals | "Add a task to call Cedar & Co.", "Mark KS-001 done", "Flag KS-001" |
| **Goals**: create, update, link tasks, close achieved/dropped | "Add a Q2 goal...", "Link KS-001 to G-001", "Close G-001" |
| **Memory**: save scoped facts, recall by query, list, soft-forget | "Remember that I prefer mornings", "What do you remember about Cedar & Co.?" |
| **Documents**: upload local files, categorize, link to tasks | "Save this document", "Attach this PDF to KS-001" |

### 📅 Reviews

| When | Try saying |
| --- | --- |
| **Morning / Daily**: top priorities, Needs Attention, schedule | "Run my morning review", "What should I work on?" |
| **End of Day**: shipped, status changes, tomorrow's focus | "Close out the day", "EOD review" |
| **Weekly**: at-risk work, goal progress, next-week focus | "Weekly review" |
| **Quarterly**: goal progress, candidate updates and closures | "Quarterly review" |

### 📊 Dashboard

Local read-only board at **http://localhost:3737**: tasks, goals, documents, reviews, Needs Attention.

| Action | Try saying |
| --- | --- |
| Open / launch | "Open the dashboard", "Show me the board" |
| Stop the server | "Stop the dashboard" |

Notes: loopback-only (`127.0.0.1`), reuses an already-running instance, and stays running until you ask to stop it.

### 🔌 MCP Servers (configured right now)

| Server | What it does |
| --- | --- |
| **<name from .mcp.json>** | <one-line user-facing description> |

To add or change MCP servers, say "add the GitHub MCP server" or "check MCP config".

### 🐞 Feedback & System

| What | Try saying |
| --- | --- |
| **Report a bug or feature request**: files a GitHub issue for Calvin | "Report a bug", "This is annoying", "I wish it would..." |
| **Health check**: Supabase, embeddings, MCP probes | "Run the health check" |

---

Pick any of those in plain English and I'll run it.
```

# Guardrails

- Do not trigger when Jordan says "help me" followed by a concrete workflow
  or deliverable. Route that to the owning workflow instead.
- Do not treat a bug report or feature request as a help request just
  because Jordan asks "can you help fix...". Use the report/fix routing.
- Do not list internal CLI flag combinations. Describe user-facing
  capabilities and example phrasings.
- Do not include capabilities, skills, or MCP servers that are not actually
  available in the current production profile.
- Keep the answer sectioned with Markdown tables. Avoid paragraph-only
  explanations.

# Final Verification

Before replying, confirm:

- Jordan genuinely asked for a capabilities guide.
- Section order matches the shape above (Daily Ops → Reviews → Dashboard →
  MCP → Feedback & System).
- The MCP table reflects the live `.mcp.json` after applying the dev-only
  exclusion rule. No dev-only servers leaked through.
- No aspirational or unimplemented capabilities are listed.
