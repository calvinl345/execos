# R-001 — REJECTED: route all reads through the services layer

Status: REJECTED — Calvin, 2026-06-10. Do not re-litigate without flagging
this record explicitly.

## Proposal

"Nothing in `src/cli` or `src/web` may import from `src/db` — all database
access goes through `src/services`," i.e. extend the write funnel to reads so
every query, not just every mutation, routes through a service operation.

## Reason rejected (load-bearing)

The write funnel exists to prevent write-semantics drift between surfaces
(KS-198 priority inference, terminal-confirmation asymmetry, the dead dedup
gate). Reads have no equivalent failure class: they cannot corrupt state and
need no transactions, WIP caps, confirmation, or audit. Specifically:

1. A read-forwarding service is pass-through plumbing — it fails the
   deletion test in vocabulary.md.
2. Where read policy genuinely exists, it already has one named home: the DB
   views (`v_eligible_for_prioritization`, `v_recent_wins`) and domain
   functions. The "one canonical answer" concern is solved without services.
3. The web read path is a security seam, not a shortcut: `src/web` reads the
   anon client under RLS (R3) while services run on the service-role client.
   Unifying reads would force client parameterization through every service
   or weaken the RLS boundary.
4. Measured cost: 38 direct-DB call sites across 6 command files plus the
   entire web query layer, for zero incident-class risk removed.

## Reopening condition

If a read-drift bug actually occurs (two surfaces disagreeing on the same
question, e.g. what counts as an open task), the failure-driven fix is a
narrow rule such as "policy-bearing reads live in views or domain functions"
— not a blanket services detour. Ratified rule R2 stands: the funnel
constrains writes; reads may query directly.
