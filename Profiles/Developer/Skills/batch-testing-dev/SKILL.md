---
name: batch-testing-dev
description: >-
  The testing skill for the ExecOS app itself, with two capabilities.
  (1) Scenario scripts: when Calvin describes a test scenario in plain English
  and wants a ready-to-paste script of `execos` commands to exercise it against
  the development environment ('give me a test script for ...', 'generate a
  scenario to verify ...', 'how do I manually test ...'). EMIT ONLY: print the
  ordered command block, per-step expected observations, and a cleanup block;
  never execute the scenario commands. (2) Testing batches: when Calvin reports
  a problem found while testing ('I found a bug', 'here is an issue', 'record
  this in the batch'), investigate it to root cause, work the open questions
  through with Calvin to an agreed fix, and record it in the active batch
  document under docs/testing/. Also handles
  'sequence the batch', 'execute the batch fixes', and 'close the batch'. Does
  NOT create real work items (tasks-dev), run reviews on Jordan's behalf, or
  fix application code during the collecting phase.
---

# Mode Routing

This is the single skill for testing the app. Pick the mode from what Calvin
asks:

| Calvin says | Mode |
| --- | --- |
| "give me a test script for ...", "how do I manually test ..." | Part 1: Scenario script |
| "I found a problem/bug while testing", "record this issue" | Part 2: Investigate and record |
| "sequence the batch", "plan the fixes" | Part 2: Sequencing |
| "execute the batch", "work through the fixes" | Part 2: Fixing |
| "close the batch" | Part 2: Closeout |

The two parts have different execution rules. Part 1 is emit-only: the agent
never runs scenario commands. Part 2 is investigate-only during collection:
the agent reads code and runs read-only `execos` commands to understand a
problem, but never fixes application code until the batch reaches the fixing
phase with an approved plan.

# Part 1: Scenario Scripts

## Context

Calvin describes a scenario ("a hard-deadline task due in 2 days at P2, then
run a review and confirm it shows in commitments at risk"). This part turns
that into a verbatim, copy-paste-ready test script for the development CLI:
setup commands, the exercise step, the exact observations to check at each
step, and a cleanup block that returns the development database to a quiet
state.

**Emit only. Never execute.** The agent must not run any scenario command
itself, not even "just the read steps". Calvin pastes the script into his own
terminal so he sees the real output, exit codes, and timing. The only CLI the
agent may run while building a script is `execos <family> <command> --help`
to verify an uncertain flag; prefer the `cli-help-dev` command map or reading
`src/cli/commands/taskops.ts` first.

All commands use plain `execos ...` (development environment). Never emit a
production invocation or an npm-wrapped form.

## Workflow

1. **Parse the scenario into phases**: setup writes, the exercise step (often
   `execos taskops hydrate --operation re-rank` or a refusal you expect),
   observations, cleanup.
2. **Verify flags before emitting.** Anything uncertain gets checked against
   the `cli-help-dev` map, `--help`, or the command source. Do not guess flag
   names in an emitted script.
3. **Emit the script** as numbered steps. Each step is a fenced command block
   followed by "Expect:" lines stating exactly what Calvin should see: which
   receipt fields, which hydration packet sections and row values, or which
   refusal message with a non-zero exit.
4. **Use `KS-NNN` placeholders** for IDs that do not exist yet, and tell
   Calvin to substitute the ID from the create receipt (use `--return-detail`
   on creates so the ID and full record come back immediately).
5. **Always end with cleanup**: cancel every created task via
   `execos taskops cancel --task-id KS-NNN --yes`, and restore any
   `app_settings` rows the script changed.

## Reference

### Write surface available to scenarios

`execos taskops` subcommands: `hydrate`, `create`, `update`, `complete`,
`cancel`, `delegate`, `follow-up`, `defer`, `dependency-add`,
`dependency-remove`, `flag-attention`, `unflag-attention`, `show`, `list`,
`follow-ups`, `draft-follow-ups`, `re-rank`. Reads live on `execos task`
(`list`, `show`, `dependency list`).

- `create` requires `--title` (or positional title), `--description` (>= 10
  chars), `--category` (`client`, `business`, `product`, `house`,
  `personal`), and `--due "<phrase>"`. Priority is explicit only (`P0`-`P3`,
  never inferred); omit it unless the scenario needs one.
- Change-009 fields: `--hard-deadline` (boolean flag on create) marks the due
  date as an external commitment; `--effort <S|M|L|XL>` records a t-shirt
  estimate that never affects ranking. On `update`, use
  `--hard-deadline <true|false>` to set or clear the flag and `--clear-effort`
  to remove the estimate.
- The create dedup gate checks OPEN tasks two ways: a normalized exact
  title/description match (case/whitespace only; works even when embedding
  is down or the candidate has no stored vector) and embedded cosine
  similarity at or above the `intake_checklist.dedup.similarity_threshold`
  setting (default 0.85). Either refuses the create with a non-zero exit and
  a "Create refused: near-duplicate open tasks found" listing
  (`KS-NNN | title | similarity | band`, bands `exact` / `near_identical` /
  `similar`; exact rows add `matched_on`). `--allow-duplicate
  "<justification>"` overrides; the justification is mandatory and audited.
- Terminal moves require `--yes`: `execos taskops complete --task-id KS-NNN
  --yes` and `execos taskops cancel --task-id KS-NNN --yes`.

### Observations to emit per step

- **Receipts.** Create and update receipts print `task_id`, `title`,
  `status`, `priority`, `category`, `owner`, `due`, `goal_id`,
  `hard_deadline` (`yes`/`no`), and `effort`. Name the exact fields the
  scenario cares about (for example "Expect: `hard_deadline: yes`, `effort:
  S`, `priority: P2`, `due` two days out").
- **Re-rank packet.** `execos taskops hydrate --operation re-rank` emits the
  hydration packet; `execos --format json taskops hydrate --operation re-rank`
  returns it machine-readable with a sections object. Optional `--intent`
  carries situational context that the packet surfaces. Sections to reference:
  situational context, do-next candidates, anomalies (overdue, stale, new
  triage, arrived snooze), Commitments At Risk, Goals At Risk, Newly
  Unblocked, current queue. The write half is `execos taskops re-rank --task
  KS-NNN --why "..."` (repeatable; `--clear` empties the queue).
- **Commitments At Risk rows** carry transparency fields: `daysLeft`
  (negative when overdue, 0 due today), `windowDays` (the
  `commitment_days` window in effect), and `rule` (`overdue` or
  `within-window`). The detector scans ALL open tasks, so delegated, snoozed,
  and review-status tasks with hard deadlines still surface here even though
  they are excluded from do-next ranking.
- **Goals At Risk** fires for active goals with at least one open linked task
  whose quarter ends within `goal_days`. **Newly Unblocked** fires for tasks
  whose last unblock happened within 24 hours.
- **Refusals.** When a step is supposed to fail (dedup gate, illegal status
  transition, missing `--yes`), say so explicitly: expected non-zero exit and
  the message fragment to look for.

### Risk-window tuning for window-edge tests

The review risk windows live in `app_settings`:

- `prioritization.risk_windows.commitment_days` (default `3`)
- `prioritization.risk_windows.goal_days` (default `14`)

Settings load once per CLI process, so a fresh `execos taskops hydrate
--operation re-rank` picks up a changed row immediately. To test a window edge, emit SQL for Calvin to
run against the development Postgres (Supabase SQL editor for the dev
project, or psql with the dev connection string):

```sql
update app_settings set value = '1'
where key = 'prioritization.risk_windows.commitment_days';
```

Every script that changes a setting must restore the default in cleanup.

## Worked Examples

### Example 1: hard deadline, commitments at risk, window edge

Scenario: "a hard-deadline task due in 2 days at P2; confirm it appears in
commitments at risk, then tighten the window to 1 day and confirm it drops
out."

Step 1: create the scenario task.

```bash
execos taskops create --title "Scenario: hard-deadline smoke" -d "Scenario test: verify hard-deadline commitment surfaces in review." -c personal --due "in 2 days" -p P2 --hard-deadline --effort S --return-detail
```

Expect: receipt with `hard_deadline: yes`, `effort: S`, `priority: P2`, `due`
two days out, status `triage`. Note the returned `KS-NNN` for later steps.

Step 2: run the re-rank packet.

```bash
execos taskops hydrate --operation re-rank
```

Expect: a Commitments At Risk row for `KS-NNN` with `Days Left` 2, `Window`
3d, `Rule` within-window. The task may also appear in do-next candidates;
that is fine.

Step 3: tighten the commitment window (SQL against the dev database).

```sql
update app_settings set value = '1'
where key = 'prioritization.risk_windows.commitment_days';
```

Step 4: re-run the re-rank packet.

```bash
execos taskops hydrate --operation re-rank
```

Expect: `KS-NNN` no longer appears in Commitments At Risk (daysLeft 2 is
outside the 1-day window); any remaining rows show `Window` 1d.

Cleanup: restore the window, cancel the task.

```sql
update app_settings set value = '3'
where key = 'prioritization.risk_windows.commitment_days';
```

```bash
execos taskops cancel --task-id KS-NNN --yes --note "scenario test cleanup"
```

Expect: cancel receipt showing the terminal transition; exit 0.

### Example 2: dedup gate refusal and override

Scenario: "prove the create dedup gate refuses a near-duplicate and that
--allow-duplicate gets past it."

Step 1: create the original.

```bash
execos taskops create --title "Scenario: dedup probe" -d "Scenario test: seed task for the duplicate gate." -c personal --due "tomorrow" --return-detail
```

Expect: normal create receipt; note `KS-AAA`.

Step 2: attempt a near-identical create.

```bash
execos taskops create --title "Scenario: dedup probe" -d "Scenario test: seed task for the duplicate gate again." -c personal --due "tomorrow"
```

Expect: non-zero exit. Output contains "Create refused: near-duplicate open
tasks found" and a match line for `KS-AAA` with similarity at or above 0.85.

Step 3: override deliberately.

```bash
execos taskops create --title "Scenario: dedup probe" -d "Scenario test: seed task for the duplicate gate again." -c personal --due "tomorrow" --allow-duplicate "scenario test: deliberate twin to exercise the audited override" --return-detail
```

Expect: create succeeds (note `KS-BBB`); the override is audited on the task.

Cleanup:

```bash
execos taskops cancel --task-id KS-AAA --yes --note "scenario test cleanup"
execos taskops cancel --task-id KS-BBB --yes --note "scenario test cleanup"
```

Expect: both cancel receipts; exit 0. Cancelled tasks leave the open set, so
repeat runs of this script will not trip the gate on stale leftovers.

## Gotchas

- Global `--format json` goes before the command: `execos --format json
  taskops hydrate --operation re-rank`.
- Date phrases parse with the host time zone; natural phrases like "in 2
  days" or "Friday at 3pm" are fine.
- Do not emit `--clear-due`; the CLI rejects due-date removal. Status on
  `update` accepts non-terminal values only.
- Terminal statuses are immutable. Cleanup means `taskops cancel`, never a
  delete; cancelled scenario rows remaining in the database is expected.
- Prefix scenario titles with "Scenario:" so leftovers are easy to spot and
  the intent is obvious in the audit trail.
- This skill is development-environment only. If Calvin asks to test against
  production, stop and confirm explicitly; do not silently emit a production
  script.

## Final Verification (scenario scripts)

Before sending the script, confirm:

1. Every command uses plain `execos`; no npm-wrapped or production forms.
2. The agent executed nothing except, at most, a `--help` read.
3. Every step has an "Expect:" line naming receipt fields, packet sections
   with values (daysLeft, windowDays, rule), or an expected refusal with
   non-zero exit.
4. Placeholder IDs (`KS-NNN`) are flagged for substitution from the create
   receipt.
5. Cleanup cancels every created task with `--task-id ... --yes` and restores
   every changed `app_settings` row to its default.

# Part 2: Testing Batches

## How Calvin uses this

Calvin tests the app manually and runs several agent sessions in parallel.
When he hits a problem, he opens a session, invokes this skill, and describes
the problem. That session investigates to root cause, records the issue, and
then discusses it with Calvin (decisions he must make, choices between fix
approaches, architecture implications) until they agree on what the problem
is and how to fix it. Meanwhile Calvin keeps testing and reports the next
problem to a different session. When testing is done, one session sequences
the fixes, the fixes are executed in planned waves, and the batch is closed.

The agent's job is not just to report the issue; an issue counts as **added
to the batch** only once that discussion has concluded and the entry is
marked `ready`. The bar for the finished entry: **a fixing agent with no
memory of the investigation can implement the fix from the entry alone**. An
entry that just restates the symptom is not done, and an entry with
unresolved open questions is not ready.

## The batch document

Batch documents live at `docs/testing/batch-NNN.md` (three-digit sequence:
`batch-001.md`, `batch-002.md`, ...). Exactly one batch is active at a time.

Frontmatter:

```yaml
---
batch: 1
status: collecting   # collecting | fixing | closed
opened: 2026-06-11
closed: null
baseline: <branch> @ <short-sha when the batch opened>
---
```

A batch is **active** when `status` is anything other than `closed`.

Finding the active batch: glob `docs/testing/batch-*.md` and read each file's
frontmatter.

- Exactly one active batch: use it.
- No active batch: create the next number in sequence from the template below.
- More than one active batch: stop and ask Calvin which one wins; never pick
  silently and never open another.

Document skeleton:

```markdown
---
batch: N
status: collecting
opened: YYYY-MM-DD
closed: null
baseline: <branch> @ <short-sha>
---

# Testing Batch NNN

One or two sentences on what is being tested (which feature wave, which
build).

## Issues

(issue entries append here)

## Fix Plan

(written during sequencing; empty until then)

## Closeout

(written when the batch closes; empty until then)
```

## Issue entry format

Append entries to the end of `## Issues`, numbered `ISS-NNN` (three digits,
unique within the batch, next = max existing + 1). **Every entry begins with
a horizontal rule (`---`)** so issues are visually separated when scanning
the document, and the metadata renders as one compact line under the heading
rather than a bullet list.

An entry holds two kinds of content, and the distinction is part of the
format:

- **The permanent record** (Symptom, Root cause, Agreed fix, Tests & gates,
  Rulings): what remains when the issue is finished. Write it in final form.
- **The work-in-progress block** (Open questions): scaffolding for the
  discussion with Calvin. It shrinks as questions resolve and is deleted
  entirely when the issue reaches `ready`.

```markdown
---

### ISS-001: <short descriptive title>

**Status: in-discussion** · Area: <cli | web | services | domain | db | contracts | skills | docs> · Reported: YYYY-MM-DD

**Symptom**

What Calvin observed, with the exact command, output fragment, or screen
state when available. Quote his report where the wording matters.

**Root cause**

Grounded in code with `path/to/file.ts:line` references. Distinguish what
was verified by reading code or reproducing from what is inferred. If the
behavior turns out to be as-designed, say so and say why the design reads
as a bug.

**Agreed fix**

Concrete enough for a cold agent: which files change, the shape of the
change, design choices already made, alternatives considered and rejected.
While the issue is in discussion this section holds the current proposal;
once the issue is `ready`, it is the agreed plan.

**Tests & gates**

Tests to update or add, and the gates that must stay green (`npm run
typecheck`, `npm run lint`, `npm test`, `npm run arch:check`). Name any
constitution rules the fix touches.

**Rulings**

- YYYY-MM-DD: <decision Calvin made, and the reason>. Omit this section
  when the issue needed no ruling.

**Open questions** *(work in progress; resolve and delete before `ready`)*

- [ ] <a decision Calvin must make, a choice between fix approaches, or an
  architecture call — with the agent's recommended answer>
```

Issue `Status` values:

- `in-discussion`: investigation recorded; open questions are being worked
  through with Calvin.
- `ready`: Calvin and the agent agree on the problem and the fix; the Open
  questions block has been deleted; the permanent record is final. Only
  `ready` issues count as added to the batch.
- `fix-in-progress` (name who is on it), `fixed` (add the commit hash),
  `wontfix` (add the reason), `deferred` (rolls into the next batch).

## Phase: investigate and record (status: collecting)

When Calvin reports a problem:

1. **Understand the report.** Restate the symptom; if his message includes
   output, treat it as primary evidence.
2. **Investigate to root cause.** Read the relevant code; follow the layer
   map in CLAUDE.md (domain / services / db helpers / cli / web). Read-only
   `execos` commands (`task list`, `task show`, `taskops hydrate`, `--format
   json` reads) are allowed for reproduction. Do not run writes unless Calvin
   explicitly says to in this session; propose the write and let him run it.
3. **Do not fix anything.** No application code changes, no commits, during
   collection. The fix happens in the fixing phase under a sequenced plan.
   (Exception: Calvin explicitly says "just fix this one now".)
4. **Append the issue entry** per the format above, `Status: in-discussion`,
   with every unresolved point listed under Open questions.
5. **Discuss to agreement.** Reporting is not the job; agreement is. Work
   the open questions through with Calvin in this session:
   - anything architectural (when a fix would touch structure or the
     constitution, bring in the architecture-management-dev COMPLY lens
     before agreeing to it);
   - anything that needs his decision (behavior changes, defaults, UX);
   - any choice between competing ways to fix it.
   Recommend a position on every question; never hand him a bare list of
   questions. As each one resolves, fold the answer into the permanent
   record (Rulings, and the Agreed fix text) and delete it from Open
   questions.
6. **Mark it ready.** When Calvin and the agent agree on what the problem is
   and how to fix it, delete the now-empty Open questions block, set
   `Status: ready`, and report back with the issue ID. If something cannot
   be resolved in this session, leave the issue `in-discussion` with the
   remaining questions; it must reach `ready` (or `wontfix`/`deferred`)
   before sequencing.

### Concurrency protocol (multiple sessions, one document)

Parallel sessions share one working tree, so the batch document is a shared
file:

- **Re-read the batch document immediately before editing it.** Another
  session may have appended since you last read it.
- Take the next `ISS-NNN` from the current max at edit time, append at the
  end of `## Issues`, and never renumber, reorder, or rewrite another
  session's entry.
- If the edit fails because the file changed underneath you, re-read and
  retry the append.
- **Commits**: the session that creates a batch may commit the fresh document
  once (a safe checkpoint before parallel testing starts). After that, do not
  commit the batch document during collection; parallel sessions would race
  each other's staging. The sequencing session commits the accumulated
  entries.

## Phase: sequencing

When Calvin says the testing round is done ("sequence the batch", "plan the
fixes"):

1. Read every issue in the active batch.
2. Finish any issue still `in-discussion`: work its remaining open questions
   with Calvin until it is `ready` (or he calls it `wontfix` or `deferred`).
   Sequencing plans only `ready` issues.
3. Order the fixes: group issues into waves by file overlap and dependency.
   Issues touching the same files serialize within a wave; disjoint issues
   can run in parallel (worktree sub-agents are an option for big waves, per
   the established orchestration pattern).
4. Write the `## Fix Plan` section: a wave table (wave, issue IDs, files,
   parallel-safe or serialized, suggested executor) plus a short rationale
   for the ordering.
5. Present the plan to Calvin. On approval, set frontmatter `status: fixing`
   and commit the batch document.

## Phase: fixing

- Execute waves per the approved plan. Every fix follows the project's normal
  rules: architecture COMPLY before structural changes, all gates green
  (`typecheck`, `lint`, `npm test`, `arch:check`) before a wave is called
  done.
- As each issue lands, update its `Status` to `fixed` with the commit hash.
  Touch only the status line of the issue you fixed.
- If a fix reveals a new problem, append it as a new issue (it can be fixed
  in a later wave or deferred); do not silently widen an existing entry.

## Phase: closeout

When Calvin says to close the batch:

1. Every issue must be terminal: `fixed`, `wontfix` (with reason), or
   `deferred`.
2. Write `## Closeout`: issues fixed (with commits), issues deferred or
   wontfixed, and anything notable the batch taught us.
3. Set frontmatter `status: closed` and `closed: YYYY-MM-DD`; commit.
4. `deferred` issues are copied into the next batch when it opens, marked
   with their origin ("deferred from batch 001").

## Final Verification (batches)

Before ending a batch-mode turn, confirm:

1. The entry was appended to the one active batch document (no second active
   batch was created), starting with its `---` divider.
2. The permanent record stands alone: symptom, root cause with file
   references, and an agreed fix a cold agent could execute.
3. No issue was marked `ready` while its Open questions block still had
   entries, and no `ready` issue still carries an Open questions block.
4. Nothing in `src/` was modified during a collecting-phase session.
5. The batch document was not committed during collection (except the
   one-time creation checkpoint) and WAS committed at sequencing and
   closeout.
