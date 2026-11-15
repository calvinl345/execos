# Reference: what it means to fully design a feature (Architecture phase)

This guide defines the depth the Architecture phase must reach for each feature. It
is referenced by `phase_architecture.txt`. The Scope phase decides WHAT capabilities
exist; this phase decides exactly HOW each one behaves and how it is built. A feature
is "designed" only when someone could hand the description to a builder and there
would be no behavioral question left to a coin flip.

> Scope note: this guide covers capabilities with a USER-FACING surface. The broader
> requirement to specify exact behavior across every path and edge case is universal
> and applies to CLI/backend capabilities too (there it means the precise contract:
> inputs, outputs, error modes, side effects, idempotency). This guide adds the
> UI-specific dimensions on top of that universal behavioral depth.

## The core standard

For every capability named in Scope, write an Architecture item that specifies its
exact behavior, not a happy-path sketch. "It lets the user snooze a task" is a scope
statement, not a design. The design says what control appears, what it defaults to,
what the user picks, what gets written, what feedback appears, and what happens when
anything is unusual.

## For each feature, specify all of these

1. **Entry / trigger.** Where the action lives in the UI, how it is invoked (click,
   key, menu), and which items it is available on (and when it is hidden/disabled).
2. **The interaction.** The exact controls and inputs: what the user sees, the
   default value, what they can change, and the confirm/cancel affordances. For date
   actions, say whether it is a picker, presets, or natural language, and the default
   date.
3. **The success path.** Step by step: input -> validation -> what operation runs ->
   what changes in the data -> what the user sees afterward (the item moves/updates,
   a toast, the panel closes, focus returns somewhere).
4. **Every alternative and edge path**, not just the happy one (see checklist below).
5. **All visual states** of the affected UI: default, hover/focus, loading/in-flight,
   success, empty, error, disabled.
6. **Validation rules** and what an invalid attempt does (inline message, blocked
   submit, etc.).
7. **Feedback and reversibility.** What confirms success, whether the action can be
   undone or needs a confirm step (especially destructive actions), and how errors
   are surfaced without losing the user's input.
8. **Keyboard behavior.** How the action is reachable and operable via keyboard, and
   focus management before/after.
9. **Coherence.** Which existing components/patterns/design tokens it reuses so it
   matches the rest of the app rather than introducing a new style.

## Edge-case checklist (run this against every feature)

- Empty: no items, no value yet.
- Loading / in-flight: the action takes time; what shows; can the user double-submit?
- Failure: the operation errors (network, validation, RLS/permission denial). What
  the user sees; is their input preserved; is state rolled back?
- Stale / concurrent: the underlying data changed (agent or another device) since the
  page loaded; what happens when the user acts on a stale item.
- Boundary values: dates in the past or far future; very long text; missing owner;
  terminal/closed items.
- Cancel / undo: the user backs out mid-action.
- Destructive actions: require confirmation; state what is lost.

## User paths, not just the user

Enumerate the realistic paths, not only "the user succeeds": the user cancels, the
user mis-inputs, the user acts on stale data, the user drives entirely by keyboard,
the agent performs the same action (parity), two actions race. Each path that is not
obvious gets a sentence in the design item.

## Output

The Architecture items should carry this detail in their bodies. If a feature's
design is only a happy-path sentence, the EXIT CHECKLIST box for "exact behavior
across all user paths and edge cases" is NOT satisfied, and the phase is not ready.
