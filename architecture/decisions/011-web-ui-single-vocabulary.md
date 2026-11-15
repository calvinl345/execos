# 011 — Web UI: one visual vocabulary, shared primitives, co-located dark mode

Status: RATIFIED — Calvin, 2026-06-10. Source: INV-W1–W4.

## Statement

Priority and flag visual vocabulary lives only in `flags.ts`
(`TASK_PRIORITY_META`, `TASK_FLAG_META`), rendered exclusively by
`PriorityIndicator.svelte`. Keyboard chips and icon action buttons render
through `Kbd.svelte` and `ActionButton.svelte`; no local `.kbd` or
`.action-button` styles. Dark mode is co-located Tailwind `dark:` variants;
`:global(.dark` selectors are forbidden. State is never encoded by color
alone, and no legend strips: meaning renders where the state appears.

## Context

By June 2026 the dashboard had four forms of styling drift: semantic colors
declared twice (PriorityBadge's private map had diverged from
`TASK_PRIORITY_META`), interaction primitives re-implemented per component,
dark mode as a ~60-line `:global(.dark)` remap that broke silently when
classes changed, and color-only 10px priority dots that forced a legend strip
above the board. A consolidation pass replaced all four. If a view seems to
need a legend, the in-place encoding is wrong; fix the encoding.

## Enforcement

STRUCTURAL — `conventions: priority-meta-single-source`,
`conventions: shared-interaction-primitives`,
`conventions: no-global-dark-remap` (built 2026-06-10; the dark-remap scan
expects zero matches for `:global(.dark` in `src/web/**/*.svelte`).
CONTEXTUAL — color-alone/no-legends is design review.
Sabotage demo: 2026-06-10, red/green captured (see architecture/sabotage-demos.md).

## Alternatives considered

Native `title` tooltips — rejected: cannot show formatted shortcuts,
uncontrollable OS delay. Bespoke scoped CSS as default — rejected: allowed
only where utilities cannot express the layout.
