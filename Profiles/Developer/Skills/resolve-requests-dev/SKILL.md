---
name: resolve-requests-dev
description: >-
  Use when Calvin wants to work through reported issues — fixing bugs,
  change requests, and enhancements that Jordan filed via the
  report-issue-prod skill (which creates GitHub issues). Triggers on
  phrases like 'fix the open issues', 'resolve the open requests', 'work
  through the issue tracker', 'see what Jordan reported and fix it',
  'process the inbox', or 'patch the open issues'. Reads open GitHub
  issues via `gh issue list`, fixes them in code, runs the project's
  typecheck/lint/test gates, then closes each issue with a one-paragraph
  resolution note (or via `Fixes #N` on the merging commit). Does NOT
  file new issues on Jordan's behalf — that is the production-side
  report-issue-prod skill.
---

# Context

This is the development-side counterpart to `report-issue-prod`. Jordan files
GitHub issues while using ExecOS; Calvin works through them with
this skill — investigate, fix, verify, close with a brief resolution note,
push the code change.

The deal is asymmetric: Jordan should be able to report friction in 10 seconds
without thinking. Calvin should be able to work through the issue list
without losing context — every open issue already has a Type, Summary, and
Acceptance line in its body, so there's no triage step before fixing.

# Workflow

Track your progress through this workflow. Most resolutions go list → scope →
investigate-fix-verify → close-with-note → push.

1. **List open issues.** Run `gh issue list --state open --json number,title,body,labels,createdAt`
   from inside the execos checkout. If `gh` errors with an auth
   problem, tell Calvin to run `gh auth login` (same flow as documented in
   `report-issue-prod`) — don't try to work around it. If there are no open
   issues, tell Calvin and stop.
2. **Confirm scope.**
   - **One open issue** — proceed with it.
   - **Multiple open issues** — list them as `#N — <title> (<type>)` and ask
     which Calvin wants to tackle (one number, several, or "all"/"in
     order"). Default to processing in the order returned (oldest first).
     If user impact clearly suggests a better order, say so and recommend the
     highest-leverage issue first rather than treating the queue as purely FIFO.
   - **Unclear acceptance** — ask Calvin to disambiguate before coding.
     Filing is fast; resolving on a wrong interpretation wastes Calvin's
     time.
3. **Per issue: investigate, fix, verify.** For each issue Calvin chose,
   run the [Per-Issue Loop](#per-issue-loop) below.
4. **Commit and push.** One commit per issue (or one combined commit for a
   batch), code change(s) on a feature branch or directly on `main`
   depending on Calvin's preference. The commit message MUST include
   `Fixes #N` (or `Closes #N` for non-bugs) so GitHub auto-closes the issue
   on merge to the default branch. See [Commit Shape](#commit-shape).
5. **Close with a resolution note.** When the merge happens (or
   immediately, on direct-to-main flows), make sure the issue closes with
   a one-paragraph comment naming what changed and where. GitHub auto-close
   doesn't add a comment — post one with `gh issue comment <N> --body
   "..."` before the auto-close fires, OR use `gh issue close <N> --comment
   "..."` if you're closing manually rather than via merge. See
   [Resolution Note Shape](#resolution-note-shape).

# Reference

## Per-Issue Loop

For each issue Calvin chose, in order:

1. **Investigate.**
   - For **bugs**: find the relevant code, reproduce the bug if possible,
     understand the failure mechanism. Non-trivial bugs benefit from the
     `bug-fix` skill if it's available — use it when the cause isn't
     obvious from reading.
   - For **change-requests / enhancements**: find the code path that owns
     the existing behavior, understand the surrounding architecture
     (especially `src/domain/` ↔ `src/db/` ↔ `src/cli/` boundaries from
     CLAUDE.md), and pick a minimal-blast-radius implementation.

2. **Fix.** Make the minimal correct change. Honor the project rules
   already documented in CLAUDE.md / AGENTS.md:
   - Domain layer (`src/domain/`) stays pure: no DB imports, no I/O.
   - All `task_notes` writes go through `appendTaskNote()` — never raw
     `update`/`delete` against `taskNotes`.
   - Web layer (`src/web/`) uses the anon client only.
   - For Svelte file edits, use the Svelte MCP tools (`list-sections`,
     `get-documentation`, `svelte-autofixer`) before generating runes /
     SvelteKit code.

3. **Verify.** Run the relevant gates — only what's affected, not the whole
   battery if you only touched one layer:

   ```
   npm run typecheck                 # tsc --noEmit
   npm run lint                      # ESLint
   npm test                          # fast suite (~30s budget, no DB)
   npm run test:db:local             # DB tier — only if you touched DB code
   ```

   For UI changes, exercise the affected feature in
   `execos dashboard start` before declaring done.
   Type-check passing is not the same as feature working.

4. **Check acceptance against the issue.** Before committing, compare the final
   behavior to the issue's Acceptance line. If the implementation solves a
   nearby problem but not the user's stated success criterion, stop and tell
   Calvin. Do not smooth over acceptance drift in the resolution note.

## Commit Shape

Every resolution commit must reference its issue so GitHub closes it on
merge to the default branch:

- For one issue: `fix: <short description> (Fixes #N)` (use `feat:` for an
  enhancement).
- For several at once: `fix: <short description> (Fixes #N, Fixes #M)`.

Push to the current branch. If the change is large or risky enough that
you'd normally open a PR for review, do that — `gh pr create` makes it
trivial. For small obvious fixes on a personal branch or directly on
`main`, direct push is fine. Either way, the `Fixes #N` keyword does the
auto-close.

If you're working on a feature branch that won't merge to `main` for a
while, manually close the issue with a comment instead — see
[Resolution Note Shape](#resolution-note-shape) — so Jordan sees it as
resolved rather than waiting weeks for a merge.

## Resolution Note Shape

GitHub's auto-close on merge does not post a comment. Add one yourself
right before pushing the merging commit, or right after merging:

```bash
gh issue comment <N> --body "Resolved by <commit-sha-or-PR-link>. <one short paragraph: what changed, where (file paths welcome), and any notes Jordan should know — e.g. 'needs a dashboard restart to take effect'>."
```

For a manual close (no merge to default branch yet):

```bash
gh issue close <N> --comment "<same one-paragraph note as above>"
```

Tone: brief, factual, Jordan-readable. Avoid jargon. He cares about what
he can now do that he couldn't before, not the internal refactor.

## Listing Variants

- All open: `gh issue list --state open`
- Open bugs only: `gh issue list --state open --search "bug in:body"`
  (the `report-issue-prod` skill writes `**Type:** bug` in the body)
- Recent activity: `gh issue list --state all --limit 20 --sort updated`
- One specific: `gh issue view <N>`

For the agent's working pass, prefer `--json` output and parse the fields
you need rather than scraping `--state open` text.

# Out Of Scope

- **Do not file new issues** that aren't already in the tracker. If you
  spot a real bug Jordan hasn't reported, mention it to Calvin in chat —
  don't self-file via this skill (that's `report-issue-prod`'s job, and
  Jordan is the reporter, not you).
- **Do not close an issue without a fix in the codebase.** "Won't fix" is
  a valid resolution but requires Calvin's explicit approval, and the
  closing comment must say *why*.
- **Do not bundle unrelated refactoring** into a resolution. If you notice
  tech debt next to the fix, flag it separately — keep the resolution
  diff scoped to what the issue actually asked for.
- **Do not retitle or re-label issues** silently. If the title or label is
  wrong enough to matter, edit it explicitly with `gh issue edit` and tell
  Calvin you did.

# Edge Cases

- **No longer reproducible** (e.g., already fixed by an unrelated change).
  Verify carefully — actually run the failing scenario — then close with
  `gh issue close <N> --comment "No longer reproducible as of <commit-sha>;
  verified by <how>. Likely fixed incidentally by <change>."`
- **Fix needs follow-up work** (immediate symptom is patched but a deeper
  redesign is warranted). Close the original issue with the patch and
  tell Calvin the deeper work is worth its own issue — don't quietly
  leave it open or expand the scope.
- **Two issues turn out to be duplicates.** Resolve the older one
  normally; close the newer one with `gh issue close <N> --reason
  "not planned" --comment "Duplicate of #M."` and don't double-fix.
- **Acceptance drifts during the fix** (you find a better way that
  doesn't match the literal Acceptance). Tell Calvin and confirm before
  shipping — Acceptance is Jordan's success criterion, and silent drift
  is how shipped work fails to land for the reporter.
- **`gh` not authenticated.** Tell Calvin to run `gh auth login` (with
  the same prompts as `report-issue-prod` documents) and stop. Don't try
  to work around the failure.

# Final Verification

After completing the work, review against these checks:

1. Did every chosen issue get a real fix in the codebase?
2. Did the relevant gates (typecheck, lint, test, DB tests if applicable)
   pass before commit?
3. Does each closed issue have a resolution comment naming what changed
   and where, in one paragraph?
4. Does each commit reference its issue with `Fixes #N` (or `Closes #N`),
   so the auto-close fires on merge to default?
5. Are commits scoped to the resolution — no unrelated refactoring or
   stray edits?
6. If `gh` failed for any reason, was Calvin told plainly and not worked
   around?
