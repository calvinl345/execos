# 013 — Profiles are the source of truth

Status: RATIFIED — Calvin, 2026-06-10. Amended in part by
[019](019-contracts-single-source.md) (2026-06-10): operational contracts
moved out of `Profiles/` to a single repo-root `OperationalContracts/`
source; this decision remains authoritative for skills and system prompts.

## Statement

`Profiles/<Profile>/` is the only authoritative copy of skills and system
prompts. Materialized copies (repo root, `.claude/skills/`,
`.agents/skills/`) are generated output, destroyed on the next
materialization.

## Context

Edits written into materialized copies are silently destroyed by
`scripts/installer/materialize.mjs apply-profile`, which has repeatedly cost
work and produced doctrine drift between what an agent reads and what the
profile says.

## Enforcement

STRUCTURAL — originally `conventions: profile-contract-parity` (built
2026-06-10: byte-compare the two profiles' contract trees; sabotage demo
red/green captured, see architecture/sabotage-demos.md). Retired by 019,
which replaced it with `conventions: contracts-single-source` after the
contract trees collapsed into one root-level source. Candidate extension
still open: compare materialized skills against the active profile source.

## Alternatives considered

Single shared contract directory instead of two copies — initially not
pursued (the profile split was assumed load-bearing and a parity check
cheaper than restructuring); adopted for contracts by 019 once it was clear
contracts never diverge by profile.
