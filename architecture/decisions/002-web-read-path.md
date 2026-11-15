# 002 — Web read path uses the anon client only

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

`src/web` never touches the service-role DB client; it reads through the anon
client under RLS only.

## Context

The dashboard is a read surface (plus the audited action endpoint, see
decision 003). The service-role client bypasses RLS entirely; if any web code
imported it, a browser-facing route could silently gain unrestricted write
access. Read-only enforcement belongs at the Postgres layer (RLS), with the
import restriction guaranteeing web code cannot reach the bypass client.

## Enforcement

STRUCTURAL — `depcruise: web-anon-client-only` (built 2026-06-10) for `.ts`
files, plus the ESLint `no-restricted-imports` web override for `.svelte`
files (dependency-cruiser does not parse Svelte). Sabotage demo: 2026-06-10,
red/green captured (see architecture/sabotage-demos.md).

Phase 1 finding: the original ESLint guard was dead for `.ts` files — a later
`src/**/*.ts` override replaced (not merged) its `no-restricted-imports`
options, and the pattern group lacked the `**/db/index.js` form NodeNext
imports actually use. Both fixed 2026-06-10; the depcruise rule now covers
the `.ts` half independently, so either tool alone catches a violation.

## Alternatives considered

ESLint only: disproven — the override-merge hazard silently disabled it once
already. Two independent layers are deliberate.
