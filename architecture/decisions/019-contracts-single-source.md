# 019 — Operational contracts have one root-level source

Status: RATIFIED — Calvin, 2026-06-10. Amends [013](013-profiles-source-of-truth.md):
adopts the "single shared contract directory" alternative that 013 originally
declined, for contracts only. 013 remains authoritative for skills and system
prompts.

## Statement

The repo-root `OperationalContracts/` directory is the only authoritative
copy of operational contracts (`contract.yaml` plus hydrate and receipt
templates per command family). The CLI loads contracts from this directory
directly at runtime — there is no materialization step and no
`.operational-contracts/` runtime copy. No `Profiles/<Profile>/OperationalContracts`
tree may exist.

## Context

Contracts were previously duplicated byte-identically under both profiles
(enforced by `conventions: profile-contract-parity`) and projected to a
gitignored `.operational-contracts/` runtime dir by the installer. Contracts
never diverge by profile — they define the task semantics both agent
populations must share (INV-T7) — so the duplicate copy plus parity test was
pure maintenance liability, and the materialized runtime copy added a footgun:
template edits silently did nothing until re-materialization. One tracked
source loaded directly makes parity true by construction and edits effective
immediately.

## Enforcement

STRUCTURAL — `conventions: contracts-single-source` (built 2026-06-10: assert
the root `OperationalContracts/taskops/contract.yaml` exists and no profile
carries an `OperationalContracts` tree). Replaces
`conventions: profile-contract-parity`, retired with this decision.
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

- Keep the two byte-identical profile copies plus the parity check (the 013
  status quo) — rejected: the duplication serves no divergence need and the
  parity test only detects drift instead of making it impossible.
- Single source under `Profiles/Shared/` with profile overlay in the
  installer — rejected: an overlay engine adds merge precedence and cleanup
  edge cases to enable exactly the per-profile divergence the invariant
  forbids.
- Single root source still materialized to `.operational-contracts/` —
  rejected: preserves a pointless copy step and the stale-copy footgun for
  zero benefit.
