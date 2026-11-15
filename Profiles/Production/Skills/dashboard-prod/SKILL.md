---
name: dashboard-prod
description: Use when the user asks to open, show, launch, or bring up the ExecOS dashboard or board. Runs the dashboard CLI launcher and treats already-running dashboard reuse as success. Does not manage tasks, edit dashboard code, or run delivery smoke tests.
---

# Dashboard

Use this skill when the user asks to open, show, launch, or bring up the ExecOS dashboard, board, task board, or project board.

This skill opens the local web dashboard through the CLI. The CLI owns the OS-specific browser handoff. It also reuses an existing dashboard when possible, avoids accidental port hopping, binds to localhost, and opens the browser with the platform launcher for the current system.

Opening the dashboard is an execution request, not an advice request. When a shell tool is available in the installed checkout, run the CLI command immediately and keep chat minimal. Do not explain the dashboard architecture, narrate a plan, or tell Jordan to run the command manually unless the current agent runtime genuinely has no shell access or the CLI reports a browser handoff failure.

## OS Handling

Use the same command on Windows, macOS, and Linux:

```bash
execos dashboard start
```

The CLI is responsible for the platform differences:

- Windows: the launcher opens the URL through the Windows browser handoff.
- macOS: the launcher opens the URL with the platform `open` behavior.
- Linux: the launcher opens the URL with the platform desktop opener when available.

If the CLI cannot open the browser on the current system, it prints the local URL for the user. If the current agent is remote, headless, or sandboxed without shell access to Jordan's actual machine, state that the production runtime is incomplete for Jordan operations and that a local shell-capable agent session is required.

## Workflow

1. Recognize dashboard-open intent.
   - Examples: "open the dashboard", "show me the board", "bring up the dashboard", "open my Jordan board", "show the task dashboard".
   - This skill is for opening the dashboard only. Use the `tasks-prod` skill for task CRUD and planning.
2. From the project checkout, run:

   ```bash
   execos dashboard start
   ```

   This profile uses the repo-linked `execos` launcher, which loads `.env.production.local` consistently.
   On Windows the launcher detaches the server through the OS (WMI), so the dashboard survives after the agent session or sandbox that started it ends. No sandbox escalation is needed for persistence.
3. Treat these outputs as successful dashboard-open outcomes:
   - `Dashboard launched (pid ...)`
   - `Dashboard already running (pid ...)`

   If the CLI reports the port is held by a process that is not the ExecOS dashboard, that is a real error; relay it instead of retrying. `execos dashboard status` reports the current state without starting anything.
4. If the CLI reports `Open this URL manually`, tell the user the browser handoff failed and include the printed URL.
5. If dependencies are missing, tell the user to run `npm install` before trying again.

## Guardrails

- Do not run `npm run dev:web`, `vite`, `Start-Process`, `open`, `xdg-open`, browser tools, or manually open `localhost` yourself for this workflow. The CLI launcher must own the open operation so duplicate dashboards do not accumulate.
- Do not refuse to open the dashboard just because the OS is Windows, macOS, Linux, or a sandboxed shell. The question is whether this runtime has shell access to the installed checkout on the machine that should host the dashboard.
- In Codex Desktop, do not treat a normal sandboxed shell as durable enough for a background dashboard. Use sandbox escalation for `execos dashboard start` so the repo launcher can create a server that survives after the agent continues.
- Do not choose another port unless the user explicitly sets `EXECOS_DASHBOARD_PORT`.
- Do not use a machine IP address or network host. The dashboard is local-only unless a future delivery requirement changes that.
- Do not mark dashboard launcher work complete just because the command exists. Completion still depends on the project task's explicit acceptance criteria.
- If cleanup is blocked by an orphaned dashboard process, use `execos dashboard stop --force` from the checkout before recommending broad process-kill commands.
- Closing browser tabs does not stop the dashboard server. Use `execos dashboard stop` when the user asks to stop it.

## Final Verification

Before replying, confirm:

- The command used was `execos dashboard start`.
- The dashboard either launched, reused an existing PID, or reused the existing local dashboard URL.
- In Codex Desktop, `execos dashboard start` used sandbox escalation when a persistent background dashboard was required.
- No extra dev server was started on a new port.
