# 022 — bits-ui is the web UI component library

Status: RATIFIED — Calvin, 2026-06-11. Source: the June 2026 Bits UI
migration (ISS-003 and migrations 2–7 on `feat/unified-launcher-sandbox`).

## Statement

`bits-ui` is the only UI component library in `src/web`. It stays a direct
dependency, no competing component or headless-primitive library is
installed or imported, and new interactive primitives (menus, dialogs,
popovers, tooltips, comboboxes, pickers) reach for the Bits primitive
before hand-rolling positioning, dismissal, or focus management. Bits is
headless: the R18–R21 visual vocabulary is unaffected, and Bits adoption
happens inside the shared primitives (R19: Kbd, ActionButton), never
around them.

## Context

By mid-June 2026 the dashboard hand-rolled every floating and overlay
behavior: six dropdown surfaces independently implemented click-outside
dismissal, Escape handling, and positioning; modals tracked their own focus
and backdrop logic; the delegate owner picker was a fully hand-built ARIA
combobox; tooltips computed fixed positions from `getBoundingClientRect`.
That mass of duplicated primitive code produced real bugs (the ISS-003
stuck-checkmark date input, Escape fall-through between layered surfaces,
clipped and drifting menus). An incremental migration replaced each
category with Bits UI 2.x primitives, audited per category against frozen
behavioral contracts.

### Migrated manifest (categories complete as of ratification)

| Category | Bits primitives | Surfaces |
| --- | --- | --- |
| Date/Time Picker | Date Picker, Date Field, Time Field, Calendar | `DateTimePicker.svelte` (replaced NLDateInput) used by Snooze, Delegate, RecordFollowUp forms |
| Dropdown Menu | Dropdown Menu (checkbox/radio items, submenus) | FilterBar ×5, GoalsFilterBar ×2, ResourcesFilterBar, InboxView sort menu, TaskPromptMenu (Sub flyouts) |
| Dialog | Dialog | ActionModal, ShortcutsOverlay |
| Popover | Popover | BoardSettingsMenu |
| Combobox | Combobox | DelegateForm owner picker |
| Tooltip | Tooltip (Provider per instance) | ActionButton (internal, per R19) |

### Stays custom — no Bits equivalent or wrong fit

- **Search inputs** (FilterBar, ResourcesFilterBar): no plain search-field
  primitive in Bits; Command/Combobox are for suggestion lists.
- **TaskListView**: no table primitive; column sort, drag-reorder, and
  resize stay custom.
- **Drawers** (TaskDetailDrawer, GoalDetailDrawer): URL-driven, resizable,
  non-modal side panels; Bits Dialog is a poor fit for resize +
  persistent-state behavior.
- **Layout/domain components and presentational primitives** (boards,
  cards, Header nav, Kbd, PriorityIndicator, IdBadge, CopySlackButton).
- **Ride-along tier deliberately not migrated** (ViewToggle, outcome
  radios, native checkboxes, sync-due-date toggles): plain native controls
  with no floating behavior; migrating them is churn with regression risk
  and no functional gain. Migrate opportunistically only when a change
  already touches the surface.

## Enforcement

STRUCTURAL — `conventions: bits-ui-single-library` (built 2026-06-11):
asserts `bits-ui` is a direct dependency, that no known competing Svelte
UI library appears in package.json dependencies or devDependencies, and
that no `src/web` module imports one. The competing-library blocklist is
honest about its coverage: it catches the realistic drift (a well-known
second library arriving via install + import), not a novel unknown
package — that residue, and "should this new surface use a Bits primitive
instead of hand-rolling", is design review.
Sabotage demo: 2026-06-11, red/green captured (see
architecture/sabotage-demos.md).

## Alternatives considered

- **Melt UI** — rejected: lower-level builder API requires materially more
  wiring per surface for the same behavior; bits-ui provides the same
  headless control with ready component anatomy.
- **shadcn-svelte** — rejected: ships styled components, which would
  compete with the R18–R21 visual vocabulary instead of staying under it.
- **Keep hand-rolling** — rejected by the bug record: ISS-003, Escape
  fall-through between layered surfaces, orphaned/clipped menus, and six
  independent implementations of dismissal and positioning.
