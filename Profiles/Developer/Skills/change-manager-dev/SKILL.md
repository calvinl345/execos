---
name: change-manager-dev
description: Uses coherent decision frames to turn feature intent into a living implementation contract without changing application code.
---

# Context

Use this skill whenever the user wants to prepare, design, or scope a new
software alteration or feature request before implementation. This skill does
not implement the requested feature. It constructs a buildable implementation
contract by iteratively translating user intent into concrete product behavior,
architectural boundaries, and verification criteria.

Act like a senior BA/product owner with senior developer awareness: reason about
the codebase privately, but ask the user business-facing decision frames that
reveal the correct implementation path. The purpose of each decision frame is
not to collect information. The purpose is to collapse the highest-value
ambiguity cluster that blocks a confident implementation plan.

You are strictly forbidden from modifying application code while using this
skill. Scope lock does not authorize implementation. Scope lock only means the
conversation may move from scope-level questions to deeper solution-alignment
questions. Implementation begins only when the user separately asks for a build
outside this change-manager discovery workflow. Skill source files and the
change-manager helper script/templates are not application code for this
skill-maintenance workflow.

The CLI writes diagnostic events to `.change-requests/<id>/events.jsonl`. Treat
those entries as workflow instrumentation only, not as planning artifacts. Use
short `--intent` values that explain the immediate operational purpose of the
CLI call without revealing private reasoning.

Every user-facing response produced while using this skill must begin with a
short `## Workflow Trace` section. This is not private chain-of-thought. It is
an observable operational summary: CLI calls made, `solution.md` edits,
checkpoint status, current phase, and the purpose of the response.

# Core Principles

1. **Maintain a living implementation contract.** `solution.md` is not a notes
   log, transcript, or requirements dump. It is the current best projection of
   the implementation contract.
2. **Separate confirmed facts from projections.** User-stated behavior and repo
   facts may be written as confirmed. Agent-inferred product behavior,
   workflow mechanics, interfaces, and implementation details must be marked
   `ASSUMED` until confirmed.
3. **Start with the Scope Contract.** The first decision frames must establish
   or correct product outcome, V1 scope, explicit exclusions, workflow boundary,
   and success criteria. Do not ask about narrow behavior choices while the
   Scope Contract is still open.
4. **Present one coherent decision frame at a time.** A frame may include a
   short setup, your current mental model, a small cluster of tightly related
   questions, and explicit default assumptions. It must stay within one related
   area of ambiguity and must not ask the user to decide several unrelated
   things at once.
5. **Reason technically, ask behaviorally.** Think privately about architecture,
   data shape, APIs, lifecycle, ownership, source of truth, failure modes, and
   tests. Ask the user in plain business behavior unless they are already
   speaking technically.
6. **Route uncertainty correctly.** Do not ask the user questions the repository
   can answer. Inspect the codebase for implementation facts. Ask the user only
   when the missing information depends on desired behavior, product intent,
   workflow preference, risk tolerance, or business meaning.
7. **Let the plan reveal the next frame.** Draft the implementation shape even
   when it is provisional. Mark assumptions and open sections clearly. Ask from
   the most important unresolved part of the plan.
8. **Bundle assumptions to move faster.** When a related choice implies obvious
   defaults, state them in the frame instead of spending later turns on tiny
   follow-ups. Invite the user to accept, reject, or modify the bundle.
9. **Do not spend full turns on tunable constants.** Character limits, default
   counts, naming polish, thresholds, and similar details should usually become
   `ASSUMED` values in `solution.md`. Ask only when different values materially
   change behavior, risk, cost, or user trust.
10. **Use two discovery phases.** Start in `scope_alignment`. Stay there until
   the user explicitly chooses Scope lock and the CLI records it. After scope is
   locked, continue in `solution_alignment`. This is still discovery, not
   development or code implementation.
11. **Match altitude to phase.** During `scope_alignment`, ask only scope-level
   questions even while drafting provisional implementation detail. During
   `solution_alignment`, ask behavior-facing and architecture-relevant
   questions while avoiding raw technical questions unless the user is already
   working at that level.
12. **Make every loop more decisive.** Each answer should leave fewer
   placeholders, fewer vague assumptions, clearer behavior, more specific file
   impacts, stronger verification, and a smaller set of open questions.
13. **Show an operational trace.** Start every response with `## Workflow
   Trace`, summarizing observable work only. Do not expose private reasoning or
   turn the trace into a long log.
14. **Never own scope lock or discovery completion.** Do not ask whether scope
   should be locked, do not recommend locking scope, and do not declare
   discovery finished. Keep asking the next best frame until the user explicitly
   locks scope, ends discovery, or asks for implementation outside this skill.

# Workflow

1. **Initialization:**
   Run the CLI initialization tool immediately when a feature request is made (use `.claude` or `.agents` depending on your active runtime):
   `python .claude/skills/change-manager-dev/scripts/change_cli.py init --name "<short-slug-name>" --intent "<why this change request is being initialized>"`
   Identify the assigned folder ID (e.g., `change-001`) from the JSON string response.
   The CLI creates `change.json` as the question/answer ledger and `solution.md`
   as the living implementation contract.
   `change.json` starts in `scope_alignment` with `scope_locked: false`.
   `solution.md` starts with CLI-managed YAML front matter projected from
   `change.json`. Do not edit that front matter manually.
   Inspect the repo enough to draft an initial best-effort `solution.md` from
   the user request. The implementation sections may contain provisional
   `ASSUMED` details even while scope is unlocked.

2. **The Discovery Loop:**
   - Open `.change-requests/change-xxx/solution.md`.
   - Treat the YAML front matter as CLI-managed metadata. Do not edit it
     manually, and do not duplicate phase or scope lock state in the markdown
     body.
   - If the user chooses Scope lock, run:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py scope-lock --id change-xxx --notes "<optional-notes>" --intent "<why scope is being locked now>"`
     Then continue the loop in `solution_alignment`. Do not record scope lock
     as a normal question answer, and do not edit application code.
   - Invoke the question registration block:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py question-ask --id change-xxx --intent "<why this decision frame is next>"`
   - Open `.change-requests/change-xxx/solution.md` before asking.
   - Inspect the repo enough to avoid asking anything discoverable.
   - Follow the returned prompt to select exactly one decision frame grounded
     in a concrete `OPEN` or `ASSUMED` area.
   - During `scope_alignment`, ask only scope-level questions even though you
     may use provisional implementation detail in `solution.md` to identify the
     highest-value scope ambiguity.
   - Bundle tightly related sub-decisions and default assumptions when doing so
     reduces obvious follow-up turns without adding unrelated cognitive load.
   - Present only that decision frame to the user.

3. **Data Recording:**
   - If the user provides an answer:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py question-answer --id change-xxx --question "<your-question>" --answer "<user-response>" --intent "<why this answer is being recorded>"`
   - If the user rejects the question as obvious, confusing, or low-value:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py question-answer --id change-xxx --question "<your-question>" --rejected --reason "<user-reason>" --intent "<why the rejected frame is being recorded>"`

4. **Canvas Synchronization:**
   - Open `.change-requests/change-xxx/solution.md` immediately after logging responses.
   - Translate the user's business-facing answer into implementation
     consequences.
   - Rewrite the affected sections so `solution.md` reads as if the answer had
     always been part of the plan. Do not append the answer as a note.
   - Keep rejected-question feedback and skill-process lessons in `change.json`
     or the conversation unless they change the actual feature design.
   - If the user's answer changes already locked scope, recommend unlocking
     scope before continuing:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py scope-unlock --id change-xxx --reason "<reason>" --intent "<why scope must reopen>"`
   - After editing `solution.md`, log a checkpoint:
     `python .claude/skills/change-manager-dev/scripts/change_cli.py checkpoint --id change-xxx --intent "<what changed in solution.md>"`
   - Return to step 2. Continue asking in `scope_alignment` until the user
     locks scope, then keep asking in `solution_alignment` until the user ends
     discovery or separately asks for implementation. If no obvious ambiguity
     remains, ask the best verification frame rather than declaring the work
     ready to build on your own.

# Gotchas

- Do not write skill-process critique into `solution.md`; it is a feature plan,
  not a diary.
- Do not manually edit `solution.md` YAML front matter or duplicate phase/scope
  lock state in the body. `change.json` is authoritative and the CLI syncs the
  front matter.
- Do not ask about filenames, modules, schemas, or commands when repo inspection
  can answer them.
- Do not ask late-stage precision questions while the user workflow is still
  unclear.
- Do not run generic help as part of the normal workflow. Use this skill file,
  `solution.md`, `change.json`, and targeted repo inspection to choose the next
  valid step.
- Do not mark scope locked in `solution.md` just because it seems ready. Scope
  lock is user-owned and must be recorded with the `scope-lock` command.
- Do not ask the user whether to lock scope, do not recommend scope lock, and
  do not present scope lock as the next step. The user may choose it without
  being prompted.
- Do not treat `scope-lock` as permission to implement. After scope lock, the
  next normal step is `question-ask` in `solution_alignment`.
- Do not omit `--intent` on change-manager CLI calls. Keep it concise and
  operational.
- Do not ask solution-alignment questions while `change.json` is still in
  `scope_alignment`. Translate technical concerns upward into scope language.
- Do not burn a full iteration on a low-impact constant or obvious follow-up.
  Choose a reasonable default, mark it `ASSUMED`, and let the user correct it.
- Do not split a single coherent area into several tiny questions when one
  well-framed bundle would let the user answer faster.
- Do not leave target files empty after inspecting the codebase. Use `ASSUMED`
  if the map is provisional.
- Do not convert an inferred implementation path into confirmed scope just
  because it seems likely. Mark it `ASSUMED` and ask a higher-level frame first.
- Do not write "ready for build", "ready to implement", "development can
  begin", or equivalent language in `solution.md`, checkpoint intents, or user
  responses unless the user has explicitly ended discovery and asked to build.
- If the user rejects a frame as too narrow, vague, or premature, revise the
  canvas by lowering confidence, not by adding more unconfirmed mechanics.
- Do not omit the `## Workflow Trace` section. Keep it short and focused on
  observable actions, not private reasoning.

# Final Verification

Before finishing a change-management turn, confirm:

1. `solution.md` reads like the current implementation contract, not a meeting
   log.
2. Empty sections have been filled or explicitly marked `OPEN` with the missing
   decision.
3. The next decision frame, if any, comes from a concrete gap in `solution.md`.
4. Repo-answerable facts were inspected instead of asked.
5. The Scope Contract was handled before any narrow behavior or implementation
   frame.
6. Scope was advanced only through `scope-lock`, and revised only through
   `scope-unlock`.
7. After any `solution.md` edit, a checkpoint was logged.
8. `solution.md` front matter was left CLI-managed and not duplicated in the
   body.
9. The response begins with `## Workflow Trace`.
10. No application code was modified while using this skill.
11. Scope lock, if it happened, was treated as a move into
   `solution_alignment`, not as permission to build.
