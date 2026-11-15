# 001 — Domain purity

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

`src/domain` is pure: it imports nothing from `db`, `cli`, `web`,
`embeddings`, or `services`, performs no I/O, and receives `Settings` as a
parameter instead of loading it.

## Context

The domain layer (validation, prioritization formula, status-transition
matrix, intake parsing, dedup, retrieval) is the part of the system that must
be testable without infrastructure and reusable from any surface. Purity is
asserted in CLAUDE.md today but nothing mechanically enforces it; one stray
import would silently couple business logic to Postgres or the CLI. The
settings rule is the same idea applied to configuration: domain functions take
`Settings` as an argument (loaded once per process by the CLI settings
loader), so behavior stays deterministic and injectable.

## Enforcement

STRUCTURAL — `depcruise: domain-is-pure` (built 2026-06-10).
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

ESLint `no-restricted-imports` per-directory: workable but topology rules are
being centralized in dependency-cruiser so they live in exactly one file.
