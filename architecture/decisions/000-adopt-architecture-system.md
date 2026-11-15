# 000 — This system is the canonical architecture governance mechanism

Status: RATIFIED — Calvin, 2026-06-10. Executed same day: keystone-dev
deleted, `docs/architecture/` removed entirely (content absorbed; history in
git), and the comprehensive Developer-profile CLAUDE.md/AGENTS.md rewrite
landed (constitution import, write-funnel and registry orientation, target
launcher, architecture gate). All supersession actions are complete.

## Statement

`architecture/` (constitution, vocabulary, exceptions, registry, decisions,
enforcement checks) is the single canonical system for architectural
governance. Rules enter and leave only through Calvin's ratification (the
RATIFY procedure); compliance is mechanical via `arch:check`.

## Context

Prior to this system, architectural knowledge lived in loose docs
(`docs/architecture/`), agent doctrine, and the keystone-dev skill — an
older, partial version of the same idea (persistent alignment memory under
`.keystones/`). Two canonical systems for one job is exactly the drift this
constitution exists to prevent (one operation, one name, one path).

Supersession actions, directed by Calvin 2026-06-10, to execute at landing:

1. **Deprecate or delete the keystone-dev skill**
   (`Profiles/Developer/Skills/keystone-dev/`) — this system replaces it.
   Removal follows the skill-design-dev process and re-materialization.
2. **Rewrite the Developer profile system prompts** (CLAUDE.md and AGENTS.md
   under `Profiles/Developer/System Prompts/`) to reflect the landed system:
   the constitution import, the architecture-management skill routing, and
   removal of any guidance the constitution now owns (kept at CLAUDE/AGENTS
   parity per system-prompt-editing-dev).
3. `docs/architecture/` retires to a pointer README (already in the plan,
   Phase 2 step 5).

## Enforcement

CONTEXTUAL — `context-only`. This is a meta-decision about where rules live;
the constitution sync test enforces its consequences.

## Alternatives considered

Keeping keystone-dev alongside as a lighter-weight planning tool — rejected
by Calvin: it is an old version of a similar system, and this is the new
canonical one.
