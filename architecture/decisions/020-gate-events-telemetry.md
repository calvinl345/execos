# 020 — `gate_events` is append-only telemetry

Status: RATIFIED — Calvin, 2026-06-10 (rule R26; shape chosen over an R12
amendment so R12 stays about user-facing timeline completeness and telemetry
immutability stands as its own structural invariant, matching the R10
precedent).

## Statement

No UPDATE or DELETE against `gate_events` anywhere in `src/`; all writes route
through `appendGateEvent()`.

## Context

`gate_events` records gate decisions (blocked, overridden, warned, skipped)
across the task write funnel: dedup, owner_not_self, owner_follow_up,
owner_resolution, wip_cap, status_transition, terminal_confirmation, and
dependency_cycle. Overrides carry a mandatory justification; dedup events
carry an `input_fingerprint` (hash of the normalized title + description,
sharing `normalizeForExactMatch` with the gate itself) so blocked attempts and
their later overrides correlate server-side without relying on agent ordering.
The data exists to audit why something was refused or forced through and to
tune validators over time; it is trustworthy only if it cannot be rewritten.

Operating principles recorded here (enforced by tests outside the named scan):
a clean gate pass writes nothing; events tied to a successful write insert in
the same transaction (savepoint-guarded); blocked-path inserts are best-effort
and may never turn a clean refusal into a crash or block a legitimate write;
hydrate-time previews are not decisions and are never logged.

## Enforcement

STRUCTURAL — `test: gate-events append-only scan`
(`tests/db/append-only-scan.test.ts`, source scan: no update/delete of
`gateEvents`, and only `src/db/helpers/gate-events.ts` inserts). Runs in
`arch:check`. Sabotage demo: 2026-06-10, red/green captured (see
architecture/sabotage-demos.md).

## Alternatives considered

Amending R12 to absorb gate events — rejected: it would mix a BEHAVIORAL audit
contract with a STRUCTURAL append-only constraint. Postgres-level enforcement
— deferred to the install-time role split, same as R10.
