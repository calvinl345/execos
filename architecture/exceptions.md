# Exceptions

> Known, tolerated violations of ratified rules. Checks allow listed entries
> explicitly (named exemptions referencing this file) — the rule itself is
> never weakened. Every entry requires Calvin's approval. AUDIT flags entries
> past their `migrate-by` date.

| Rule | Location | Reason grandfathered | Intended fate | Added |
| --- | --- | --- | --- | --- |
| R2 | `src/cli/commands/goal.ts`, `memory.ts`, `resource.ts` (`db.transaction(` call sites) | Goal, memory, and resource writes stay on their pre-change-008 paths until their operational contracts (`goalops`/`memoryops`/resource equivalent) are built; the funnel scan carries a shrink-only ratchet exemption for exactly these three files | migrate when each operational contract lands | 2026-06-10, approved by Calvin |
| R12 | Goal mutations (no goal activity types exist yet) | Goal activities have not been built; the audit rule applies to tasks only until they are | migrate when goal activities are built | 2026-06-10, approved by Calvin |
