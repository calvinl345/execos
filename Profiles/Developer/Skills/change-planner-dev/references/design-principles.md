# Reference: software design principles (Architecture and Tasks phases)

Principles the plan must respect BEFORE any build workflow is compiled. The point of
enforcing them here is that the planning phases are where the user is still in the
loop and can correct course; once a workflow is compiled and executed, the design is
locked in. During Architecture, design to these principles and capture any item that
violates them as something to fix. During Tasks, make sure each task's pseudocode and
interfaces uphold them. Maintain this file as we adopt more principles.

## Deep modules, simple interfaces (Ousterhout)

A module should offer powerful functionality behind a small, simple interface. The
best modules are "deep": large implementation, narrow interface. Avoid "shallow"
modules whose interface is nearly as complex as their implementation (thin wrappers,
pass-through layers, classes that just shuffle data). When designing a component, ask:
is the interface smaller than the implementation it hides? If not, rethink the
boundary.

- **Information hiding.** Each module hides a design decision behind its interface;
  callers do not depend on its internals. Leaking internals (config, formats, order)
  through the interface is a smell.
- **Pull complexity downward.** It is better for the module to absorb complexity than
  to push it onto every caller. A slightly harder implementation that yields a simpler
  interface is usually the right trade.
- **General-purpose enough.** Prefer interfaces that are somewhat general over ones
  hyper-specialized to one caller, without speculative over-generality (YAGNI).

## Avoid exception masking

Do not catch-and-swallow errors, degrade silently, or return a fake "ok" on failure.
Masked exceptions hide real problems and make failures undebuggable. Instead:

- Let errors surface to where they can be handled meaningfully; do not bury them in a
  bare `catch {}` or a default value.
- Prefer to "define errors out of existence" (design APIs so the error case cannot
  arise) over catching and ignoring them, but NEVER hide an error that can still occur.
- When you do catch, either handle it fully or rethrow with context. Log-and-continue
  is only acceptable for genuinely optional side effects, and say so explicitly.
- This codebase routes failures through a single error classifier with stable exit
  codes; new code should fit that, not invent silent fallbacks.

## A few more that carry weight

- **Single source of truth.** One authoritative place for each fact/decision; do not
  duplicate logic or data that can drift. Reuse existing helpers over re-implementing.
- **Smallest safe blast radius.** Prefer the change that touches the least, respects
  existing contracts, and does not break callers. Note any contract you must change.
- **Consistency.** Follow the patterns already in the codebase (see
  global-invariants.md) rather than introducing a parallel way of doing the same thing.
- **Comments explain WHY.** Capture intent and non-obvious reasoning, not a restatement
  of the code. Design rationale belongs in the item body or the comment, not nowhere.
- **No dead or speculative code.** Build what the scope needs; do not add unused
  generality. (Balances against deep modules: deep, not speculative.)

## How to apply this

- Architecture: every A# design decision should be defensible against these. If a
  design forces a shallow module, a leaked internal, or a swallowed error, that is a
  finding to resolve, not ship.
- Tasks: each task's pseudocode and the interfaces it introduces must uphold these. A
  task that adds a thin pass-through or a bare catch is not ready.
