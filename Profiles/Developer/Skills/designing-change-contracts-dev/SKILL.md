---
name: designing-change-contracts-dev
description: Use when a user wants to turn a messy software change request, feature idea, reliability problem, refactor, or product improvement into an inspectable Change Contract and build-ready change plan. Trigger when the user asks to plan, scope, de-risk, or prepare an agent-build prompt for a software change. Do not use for direct implementation, code review, or generic brainstorming unless the user is trying to convert the idea into an executable change contract.
---

# Context

This skill helps an agent bootstrap a reliable software change from incomplete user intent. Its job is to externalize the contract state, let the user iteratively align the contract without holding the whole architecture in their head, and end with a build-ready change plan that can be used as an implementation prompt.

The central object is a Change Contract: a bounded, evolving representation of the current state, desired delta, proposed mechanism, risks, decisions, and verification plan for one software change.

# Pre-flight

Before drafting the contract, verify that the requested change is about software behavior, architecture, data flow, agent workflow, UI behavior, or implementation reliability.

If the request is too broad to evaluate as one change, do not reject it. Create an initial contract that marks the scope as too large and recommends the first contract-sized slice.

If current application reality is unavailable, state which parts of the contract are inferred rather than confirmed. The contract must distinguish evidence-backed facts from guesses because false certainty is the main failure mode this skill prevents.

# Workflow

Track your progress through this workflow. Create a checklist from these steps at session start and update it as you complete each step.

1. **Capture the raw intent.** Restate the user's request as a proposed change, including the user-visible outcome and any explicit non-goals.

2. **Inspect or infer current reality.** Identify what is known about the current application, what is inferred, and what remains unknown. Use code inspection or user-provided evidence when available.

3. **Draft the Change Contract.** Build the contract using the schema in `references/change-contract-schema.md`. Keep the contract focused on one bounded change, not the entire application.

4. **Present a human review view.** Show the user only the compact review surface described in `references/change-contract-schema.md`. This first review response must be short enough for fast human evaluation: no full Change Plan, no implementation checklist, and no exhaustive evidence dump.

5. **Normalize feedback into contract updates.** Convert each user comment into one of these object types: acceptance criterion, non-goal, confirmed fact, inferred fact, unknown, mechanism change, risk, decision, invariant, verification requirement, or scope adjustment.

6. **Run contract risk analysis.** Evaluate whether the contract is understandable to the user, executable by an agent, and verifiable afterward. Use the risk analysis prompts in `references/change-contract-schema.md`.

7. **Resize or split the contract if needed.** If the change is too broad, too ambiguous, or too architecture-dependent for one reliable agent pass, produce the smallest buildable slice that still moves toward the user's intent.

8. **Generate the change plan.** Produce a build-ready change plan that an implementation agent can follow. Include current reality, target delta, mechanism, constraints, risk resolutions, files or areas to inspect, implementation steps, and verification evidence.

9. **Final verification.** Check the skill output against the Final Verification section before presenting it.

# Output Specification

The final output is a **Change Plan** that can be pasted into a coding agent as an implementation prompt.

Use this structure:

```markdown
# Change Plan: [short title]

## Goal
[Plain-English outcome.]

## Current Reality
- Confirmed:
  - [Evidence-backed fact.]
- Inferred:
  - [Reasonable inference.]
- Unknown:
  - [Question or missing information.]

## Target Delta
- [What changes.]
- [What stays the same.]
- [Explicit non-goals.]

## Proposed Mechanism
[Conceptual design the user can evaluate.]

### Operation Boundaries
- [Boundary or interface.]

### Data Flow
- [Input -> process -> output.]

### Enforcement Points
- [Where correctness is protected.]

## Risks and Resolutions
- Risk: [risk]
  - Resolution: [chosen resolution]
  - Status: [resolved / accepted / open]

## Decisions and Invariants
- Decision: [decision and reason.]
- Invariant: [thing that must remain true.]

## Implementation Instructions
1. [Step.]
2. [Step.]
3. [Step.]

## Verification Evidence
- Automated checks:
  - [Test/check.]
- User-visible demo:
  - [How the user can confirm behavior.]
- Failure cases:
  - [Case to test.]

## Agent Constraints
- Do not implement outside this scope.
- Do not silently change unresolved decisions.
- If current reality contradicts this plan, stop and report the mismatch before coding.
```

# Gotchas

- Do not output the final Change Plan before the user has reviewed the compact contract. A long plan too early recreates the cognitive overload this skill exists to prevent.
- Do not present confirmed facts as a citation-heavy wall. Summarize the implications first, then keep detailed evidence in the internal contract until the user asks for it.
- Do not treat a polished contract as proof that the design is correct. The contract is a working object for alignment, not a truth oracle.
- Do not bury uncertainty in confident prose. Unknowns and assumptions must remain visible because the user can only align the change if the boundary between fact and inference is clear.
- Do not convert every concern into immediate implementation work. Some concerns become risks, decisions, verification requirements, or scope splits.
- Do not let the implementation agent bypass the proposed mechanism. If reliability depends on an operation boundary, the change plan must identify the enforcement point that prevents bypass.

# Final Verification

Before presenting the final Change Plan, verify:

1. Does the plan describe one bounded change rather than an entire application redesign?
2. Are current reality, inferred reality, and unknowns clearly separated?
3. Can a smart non-senior-engineer user understand the proposed mechanism well enough to question it?
4. Are major risks represented as durable objects with status and resolution?
5. Are user feedback and decisions reconciled into the contract instead of left as chat-only context?
6. Is the contract sized so one implementation agent pass has a realistic chance of success?
7. Does the verification plan include concrete evidence, not just "review the code"?
8. Does the final output work as an implementation prompt without requiring the previous conversation?
