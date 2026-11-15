# 010 — Dashboard lifecycle: discovered, decoupled, loopback-only

Status: RATIFIED — Calvin, 2026-06-10. Source: INV-D1–D5.

## Statement

The running dashboard is discovered through its `/api/health` endpoint
answering with the shared app id (`DASHBOARD_APP_ID`) and its own pid;
launcher bookkeeping never overrides what the endpoint reports. Agent-invoked
commands are non-blocking: `dashboard start` returns the terminal promptly and
the server's lifetime is decoupled from its creator, with no idle shutdown.
The dashboard binds `127.0.0.1` only.

## Context

The dashboard repeatedly died when the session that launched it ended, and
orphaned servers accumulated because the launcher tracked a wrapper process's
pid instead of the server's. An idle-timeout "fix" killed the server under the
user and was reverted. Corrected ownership model: the port listener is the
source of truth (INV-D1); only the serving process writes the pidfile, as a
fallback hint for `stop` (INV-D2); on Windows the server is spawned via WMI so
it survives its creator (INV-D3); only the OS port bind proves single
instance — a foreign process on the port is an error to surface, never to
kill or port-hop around (INV-D4); loopback only (INV-D5).

## Enforcement

BEHAVIORAL — `test: dashboard-launcher health discovery`
(`tests/cli/dashboard-launcher.test.ts`, partial: health parsing) +
`behaviors: dashboard-start-non-blocking` (built 2026-06-10).
STRUCTURAL — `conventions: dashboard-loopback-only` (built 2026-06-10).
Pidfile ownership and single-instance-by-bind remain context carried by this
decision, not standalone constitution rules. Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Idle shutdown for resource saving — rejected by incident: lifetime-by-timer
killed the server under the user. Launcher pid bookkeeping as truth —
rejected by incident: it orphaned servers.
