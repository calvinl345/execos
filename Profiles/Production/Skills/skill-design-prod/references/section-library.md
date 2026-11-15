# Section Library

This file provides detailed guidance on writing each section of a SKILL.md file. The canonical template defines seven sections. Not every skill needs all of them — include only what the skill requires. After the canonical sections, this file also covers reusable patterns that can be used within sections.

Read this file when you are writing or scaffolding a skill. You do not need to read it during discovery or review.

---

## Context

**Purpose:** Orient the agent at the top of the file. This is the highest-retrieval position (80-90%), so put the most critical information here.

**When to include:** Every skill.

**What to write:**

- What the skill does and when it applies. If the description frontmatter already covers this clearly, the Context section should add only what the description can't carry — pipeline position, critical framing, or boundary constraints.
- Any constraints so important they need the highest-retrieval position — things like "never do X" or "always defer Y to another skill."
- Keep to 1-5 sentences. This is not background or theory. If you're writing more than a short paragraph, content probably belongs in Reference instead.

**Example (pipeline skill):**

```markdown
# Context

This is step 2 of 6 in the Northwind site planning pipeline. Take the offer
diagnosis produced by the previous step and expand it into a full belief
inventory with classifications and dependency relationships.

**Boundary:** This skill produces the belief architecture artifact only. Do not
suggest pages, sections, or copy — those belong to downstream skills.
```

**Example (standalone skill):**

```markdown
# Context

Design and write SKILL.md files using research-backed principles. Covers skill
discovery, architecture, constraint discipline, and output specification.

**Boundary:** Stay in this skill for SKILL.md content and structure. Use
managed-skill-authoring for registration, scope configuration, and sync.
```

---

## Pre-flight

**Purpose:** Validate that everything the skill needs is present before work begins. Fails fast so the agent doesn't waste effort on a task that can't succeed.

**When to include:** Pipeline skills that depend on input artifacts. Skills that depend on external state (files, tools, APIs). Skills where starting without prerequisites wastes significant effort. Omit entirely if there are no preconditions.

**What to write:**

- List what must be true before the skill begins.
- For each check, specify what to verify and what to do if the check fails (usually: tell the user and stop).
- Keep it short. If the checklist exceeds ~10 items, write a pre-flight script in `scripts/` instead.

**Inline example:**

```markdown
# Pre-flight

Before starting, verify:

- The offer diagnosis artifact exists at `<project>/01-offer-diagnosis.md`
- The artifact contains at least: dream outcome, core obstacles, belief gaps,
  and buyer starting state
- If either check fails, tell the user what is missing and stop.
```

**Script-based example (for complex validation):**

```markdown
# Pre-flight

Run `scripts/preflight.py <project-path>` before starting. If it reports
failures, present them to the user and stop. Do not proceed until all checks
pass.
```

---

## Workflow

**Purpose:** The operational spine of the skill. This is the section the agent follows step by step. Everything else in the skill supports this section.

**When to include:** Every skill except pure routing skills (which use a dispatch table instead).

**What to write:**

- A numbered list of steps the agent executes in order.
- Each step should be a clear, unambiguous action — not guidance, not theory, not context.
- When a step needs detailed guidance, link to a Reference section below: "See [Section Name](#section-name) for details."
- When a step requires an external file, say so explicitly: "Read `references/schema.md` for field definitions."
- Include an instruction at the top telling the agent to create a progress checklist from these steps.
- If the skill has multiple branches (different workflows for different scenarios), put an explicit routing table at the top of the Workflow section before any numbered steps. Use clear if-then language: "If the user wants X → follow [Workflow A](#workflow-a)."

**Branching example:**

```markdown
# Workflow

This skill handles two types of requests. Determine the type first, then
follow only the workflow for that type.

- If the user wants to **create a new document** → follow [Creation Workflow](#creation-workflow)
- If the user wants to **review an existing document** → follow [Review Workflow](#review-workflow)

## Creation Workflow

Create a checklist from these steps at session start.

1. Ask the user about target audience and purpose.
2. Gather source material. See [Source Requirements](#source-requirements) for what to collect.
3. Write the document following the [Output Specification](#output-specification).
4. Verify the output against the [Final Verification](#final-verification) checklist. Revise if any check fails.
5. Present and stop.

## Review Workflow

Create a checklist from these steps at session start.

1. Read the document.
2. Evaluate against [Review Criteria](#review-criteria).
3. Present findings with specific recommendations.
```

**Linear example (no branching):**

```markdown
# Workflow

Create a checklist from these steps at session start. Update it as you
complete each step.

1. Run pre-flight validation.
2. Read the input artifact and verify required sections.
3. Mine beliefs across all 14 categories.
4. Classify each belief (core, supporting, decorative, adverse).
5. Map dependency relationships between beliefs.
6. Write the belief architecture artifact to `<project>/02-belief-architecture.md`.
7. Present summary of key decisions to user and stop.
```

**Key principles:**

- Steps should be concrete actions, not vague goals. "Ask the user about their target audience" not "Understand the user's needs."
- The last step should always include "stop" — especially for pipeline skills where the agent might otherwise continue to the next skill.
- If a step has a validation gate (something that must be true before proceeding), state it explicitly within that step.

---

## Output Specification

**Purpose:** Define what the skill produces — the deliverable's structure, required fields, and format. Without this, the agent makes its own structural decisions, which may vary across invocations.

**When to include:** Every skill that produces a structured deliverable. Omit for review/analysis skills that produce prose feedback.

**Choosing the approach:**

- Use a **structural template** (show the exact heading hierarchy with bracketed placeholders) when the output is consumed by another skill, has repeating record structures, or needs precise hierarchy for downstream parsing.
- Use a **prose specification** (describe the target shape in sentences) when the output is for humans only, the structure is flexible, or the content is creative.

**Structural template example:**

```markdown
# Output Specification

```markdown
# Offer Diagnosis

## Dream Outcome
[one-sentence summary of the buyer's desired end state]

## Core Obstacles

### [obstacle written as a belief statement]
- **Belief Gap:** [the missing or distorted buyer belief]
- **State:** [the journey state where this gap matters]
- **Why It Matters:** [why this gap affects conversion]

### [next obstacle]
...

## Buyer Starting State
[beliefs the buyer holds before encountering the site]
`` `
```

**Prose specification example:**

```markdown
# Output Specification

Return an analysis covering: primary risk factors identified, how they interact,
which are within the team's control, and a recommended priority order. Structure
the analysis however best communicates the relationships between factors.
```

**Writing tips:**

- For structural templates, use bracketed placeholders for content: `[one-sentence summary]`.
- For repeating structures, show one complete instance and indicate repetition: `### [next obstacle] ...`
- Specify how to handle missing information: `[PROOF NEEDED: what's missing]` rather than omitting the field.

---

## Gotchas

**Purpose:** Capture environment-specific facts that defy reasonable assumptions. These are concrete corrections to mistakes the agent will make without being told — often the highest-value content in a skill.

**When to include:** Skills that operate in environments with non-obvious constraints, naming conventions, or legacy quirks. Also: any skill after its first round of real testing. Omit for brand-new, untested skills — add gotchas as you discover them.

**What to write:**

- Each gotcha is a specific, concrete fact — not general advice like "handle errors appropriately."
- State the gotcha, then explain what goes wrong if the agent ignores it.
- Order by severity — worst failures first.
- Keep in the SKILL.md, not a reference file, because the agent needs to see them *before* encountering the situation.

**Example:**

```markdown
# Gotchas

- The belief architecture artifact uses a flat list, not a tree. Dependencies
  are expressed as `depends_on` references within each belief record. Agents
  that render this as nested structure lose dependency information that crosses
  branches.
- "Core" classification means the belief is necessary for the conversion chain.
  It does not mean important or interesting. A belief can be fascinating and
  still be "supporting" if removing it doesn't break the chain.
- The buyer starting state must include beliefs the buyer already holds
  correctly, not just misconceptions. Some starting beliefs are assets the
  narrative should reinforce.
```

---

## Reference

**Purpose:** Provide detailed guidance, tool formats, question banks, exit conditions, criteria, examples, and other information that workflow steps link to. This is where depth lives.

**When to include:** Whenever a workflow step needs more detail than fits in a single numbered item.

**Placement:** The middle of the file — the low-retrieval zone (20-40%). This is fine because the agent accesses reference sections on demand when a workflow step points to them, not by internalizing the entire section upfront.

**What to write:**

- Organize by topic, with each topic as an H2 under the `# Reference` heading.
- Name each section so the workflow can link to it with a markdown anchor: `See [Memory Retrieval](#memory-retrieval) for details.`
- Within each reference section, use whatever structure communicates best: bullet lists, code blocks, numbered steps, tables, examples.
- Focus on what the agent wouldn't know without being told. Skip general knowledge.

**When to use external files instead:** If the reference material for a single topic exceeds ~100 lines, move it to `references/` and add an explicit load trigger in the workflow step: "Read `references/api-guide.md` for the full API surface." Keep the SKILL.md's Reference section for content under ~100 lines per topic.

**Example:**

```markdown
# Reference

## Memory Retrieval

Use the managed `memory-retrieval` MCP tool `retrieve_memories` with:

- `skill_id="belief-architecture"`
- `query_text="<current task summary>"`

Retrieve before making design decisions. Retrieve again when the task shape
changes materially.

## Exit Conditions

Each discovery phase has a specific exit condition. Do not proceed to the next
phase until the condition is met.

- **Objective:** Can state the skill's job in one sentence with confirmed scope.
- **Task type:** Identified and confirmed by user.
- **Success criteria:** Can describe pass/fail concretely.
```

---

## Final Verification

**Purpose:** A self-priming checklist at the very end of the skill that forces the agent to retrieve and verify key constraints before presenting output. The end of the file is the second-highest retrieval zone (75-85%), making this the last thing the agent processes before responding. Named "Final Verification" rather than "Before You Begin" to make the timing unambiguous — this runs after the work is done, not before.

**When to include:** Skills with critical constraints that tend to be violated in practice. Not every skill needs this — add it when you observe the agent forgetting specific rules during generation.

**What to write:**

- 3-7 verification questions focused on properties of the *output* that the agent might get wrong even after following the workflow correctly.
- Target only constraints that are *actually violated in practice*. Do not add questions for things the agent gets right consistently.
- Frame as post-hoc verification: "Does the output satisfy X?" or "Is Y true of what I produced?"
- The corresponding workflow step should explicitly say to review against this checklist and revise if any check fails.

**Example:**

```markdown
# Final Verification

After completing the work, review the output against these checks. If any
check fails, revise before presenting to the user.

1. Does the skill have a clear Workflow with numbered steps?
2. Is the active constraint count at or under 15?
3. Are critical constraints at the beginning or end, not buried in the middle?
4. Does each rule explain *why* it matters?
5. Is the file under 500 lines?
```

---

# Reusable Patterns

These patterns can be used within the canonical sections — typically within Workflow steps or Reference sections. They are not standalone sections.

## Validation Loop

**What it does:** Instructs the agent to validate its own work, creating a self-correction cycle.

**Use within:** A Workflow step, or as a dedicated Reference section the workflow links to.

**When to use:** Skills where the output must meet structural or quality requirements and mistakes are detectable. Especially valuable when a script can verify output programmatically.

**Pattern:**

```markdown
After writing the artifact:

1. Verify every record has all required fields
2. Verify all cross-references point to records that exist
3. Verify count is within expected range (10-30)
4. If any check fails, fix the issue and re-verify
5. If issues persist after 3 attempts, present remaining problems to the user
```

## Plan-Validate-Execute

**What it does:** For batch or destructive operations, forces the agent to create an explicit plan, validate it, and execute only after validation passes.

**Use within:** A Workflow step or sequence of steps.

**When to use:** Skills where mistakes are expensive or hard to undo. Batch operations, external system modifications, anything where "undo" is difficult.

**Pattern:**

```markdown
1. Produce a migration plan as `plan.json` listing every operation
2. Run `scripts/validate_plan.py plan.json` to verify correctness
3. Present the plan summary to the user for review
4. Execute only after the user approves and validation passes
```

## Routing Table

**What it does:** Maps trigger patterns to actions for skills that dispatch across multiple paths. Used instead of a sequential Workflow for routing-type skills.

**Use within:** The Workflow section of routing-type skills.

**When to use:** Skills where the agent's job is to recognize what the user wants and dispatch to the right action or sub-process.

**Pattern:**

```markdown
# Workflow

Identify which route matches the user's request, then follow it.

## Raw CLI Commands
When the user wants to run a command directly in a terminal.
→ Execute the command in the current shell.

## Claude Code Agent
When the user wants Claude Code to handle the task.
→ Read and follow `cookbook/claude-code.md`.

## Codex Agent
When the user wants Codex to handle the task.
→ Read and follow `cookbook/codex-cli.md`.
```

**Key principles:** Use descriptive headings with keywords the agent matches against. Do not use IF/THEN logic or boolean variables — let the agent recognize the match from the heading and description.

## Evaluation Rubric

**What it does:** Defines criteria for review/analysis skills where the agent evaluates something.

**Use within:** A Reference section that the Review Workflow links to.

**When to use:** Review and analysis skills — code review, document audit, quality checks.

**Pattern:**

```markdown
## Evaluation Criteria

Assess these in order of impact:

- **Task type alignment** — Is the structure appropriate for the task type?
  A code generation task forced into a workflow structure is the most common
  and most damaging structural error.
- **Constraint count** — How many active behavioral rules? Over 15 is a
  problem. Over 20 means rules are being silently dropped.
- **Hop count** — How many file reads before productive work begins?
  More than one means content should probably be inlined.
```

## Examples Section

**What it does:** Provides concrete examples of good (and optionally bad) output for the agent to pattern-match against.

**Use within:** A Reference section, placed after the Output Specification it illustrates.

**When to use:** Code generation skills with specific output formats. Skills where "show, don't tell" communicates more than specification. Skills with common failure modes a bad example can prevent.

**Pattern:**

- Keep examples short and focused on structural patterns, not full content.
- Label good and bad examples clearly if showing both.
- For long examples (50+ lines), move to `references/` or `assets/`.
