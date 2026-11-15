# 015 — Test-only exports never ship

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

Symbols named `_*ForTest` (e.g. `_getRegisteredProbeForTest`) are never
imported anywhere under `src/`; they exist for `tests/**` only.

## Context

Some modules expose hooks to introspect or reset module-private state for
tests. If production code ever imported one, test scaffolding would become
load-bearing runtime behavior. The naming convention plus an import ban keeps
the escape hatch from becoming a doorway.

## Enforcement

STRUCTURAL — `eslint: no-restricted-imports (test-only exports)` (exists in
`.eslintrc.json`). This is a symbol-name rule, not module topology, so it
stays in ESLint rather than moving to dependency-cruiser; the Phase 1
constitution sync test accounts for it. Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Separate test-utils modules instead of in-module hooks — heavier; the hooks
exist precisely to reach module-private state.
