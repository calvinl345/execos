# 006 — The duplicate gate is CLI-enforced and scoped to open tasks

Status: RATIFIED — Calvin, 2026-06-10. Ratified in substance by
Calvin on 2026-06-09 as change-008 decision D4. Amended 2026-06-10
(feedback batch W4): exact title/description matching, evidence-tier
band rename, justified override.

## Statement

`createTaskOperation` runs two checks against OPEN tasks only. First,
a normalized exact match: the draft's title or description, after
casefolding, trimming, and collapsing internal whitespace runs (nothing
else), exactly matching any open task's same field — per-field, never
cross-field — refuses the create. The exact check queries open tasks
WITHOUT the embedding filter (null-embedding rows participate) and runs
even when `embed()` fails. Second, embedding similarity: the draft is
embedded (title + description, once) and scored by cosine against open
tasks with stored vectors; any band at or above the threshold refuses
the create, listing matches.

Matches carry evidence-tier bands — `exact` (with
`matched_on: title | description | both`), `near_identical` (>= 0.92),
`similar` (>= threshold, default 0.85). Bands describe evidence
strength; the agent owns the duplicate decision.

`--allow-duplicate "<justification>"` overrides a refusal; the
justification is mandatory (empty or whitespace-only is rejected) and is
recorded in the intake audit note alongside the `overridden:<id>` marker
and surfaced in the receipt's dedup section. If `embed()` fails the
create proceeds with a null embedding and a warning: capture is never
blocked by the embedding provider, and the exact-match check still runs.

## Context

The previous intake path passed `candidates: []`, so the gate compared
against nothing and never fired. Restricting candidates to open tasks
means closed historical tasks can never drive false positives. Each
accepted create stores its vector, so the gate strengthens with every
task. Thresholds reuse the memory-policy dedup bands (0.85 threshold,
0.92 near-identical). The create hydrate packet previews the same
similarity gate via `{{dedup_matches}}` — never a different check.

The W4 amendment closed two gaps: literal re-captures whose embeddings
happened to score under the threshold (or whose stored embedding was
null after an outage) sailed through, and the boolean override let an
agent bypass the gate without stating why. The old band names
(`merge_only`, `prompt_keep_or_merge`) read as instructions; the rename
to evidence tiers records that the agent decides — acting unprompted on
obvious duplicates and consulting Jordan only under genuine uncertainty.

## Enforcement

BEHAVIORAL — `test: dedup goldens` (incl. closed-tasks-never-candidates,
exact-match refusal, and outage-time exact refusal) in
`tests/services/task-operations.test.ts`; live pgvector path in the DB
tier. Sabotage demos: 2026-06-10, red/green captured twice (original
gate and W4 exact-match amendment; see architecture/sabotage-demos.md).

## Alternatives considered

Comparing against all historical tasks — rejected: closed-task false
positives. Blocking capture on embedding failure — rejected: capture
availability outranks dedup. Fuzzy/stemmed exact matching — rejected:
substantive edits must always count as different work; case and
whitespace are the only differences a person would call "the same
text". Keeping the boolean override — rejected: justification must be
structurally impossible to omit.
