# 014 — Every CLI command is registered with accurate metadata

Status: RATIFIED — Calvin, 2026-06-10. New rule (no prior incident);
proposed by the architecture-enforcement plan.

## Statement

Every CLI command registered with Commander appears in
`architecture/registry.ts` with accurate metadata (`operation`, `status`,
`mutates`, `blocking`), and every registry entry corresponds to a real
command. Every Commander leaf also appears in both profiles' cli-help
SKILL.md.

## Context

The registry is the dual-purpose surface: machine-checked for completeness,
human-readable as the command inventory. It gives "deprecated", "mutates",
and "blocking" a place to be stated and checked, instead of living in agents'
heads. The June 2026 CLI audit (S422–S424) found stale doctrine referencing
removed flags and commands — exactly the drift a checked registry prevents.
Note: legacy task write stubs were fully deleted on 2026-06-10 (commit
41c2b16), so today no deprecated commands exist; the `status` field governs
how any future deprecation must behave.

## Enforcement

STRUCTURAL — `conventions: registry-completeness` (built 2026-06-10: walk the
Commander tree, diff against `registry.ts`) + existing
`test: cli-help-skill-map` (`tests/cli/cli-help-skill-map.test.ts`).
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Deriving the registry from code at runtime — rejected: metadata like
`mutates` and `blocking` are declarations of intent that must be reviewable,
not inferred.
