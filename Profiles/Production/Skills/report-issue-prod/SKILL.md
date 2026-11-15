---
name: report-issue-prod
description: >-
  Use when Jordan wants to report a bug, request a change, suggest an
  enhancement, or flag anything in ExecOS that is broken, annoying,
  confusing, or could be better. Triggers on phrases like 'report a bug',
  'this is broken', 'this isn't working', 'this is annoying', 'I want to
  request a change', 'feature request', 'can you make it...', 'I wish...',
  'I don't like how X works', 'something is wrong', or any other expression
  of friction with the system. Files a GitHub issue via `gh issue create`
  after one-step confirmation, so Calvin can pick it up. Does NOT diagnose
  or fix the issue in-session — this skill is the explicit hand-off path
  to the developer, not a general bug-fix skill.
---

# Context

This is the production-side entry path for Jordan to send bugs and change
requests to Calvin without leaving the chat. Jordan reports in plain language;
the agent (you) drafts a clean GitHub issue, gets a one-step confirmation,
files the issue with `gh issue create`, and reports the URL back. Calvin sees
it on his GitHub notifications, picks it up via the `resolve-requests-dev`
skill, ships fixes, and the cycle repeats.

**Friction is the enemy.** Jordan is reporting a problem because he wants it
fixed, not because he wants a conversation. Optimize for "ten seconds from
complaint to filed issue." Every extra question taxes the next time he wants
to report something — and the whole point of this skill is that reporting
should feel effortless.

**Do not diagnose or fix the issue yourself.** Even if the fix is a one-line
obvious change, this skill's job is to *file*, not to *fix*. Calvin handles
fixes via `resolve-requests-dev`. (If Jordan explicitly wants something fixed
in-session — "fix this for me right now" — that is a different request and
this skill should not have triggered.)

# Workflow

Track your progress through this workflow. Identify the report, draft, confirm,
file via `gh`, report the URL.

1. **Recognize the trigger.** Match Jordan's phrasing against the trigger
   patterns in the description. If unsure whether Jordan wants this skill or
   wants the current agent to fix something in-session, default to fixing
   in-session — this skill is the explicit hand-off path, not the default
   response to any complaint.
2. **Understand the report.** Read what Jordan said. If it is unambiguous
   enough to draft a usable issue, skip step 3.
3. **Ask at most one clarifying question.** Only ask if not asking would
   create genuine ambiguity that would block a fix. Cap at one question per
   report; otherwise file the best-effort issue and note the ambiguity in
   the body so Calvin can clarify on his side.
4. **Draft and confirm.** Print this exact shape to Jordan:

   ```
   **<short title>**

   - Type: bug | change-request | enhancement | other
   - Summary: <one short paragraph in plain language>
   - Acceptance: <one sentence describing what "fixed" looks like>

   File this on GitHub?
   ```

   Treat any of "yes", "yep", "go ahead", "ship it", "do it", "sounds good",
   a thumbs-up, or similar as approval. Treat anything else as a request to
   revise — re-draft and confirm again.
5. **File the issue.** Run `gh issue create` per [Filing the Issue](#filing-the-issue).
6. **Handle auth failure if the call errors.** If `gh issue create` fails
   because Jordan isn't authenticated to GitHub on this machine, walk him
   through `gh auth login` per [Auth Failure Walkthrough](#auth-failure-walkthrough).
   Don't retry automatically — once he's signed in, ask him to repeat the
   report and start fresh.
7. **Confirm to Jordan.** End with one short line: `Filed as <issue-url>.`
   No summary, no recap.

# Reference

## Friction Discipline

**Ask only when not asking would block a fix.** Examples of when asking is
justified:

- "The workspace thing is broken" — several distinct workspace features
  exist and you can't tell which is meant.
- A desired behavior that contradicts an existing behavior, and you can't
  tell whether Jordan wants the existing behavior changed or a new mode
  added alongside it.
- A bug report has no symptom — only "it's broken" — and you can't infer
  what was tried.

**Do not ask for** any of these — fill them in yourself:

- A title (you write one).
- A type/category (you pick one).
- Repro steps you can reasonably infer.
- Severity / priority / urgency (Calvin decides).
- "Is there anything else you'd like to add?" — if there is, Jordan will
  say so.
- "What component does this affect?" — Calvin can read the codebase.

If you have any reasonable interpretation of the complaint, draft the issue
and confirm. Jordan can correct you in seconds; he can't get back the time
you spent interrogating.

## Type Classification

- **bug** — something is broken or behaves wrong against its current intent.
- **change-request** — existing behavior should change.
- **enhancement** — net-new functionality.
- **other** — doesn't fit any of the above.

When in doubt between bug and change-request, prefer bug if Jordan described
the behavior as wrong/broken, change-request if Jordan described it as fine
but suboptimal.

## Title Discipline

Write the title under ~70 chars in the active voice from the *fix*
perspective, not from the complaint perspective. Examples:

- Bad: "The dashboard is annoying when I switch projects"
- Good: "Dashboard loses focus on project switch"

- Bad: "I wish I could pin tasks"
- Good: "Add task-pinning support"

## Filing the Issue

Run `gh issue create` from the repo root. Pass the title via `--title`,
the body via `--body`, and skip the interactive prompts with `--web=false`
implied (no flag — just pass title and body and it runs non-interactively).

The body shape:

```
**Type:** <type>
**Reported:** <YYYY-MM-DD>
**Reporter:** Jordan

## Summary

<the same Summary you confirmed above>

## Acceptance

<the same Acceptance you confirmed above>
```

Use today's date. Use HEREDOC-style multiline `--body` from the shell, or
escape newlines correctly per your shell. On Windows + bash, the safest
form is to write the body to a temp file and pass `--body-file`:

```bash
gh issue create \
  --title "<title>" \
  --body-file <(cat <<'EOF'
**Type:** <type>
**Reported:** <YYYY-MM-DD>
**Reporter:** Jordan

## Summary

<summary text>

## Acceptance

<acceptance text>
EOF
)
```

Or with PowerShell, build the body in a here-string variable and pass
`--body $body`. Either works — pick whichever the current shell supports
cleanly.

`gh` reads the repo from the current directory's git remote, so make sure
the cwd is inside the execos checkout. If `gh` complains about
no repo, fall back to `gh issue create -R calvinl345/execos ...`.

The successful exit prints the new issue URL on stdout. Capture it and use
it in the closeout line.

## Auth Failure Walkthrough

If `gh issue create` errors with anything mentioning `not logged in`,
`authentication`, `gh auth`, or HTTP 401 / 403, Jordan isn't authenticated
to GitHub on this machine yet. Tell him this — verbatim, copy-pasteable:

```
You're not signed in to GitHub on this machine yet. One-time setup,
about 30 seconds:

1. Run this in your terminal:

       gh auth login

2. Pick the answers in this order:
   - "What account do you want to log into?" → GitHub.com
   - "What is your preferred protocol for Git operations?" → HTTPS
   - "Authenticate Git with your GitHub credentials?" → Y
   - "How would you like to authenticate GitHub CLI?" → Login with a web browser

3. The terminal will print an 8-character code (like ABCD-1234) and open
   github.com/login/device in your browser. Type or paste the code there
   and click "Authorize".

4. The terminal will flip to "Logged in as <your-username>". You're done.

Then tell me to file the bug again and I'll take care of it.
```

Do not retry the `gh issue create` automatically after telling Jordan. Wait
for him to come back. When he does, start fresh from step 1 of the
workflow — don't assume the earlier draft is still what he wants.

If the error is *not* an auth error (e.g. network, gh missing entirely,
repo not configured), tell Jordan plainly what the error said and ask
whether he wants to troubleshoot it or skip filing for now. Don't loop on
retries.

## Multi-Report Handling

If Jordan reports several issues in one message, each gets its own GitHub
issue. Draft them all, confirm them as a batch ("I'll file these as three
issues — ship?"), then file them in sequence. Report all the URLs in the
closeout, one per line.

# Out Of Scope

- **Do not diagnose or fix the issue yourself.** Even one-line obvious
  changes go through Calvin's `resolve-requests-dev` flow.
- **Do not create labels, assignees, milestones, or projects.** Plain
  `gh issue create --title --body` only. Calvin manages triage labels on
  his side.
- **Do not edit the repo working tree** as part of filing an issue. The
  issue lives on GitHub, not in this checkout.
- **Do not invoke `resolve-requests-dev` afterward** — that's Calvin's
  flow, not Jordan's.

# Edge Cases

- **Same issue reported twice across messages.** Don't file duplicates —
  update the in-progress draft and confirm once.
- **Misunderstanding** (e.g., "the build is broken" when Jordan ran the
  wrong command). Briefly clarify before filing. If after clarifying
  Jordan still wants it filed, file it.
- **Out-of-scope reports** (a bug in a different project, not Jordan Daily
  OS). Tell Jordan this issue tracker is for ExecOS only and
  don't file it.
- **`gh` not installed.** Tell Jordan he needs to install GitHub CLI from
  cli.github.com (one-time, then `gh auth login` per [Auth Failure
  Walkthrough](#auth-failure-walkthrough)). Don't try to install it
  yourself.
- **Network down / GitHub unreachable.** Tell Jordan plainly, ask whether
  he wants to retry or come back later. Do not stash the report locally —
  filing is the whole job.

# Final Verification

After completing the work, review against these checks:

1. Was the issue filed via `gh issue create` and did the call succeed?
2. Are the title, type, summary, acceptance grounded in what Jordan
   actually said, not invented or inflated?
3. Did Jordan confirm the draft before any `gh` call?
4. Did the closeout line include the actual issue URL printed by `gh`?
5. Did the agent stop after one clarifying question (or zero)?
6. If auth failed, was Jordan given the exact `gh auth login` walkthrough
   above, with no automatic retry?
