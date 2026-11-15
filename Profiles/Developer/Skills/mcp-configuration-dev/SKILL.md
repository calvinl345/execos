---
name: mcp-configuration-dev
description: "Use when the user asks to add, inspect, update, remove, verify, or troubleshoot repo-local MCP server configuration for ExecOS. Focuses on Claude Code project .mcp.json first and Codex project .codex/config.toml when requested. Does not configure user-global MCP, hardcode secrets, or use already-configured servers for ordinary operations."
---

# Context

This skill helps configure MCP servers for the ExecOS checkout. The default path is Claude Code project-scoped MCP in `.mcp.json` at the repo root because it is local to this project, easy to inspect, and shareable with the checkout.

Codex project MCP configuration is secondary. Use `.codex/config.toml` only when the user asks for Codex or for both harnesses, and remember that Codex loads project-scoped config only after the project is trusted.

MCP servers can expose private data, run tools, and perform writes through the agent. Treat new servers as a trust and least-privilege decision, not just a config edit.

Because this is the Developer profile, it is acceptable to inspect upstream docs, compare harness behavior, update this skill when MCP conventions change, and add deeper Codex support later. Keep the first action practical: fix the project config, verify it, then improve guidance only when the request calls for it.

# Workflow

Track progress through this workflow.

1. **Identify the target harness.**
   - Default to Claude Code unless the user explicitly asks for Codex.
   - If the user asks for both, configure both `.mcp.json` and `.codex/config.toml`.
2. **Confirm project scope.**
   - For ExecOS, use repo-local project scope by default.
   - Claude Code project scope lives in `.mcp.json`.
   - Codex project scope lives in `.codex/config.toml` and requires a trusted project.
   - Do not configure local, user, or global scope unless Calvin explicitly asks.
3. **Gather server details.**
   - Server name.
   - Transport: prefer HTTP for remote servers, use stdio when needed, and use SSE only when HTTP is unavailable.
   - URL for HTTP or SSE.
   - Command and args for stdio.
   - Required environment variables and authentication method.
   - Whether OAuth is required.
   - Whether the server is trusted and whether it can perform write actions.
   - Prefer official MCP server docs when available. For unknown or third-party servers, give a short trust warning and ask for confirmation before editing.
4. **Protect secrets.**
   - Never put raw tokens, API keys, personal access tokens, passwords, or OAuth secrets into repo-tracked config.
   - Use environment variables such as `${GITHUB_PAT}` in `.mcp.json`.
   - For Codex HTTP bearer tokens, prefer `bearer_token_env_var = "GITHUB_PAT"`.
   - If docs or env examples need updates, add placeholder variable names only, not real values.
5. **Add or update Claude Code `.mcp.json`.**
   - Read the existing file first and preserve existing `mcpServers`.
   - Add, update, or remove only the requested server.
   - Keep JSON valid and formatted.
   - Use `mcpServers` at the top level.
   - For project-scoped CLI adds, use `claude mcp add --scope project`.
6. **Add or update Codex `.codex/config.toml` when requested.**
   - Read the existing file first and preserve unrelated config.
   - Create `.codex/` if needed.
   - Add, update, or remove only the requested `[mcp_servers.<name>]` table.
   - Keep TOML valid.
   - Mention that Codex must trust the project before project config loads.
7. **Verify the configuration.**
   - Claude Code: suggest or run `claude mcp list` and `claude mcp get SERVER_NAME`.
   - Claude Code UI: `/mcp` shows status and handles remote-server OAuth flows.
   - Reset project approvals with `claude mcp reset-project-choices` only when needed.
   - Codex: suggest or run `codex mcp list`; in the TUI, `/mcp` shows active servers.
   - If OAuth is required, send the user through the harness auth flow. Do not ask them to paste secrets into chat.
8. **Update supporting docs only when useful.**
   - If a normal Jordan integration needs env vars, update the repo's env examples or appropriate docs with placeholder names.
   - Keep docs short: purpose, env vars, verification command, and what Jordan should ask the agent after setup.
9. **Report the result.**
   - Include target harness, files changed, server name, transport type, required env vars, verification command, manual auth step, and trust or least-privilege caveats.

# Claude Code Reference

Common commands:

```bash
claude mcp list
claude mcp get SERVER_NAME
claude mcp remove SERVER_NAME
claude mcp reset-project-choices
```

Project-scoped HTTP server:

```bash
claude mcp add --transport http --scope project notion https://mcp.notion.com/mcp
```

Project `.mcp.json` examples:

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp"
    }
  }
}
```

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${GITHUB_PAT}"
      }
    }
  }
}
```

```json
{
  "mcpServers": {
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Claude Code expands environment variables in `.mcp.json` for `command`, `args`, `env`, `url`, and `headers`. Supported forms include `${VAR}` and `${VAR:-default}`.

For stdio CLI adds, remember the option ordering:

```bash
claude mcp add --transport stdio --scope project --env API_KEY=${API_KEY} server-name -- npx -y some-mcp-server
```

Claude flags such as `--transport`, `--env`, `--scope`, and `--header` go before the server name. The `--` separates Claude's MCP config flags from the server command and args.

# Codex Reference

Use this section only when Codex support is requested.

Codex user config usually lives at `~/.codex/config.toml`; Jordan project config should live at `.codex/config.toml` when project-scoped behavior is desired.

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
```

```toml
[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"
```

```toml
[mcp_servers.github]
url = "https://api.githubcopilot.com/mcp/"
bearer_token_env_var = "GITHUB_PAT"
```

Useful Codex options include:

```toml
startup_timeout_sec = 10
tool_timeout_sec = 60
enabled = true
required = false
enabled_tools = ["tool_a", "tool_b"]
disabled_tools = ["dangerous_tool"]
```

# Gotchas

- Do not add raw credentials to `.mcp.json`, `.codex/config.toml`, README files, or env examples.
- Do not switch to user-global MCP scope because it is convenient; project-local is the default for this repo.
- Do not add dangerous local stdio commands without explicit confirmation.
- Do not configure broad write access when read-only access would satisfy the request.
- Prefer official or trusted servers. Unknown third-party servers need a brief trust warning before editing.
- SSE is deprecated in Claude Code docs. Use it only when HTTP is unavailable.
- Existing `.mcp.json` entries may omit `type`; preserve unrelated existing servers unless the user asked for normalization.
- When a server is flaky, check syntax first, then harness discovery with `claude mcp get SERVER_NAME` or `codex mcp list`, then authentication, then transport-specific logs. Do not rewrite config repeatedly without a new signal.

# Final Verification

Before replying, confirm:

1. The target harness was Claude Code, Codex, or both, and the files changed match that target.
2. Project-scoped config was used unless Calvin explicitly requested another scope.
3. Existing unrelated MCP servers and TOML settings were preserved.
4. No raw secrets were written to repo-tracked files.
5. JSON or TOML syntax is valid.
6. Verification command output was checked, or the exact command and any manual OAuth step were reported.
7. The final response includes server name, transport, required env vars, files changed, trust caveat, and follow-up.
