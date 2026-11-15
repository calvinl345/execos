# 016 — One business operation, one name, one canonical path

Status: RATIFIED — Calvin, 2026-06-10.

## Statement

A single business operation has exactly one name and one canonical path; the
appearance of a second name (or a parallel path) for the same operation is
drift and gets flagged, not accommodated.

## Context

The three-parallel-write-stacks failure behind change-008 began as naming
drift: `task create` and `taskops create` were two names for the same
operation, and their semantics diverged until one of them caused the KS-198
incident. This rule is the early-warning form of decision 003: it cannot be
fully automated (judging "same operation" needs a human), but it gives agents
and reviewers a named reason to stop a second path at proposal time.

## Enforcement

CONTEXTUAL — `context-only`. Partially covered by the funnel scan and
registry completeness (decisions 003, 014), which make a parallel *mutation*
path mechanically visible; the naming half stays judgment. Review trigger:
any new command, service operation, or skill verb that overlaps an existing
operation's meaning.

## Alternatives considered

Tagging registry entries with an `operation` key and failing on duplicates —
adopted in part: `registry.ts` carries `operation`, so duplicate names for one
operation are at least visible in one table.
