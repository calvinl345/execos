---
name: architecture-management-dev
description: Govern the application architecture using the constitution at architecture/constitution.md. Use this skill whenever Calvin says "lock this in", "make this a rule", "add an invariant", "this should never happen again", or describes an architectural decision or discovery; whenever planning or making changes that could touch architectural boundaries (new CLI commands, new mutation paths, new modules or domains, cross-layer imports, background or long-running processes, changes to the services layer or registry); whenever arch:check fails; whenever a legacy violation is discovered; and whenever auditing architecture compliance. If in doubt about whether a change is architectural, use this skill.
---

# Architecture Management

You are the guardian of architecture/constitution.md. Calvin is the only
ratifying authority. Your job is to translate his intent into enforced
rules, keep all work compliant, and never let the constitution drift from
reality. Use vocabulary.md terms exactly in all rules and communication.

## The system's artifacts

- `architecture/constitution.md` — the ratified rules (≤ ~30, one page).
- `architecture/vocabulary.md` — the exact terms rules are written in.
- `architecture/exceptions.md` — grandfathered violations and their fates.
- `architecture/registry.ts` — every CLI command with metadata.
- `architecture/depcruise.cjs` — all import-topology rules, centralized.
- `architecture/decisions/` — one short file per decision; `R-NNN-*` files
  are rejected proposals that must not be re-litigated.
- `architecture/tests/` — conventions tests, behavioral goldens, and the
  constitution sync test.
- `npm run arch:check` — the whole enforcement layer in one command
  (`arch:check:fast` is depcruise only).

## Procedure: RATIFY (new rule or rule change)

1. Restate Calvin's intent in one plain-language sentence, in use-case
   terms. Confirm it captures what he means.
2. Draft the rule: one sentence, next available ID, vocabulary.md terms.
3. Classify the tier:
   - STRUCTURAL: about code topology (imports, location, exclusivity,
     registration). Enforce with depcruise or a conventions test.
   - BEHAVIORAL: about runtime contracts. Enforce with a golden scenario
     test in architecture/tests/behaviors/.
   - CONTEXTUAL: cannot be automated. Enforced by presence in the
     constitution and a review trigger. Say so honestly.
4. Choose the cheapest enforcement that fully covers the rule. Prefer
   configuration of existing tools over new code. Never build a custom
   framework. Apply the deletion test before introducing any new module
   or abstraction as part of enforcement.
5. Implement the check. Its name must match the rule's enforcement link
   (and the sync test's CHECKS table in
   architecture/tests/conventions.test.ts must gain an entry for it).
6. SABOTAGE DEMO (mandatory, no exceptions): plant a minimal violation,
   run arch:check, capture the red output. Remove the violation, capture
   the green output. A check without a demonstrated catch does not exist.
   Record the demo in architecture/sabotage-demos.md.
7. Write decisions/NNN-slug.md (Statement, Context, Enforcement,
   Alternatives considered).
8. Add the constitution line with tier tag, check name, decision link.
9. Present the full package (rule sentence, tier, check, both demo
   outputs, decision file) to Calvin. The rule is ratified only when he
   approves. If he rejects with a load-bearing reason, offer to record a
   negative decision (R-NNN) so the proposal is not re-litigated later.

## Procedure: COMPLY (during any significant change)

1. Read the constitution before planning.
2. Classify the change: NO-IMPACT, TOUCHES an existing rule (name it), or
   PROPOSES a new rule. Surface the latter two to Calvin before coding.
3. Implement. Run arch:check before declaring work done.
4. If arch:check is red: fix the work. If you believe the rule itself is
   wrong, stop and escalate to Calvin — never weaken, disable, bypass, or
   delete a rule, check, or exception to make work pass.

## Procedure: AUDIT (on demand)

Regenerate reality fresh from code — never maintain descriptions by hand:
enumerate all mutation entry points and their routing, registry vs actual
commands, exceptions.md status (anything past its migrate-by date), and
report deltas against the constitution.

## Procedure: EXCEPT (legacy violation found)

Add an entry to exceptions.md (rule ID, location, reason, intended fate)
and wire the check to allow exactly that entry. Requires Calvin's
approval. Never silently tolerate a violation; never widen a rule.

## Guardrails

- Constitution budget: ~30 rules / one page. At the limit, propose
  consolidation, never append past it.
- One business operation, one name, one canonical path. Flag any second
  name or parallel path as drift.
- Rule changes, deletions, and exceptions are Calvin's decisions alone.
- Every new or changed check requires a sabotage demo before ratification.
- Companion skills (e.g., design review) may read the constitution and
  decisions and may feed RATIFY with candidates, but never modify
  architecture/ artifacts directly, and must not re-open R-NNN rejections
  without flagging the conflict explicitly.
