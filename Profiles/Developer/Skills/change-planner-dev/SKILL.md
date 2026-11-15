---
name: change-planner-dev
description: Turns a feature request into a dependency-validated, build-ready plan across scope, architecture, and task phases, using a CLI that tracks coherence so the plan cannot silently drift. Discovery and planning only; does not implement application code.
---

# Context

Use this skill to plan a software change before implementation: discover scope,
design the architectural approach, and break it into verifiable tasks. The output
is `solution.md`, a dependency graph the CLI keeps coherent. This skill does NOT
modify application code. Planning never authorizes a build; implementation begins
only when the user separately asks for it outside this skill.

The skill source files (this SKILL.md, the CLI, templates) are not application
code for the purpose of the "no code edits" rule.

# Mental model (read this first)

`solution.md` is a dependency graph, like a spreadsheet. Items depend on other
items. When you change an item, every item that depends on it must be
re-examined, exactly as changing a spreadsheet cell recalculates the cells that
reference it. The difference is that the "recalculation" is YOU re-reasoning the
item.

Division of labor:
- **You (agent)** own all content in `solution.md`. You read the whole document,
  reason over all of it, and edit it holistically. You also do the bookkeeping's
  opposite: judgment.
- **The CLI** owns the verdicts in `change.json`. It parses the graph, validates
  structure, and tracks which confirmed items have gone STALE because their
  content or a dependency changed. It is a safety net and an advisor, not your
  boss: it reports all issues at once and recommends a focus; you decide.
- **The user** owns scope/phase lock and axiom truth. You never lock a phase
  yourself.

What the structure catches: OMISSIONS (you changed something and forgot a
dependent) and structural breakage (cycles, upward deps, dangling refs). What it
does NOT catch: a change you made that is wrong but internally consistent. That
is still your judgment, helped by the change receipt and the challenge pass.

# The item format

Every item is a markdown block:

```
### [S1] (assumed) One-line title of the item
Optional body lines giving detail.
depends_on: -
```

- IDs encode the phase: `S#` = Scope, `A#` = Architecture, `T#` = Tasks.
- Status is `(open)`, `(assumed)`, or `(confirmed)`. Mark user-stated facts and
  repo facts as you confirm them; mark your own inferences `(assumed)` until the
  user or the codebase confirms them.
- `depends_on:` is a comma list of IDs, or `-` for none.
- **Dependencies point downward only.** Tasks may depend on Architecture or
  Tasks; Architecture on Scope or Architecture; Scope on Scope. Never upward.
  You cannot write a Task on Architecture that does not exist yet, which is what
  keeps you from skipping ahead.
- **A scope item is a DELIVERABLE** (a unit of work that takes effort to build). Its
  acceptance criteria, qualifiers, and notes live in the item body, not as separate
  items; exclusions are consolidated into one Boundaries item, not scattered. A lone
  acceptance criterion or exclusion is not its own scope item. (Architecture and Task
  items follow their own conventions below.)
- **Item bodies are free markdown, with two parser constraints.** Do not use `#` or
  `##` headings inside a body (such a line ends the item); use bold labels
  (`**Acceptance criteria:**`) or plain text. Do not begin a body line with
  `depends_on:`, `grounds_on:`, `files_create:`, `files_edit:`, `files_read:`, or
  `verify:` unless it is the real structured field, since the parser extracts those.
- **Ubiquitous language: prefer the codebase's existing vocabulary.** Use the terms the
  code already uses, so grounding resolves them for free. When you introduce a coined or
  load-bearing term with no obvious code referent (e.g. "context packet"), anchor it once
  to a `file:symbol` or to the S#/A# item that defines it. Do not build an exhaustive
  glossary; later phases bind terms to the real code, and a doc that restates code drifts.

**Task items carry extra structured fields** (parsed like `depends_on`, each on its
own line) so the plan can be compiled into a build workflow: `grounds_on:` (comma
list), `files_create:`, `files_edit:`, `files_read:` (comma lists), and `verify:` (one
runnable command). The write-set (`files_create` + `files_edit`) must be accurate and
complete; it is what lets the compiler parallelize only tasks that cannot collide. A
task body is the self-contained build prompt (interface/contract + pseudocode for
non-obvious logic). The packet flags any task missing a write-set or verify as NOT
COMPILE-READY, and any task missing `grounds_on` as THIN PER-AGENT CONTEXT.

**`depends_on` and `grounds_on` are different edges.** `depends_on` is execution
ORDER (the items a task must run after); the compiler builds the DAG from it, so keep
it minimal. `grounds_on` is the architecture a task REALIZES (the A#/S# items it
implements or must honor, including the `INVARIANT:` ones); the compiler injects that
set as the build agent's context. Both are coherence edges: changing a grounded item
makes the task STALE, exactly like changing a dependency, so each must point downward
and reference a real item. A task implementing A11/A12/A15 lists them in `grounds_on`
even if it waits on none of them.

# CLEAN vs STALE (the ratchet)

A `(confirmed)` item is CLEAN only while its own content and each dependency's
content match the snapshot taken when you last affirmed it. Editing the item, or
editing anything it depends on, makes it STALE until you re-affirm it. You affirm
via `sync --affirm <ids>`, never by hand. This is what makes a settled decision
impossible to erode silently: the plan is "complete" only when every item is CLEAN.

# Workflow (the trampoline: obey the packet)

This skill drives itself. Every CLI command returns ONE "PLANNER PACKET" that
ends with a `>>> NEXT` block telling you exactly what to do and which command to
run. You do not decide when to hydrate or what to look at; you read the packet,
do what its `>>> NEXT` says, and run the command it names. That command returns
the next packet. There is no other control flow to remember.

The loop is just:

    edit solution.md  ->  sync (affirming what you re-examined)  ->  obey the packet  ->  repeat

Run the CLI with `.claude` or `.agents` depending on your active runtime.

1. **Initialize** when a feature request arrives. Capture the user's request
   VERBATIM in `--request` (it is stored to `request.md` and shown in every
   packet, so no later session loses the premise the items derive from). This
   also prints the first packet:
   `python .claude/skills/change-planner-dev/scripts/change_cli.py init --name "<short-slug>" --request "<the user's original words>" --intent "<why>"`

2. **`sync` is the only loop verb.** It validates the graph, affirms the ids you
   pass, recomputes CLEAN/STALE, and prints the packet:
   `python .claude/skills/change-planner-dev/scripts/change_cli.py sync --id change-xxx --affirm <ids you re-examined> --intent "<what changed>"`
   - With no `--affirm`, `sync` is a pure re-hydrate. **That is also how you RESUME
     in a fresh session**: just run `sync --id change-xxx` and the packet tells you
     where things stand and what to do next.
   - Begin your user-facing response with the exact header line the packet gives
     you, e.g. `[SCOPE | SCOPE: UNLOCKED]`.

3. **The packet tells you the SITUATION and the one next action.** The CLI computes
   which situation the change request is in and prints the matching instruction:
   - `ERROR` -> fix the listed structural errors, then `sync`.
   - `DRIFT` -> a locked phase reopened; reconcile or surface it for `unlock`.
   - `OVERCONFIDENT` -> a confirmed item rests on a non-confirmed one; fix it.
   - `STALE` -> re-examine the named confirmed items and re-affirm what holds.
   - `EMPTY` -> draft the initial items for this phase.
   - `UNSETTLED` -> work the focus item; ask the user only behavioral questions.
   - `READY` -> tell the user the phase is ready and let THEM lock it.
   - `COMPLETE` -> planning done; summarize and stop. Not permission to build.

4. **Record user answers** when they resolve something (audit trail + resume).
   This also re-prints the packet:
   `python .claude/skills/change-planner-dev/scripts/change_cli.py answer --id change-xxx --question "<q>" --answer "<a>" --intent "<why>"`

5. **Phase lock is the USER's call.** When the packet reports `READY`, surface it
   and let the user decide. When they choose to lock (advances scope -> architecture
   -> tasks):
   `python .claude/skills/change-planner-dev/scripts/change_cli.py lock --id change-xxx --intent "<why>"`
   If later work reopens a locked phase, the next packet's situation becomes
   `DRIFT`; the user may
   `unlock --id change-xxx --phase scope --reason "<why>"`.

6. **Loop** until the packet reports `COMPLETE`. That is a planning milestone, not
   permission to build.

# Ground with sub-agents (do not plan from memory)

At key moments, spawn sub-agents to do deep codebase research and fold their findings
back into the plan as confirmed items. This is mandatory, not instinctive: even if
your runtime does not do it automatically, you must. The clearest trigger is the
**start of the Architecture phase**, where you should fan out sub-agents over the
relevant subsystems (existing patterns, real file paths, signatures, constraints)
before proposing any design. Also use a sub-agent in Scope/Tasks whenever a question
is repo-answerable, instead of guessing or asking the user. Designing or planning
against remembered code, rather than the code that is actually there, is the most
common way these plans go wrong.

# Collaboration guardrails (you are a partner, not an autopilot)

This skill is collaborative. Do NOT design or decide an entire phase yourself and
present it as finished; involve the user as you go. Two rules are enforced by the CLI,
not left to your judgment:

- **No create-and-confirm in one sync.** You cannot affirm an item the same sync you
  create it. Propose it, sync, surface it, then affirm on a later sync. This breaks the
  "write a wall of items and rubber-stamp it" pattern.
- **A phase cannot reach READY with zero recorded user input.** If you drive a phase
  to structurally clean without recording any `answer` for that phase, the packet
  returns the REVIEW situation, not READY: surface your key decisions and record the
  user's direction before the phase can be marked ready.

And one rule of discipline the CLI cannot fully police: affirm means "I re-examined
this and stand behind it," not "mark the checklist done." User-facing choices
(behavior, UX, visual style, keymaps, copy) are the user's to confirm, like scope
intent, not yours to self-approve.

# Phases: responsibility, depth, and definition of done

Each phase has a persona, a required depth, and an EXIT CHECKLIST that the packet
prints every turn (in the PERSONA & METHOD block, from the phase template). A phase
is not ready until every box on its checklist is satisfied; verify them before you
tell the user the phase is ready. The checklists are the extensible source of truth
and grow as we find gaps. Some phases also point to a deeper guide under
`references/`: for Architecture, `references/ux-and-feature-design.md` (user-facing
design depth), `references/global-invariants.md` (repo-wide invariants to capture as
A# items), and `references/design-principles.md` (deep modules, no exception masking,
etc.). The Tasks phase also follows `references/design-principles.md`.

- **Scope (Business Analyst): the exact, comprehensive WHAT.** Each scope item is a
  DELIVERABLE (a unit of work). Capture every capability and qualifier as an acceptance
  criterion inside the deliverable it qualifies (so "snooze a task" is present as a
  criterion, not lost), with the deliverable's notes in the body. Consolidate exclusions
  into one Boundaries item rather than scattering them. Make in/out boundaries explicit.
  Reason technically in private, ask behaviorally in public. Intent-dependent items are
  the user's to confirm.
- **Architecture (Senior Engineer): the specific design AND the codebase approach.**
  Ground in the real codebase via sub-agents, generate more than one candidate
  approach, converge on one that respects invariants. Then design each capability
  fully: its exact behavior across every path and edge case (not just the happy
  path), which is universal; for user-facing capabilities also its UX/UI (per
  `references/ux-and-feature-design.md`); for CLI/backend, the precise contract
  (inputs, outputs, error modes, side effects). Capture invariants as items that
  tasks depend on. This is where the nitty-gritty lives.
- **Tasks (Lead Engineer): everything a builder needs, without ambiguity.** Author them
  file-first with a 3-step sequence (no workflow): (1) spawn ONE sub-agent to investigate
  the codebase against the locked scope and architecture and return the file list plus
  any gotchas or contradictions; (2) YOU draft the T# items yourself, file list ->
  per-file pseudocode -> package into tasks LAST, each with a real file path, depends_on,
  grounds_on, and a runnable verify; (3) spawn ONE sub-agent as a critic to find what is
  missing, broken, or against best practices, and fix it. See the phase template.

# Build tooling (after the tasks phase is locked)

The skill's deliverable is the PLAN. Building a feature means executing that plan, which
you do with the model of your choice; this skill never builds and never spawns build
agents. One command turns the locked plan into a portable build artifact:

- **`compile-build`**: as soon as the user LOCKS the tasks phase, materialize a build
  folder:
  `python .claude/skills/change-planner-dev/scripts/change_cli.py compile-build --id change-xxx`
  This writes `.change-requests/change-xxx/build/` containing one markdown file per task
  (YAML front matter with its `depends_on` / `grounds_on` / write-set / verify, then a
  fully compiled, self-contained build prompt) plus a `README.md` entry point that is
  both the table of contents and an instruction prompt. The user hands `README.md` to any
  model (Claude, Gemini, Codex) to build the change one task at a time. `depends_on` sets
  the order; `grounds_on` is baked into each task's prompt as its architecture. It only
  writes files; it runs nothing. The tasks-phase agent runs this on lock.

# Discovery quality (the hard part)

- **Propose, do not interrogate.** Write your best-guess understanding as
  `(assumed)` items and ask the user to confirm or correct a concrete assertion.
  Never ask the user "how should this work?" That offloads your job onto them.
- **Reason technically, ask behaviorally.** Think about data shape, APIs,
  lifecycle, ownership, and failure modes privately; ask the user a plain
  scenario.
  - Bad: "What should the data shape be?" / "What is the source of truth?"
  - Good: "When someone delegates a task, what should they see afterward?"
- **One coherent decision frame at a time**, bundling tightly related defaults so
  the user can accept or correct a set without opening unrelated fronts.
- **Route uncertainty.** Do not ask the user anything the repo can answer; go
  read the code. Ask the user only when the answer depends on intent, preference,
  risk tolerance, or business meaning.
- **Challenge pass before signaling readiness.** Actively try to break your own
  understanding (edge cases, ambiguities, alternative interpretations) and turn
  each into a resolved item or rule it out. Do not declare a phase done; surface
  status and let the user lock.

# Gotchas

- Do not modify application code. This is planning only.
- Do not lock a phase yourself, do not recommend locking, do not declare
  discovery finished. Keep proposing the next best frame until the user locks.
- Do not hand-edit `change.json` or hand-write CLEAN/STALE state; those are
  CLI-owned verdicts. You own `solution.md` content only.
- Only affirm items you actually re-examined. Affirming is asserting "I checked
  this against its current dependencies and stand behind it."
- Do not leave a dependent stale after editing its dependency; reconcile it in
  the same pass, then affirm it.
- Keep rejected-question feedback and process notes out of `solution.md`; it is a
  plan, not a log.
- Do not ask the user about filenames, schemas, or module names unless they are
  already working at that level.

# Final verification

Before finishing a turn, confirm:
1. The response begins with the exact header line from the latest packet.
2. `solution.md` reads as the current plan, not a meeting log.
3. Every item you changed was re-examined for downstream impact and affirmed.
4. The latest `sync` packet showed no structural errors and you obeyed its `>>> NEXT`.
5. Repo-answerable facts were inspected, not asked.
6. Scope/architecture were advanced only by the user via `lock`.
7. No application code was modified.
