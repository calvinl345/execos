# Change Contract Schema Reference

Use this reference when drafting, reviewing, updating, or converting a Change Contract into a build-ready Change Plan.

The Change Contract is not meant to be shown raw by default. Maintain it internally as structured state, then present a human review view that lets the user align the contract without evaluating code-level details.

## Contract Object Shape

```json
{
  "change_intent": {
    "raw_user_request": "",
    "plain_english_summary": "",
    "acceptance_criteria": [],
    "explicit_non_goals": []
  },
  "current_reality": {
    "confirmed_facts": [],
    "inferred_facts": [],
    "unknowns": [],
    "evidence": []
  },
  "target_delta": {
    "what_changes": [],
    "what_stays_the_same": [],
    "user_visible_outcome": ""
  },
  "proposed_mechanism": {
    "conceptual_design": "",
    "operation_boundaries": [],
    "data_flow": [],
    "interfaces": [],
    "enforcement_points": []
  },
  "principles_applied": [
    {
      "principle": "",
      "where_applied": "",
      "design_consequence": ""
    }
  ],
  "risk_register": [
    {
      "risk": "",
      "why_it_matters": "",
      "status": "open | resolved | accepted",
      "resolution_options": [],
      "chosen_resolution": ""
    }
  ],
  "decisions": [
    {
      "decision": "",
      "reason": "",
      "replaces_or_updates": [],
      "locked": false
    }
  ],
  "invariants": [
    {
      "invariant": "",
      "why_it_matters": "",
      "enforcement_point": "",
      "verification": ""
    }
  ],
  "verification": {
    "required_checks": [],
    "user_demo": "",
    "failure_cases_to_test": []
  },
  "execution_scope": {
    "size": "small | medium | too_large",
    "split_recommendation": "",
    "ready_to_build": false
  }
}
```

## Human Review View

When presenting the contract to the user, do not dump the full object unless asked. Use this compact review surface:

```markdown
## What I think you want changed
[Plain English.]

## What I believe is true now
Confirmed:
- [Fact.]

Inferred:
- [Inference.]

Unknown:
- [Unknown.]

## How I think the change should work
[Conceptual mechanism.]

## Main risks
- [Risk + why it matters + current status.]

## Decisions needed
- [Decision the user can answer.]

## How we would prove it worked
- [Verification evidence.]
```

The review view should make architectural consequences visible without asking the user to validate syntax, file structure, or low-level implementation details.

## Feedback Normalization

Convert user feedback into durable contract objects.

| User feedback pattern | Contract update |
|---|---|
| "I want X" | Add or revise acceptance criterion |
| "I don't want Y" | Add explicit non-goal |
| "That's not how it works" | Revise current reality; mark previous claim replaced |
| "What if X happens?" | Add risk or failure case |
| "We should do X instead" | Add decision or mechanism change |
| "That must never happen" | Add invariant |
| "How would I know it worked?" | Add verification requirement |
| "That's too much" | Add scope adjustment or split recommendation |
| "Yes, lock that in" | Mark decision resolved or locked |

After normalizing feedback, summarize only the delta: what changed in the contract and what remains unresolved.

## Risk Analysis Prompts

Run these checks before producing a build-ready plan:

1. **User understandability:** Can the user say yes/no to the desired change, mechanism, risks, and verification without reading code?
2. **Agent executability:** Is the contract specific enough for an implementation agent to know what to inspect, change, avoid, and verify?
3. **Scope size:** Can this be completed in one reliable implementation pass, or should it be split?
4. **Current reality confidence:** Which claims are confirmed, inferred, or unknown?
5. **Bypass risk:** Can the agent or code path bypass the mechanism that provides reliability?
6. **Staleness risk:** Could context, data, or assumptions become stale during the agent session?
7. **Interface depth:** Does the mechanism create a simple interface over deeper complexity, or does it leak complexity into every caller?
8. **Verification strength:** Would the verification catch the failure the user actually cares about?

## Design Principles to Apply

Use principles only where they affect the contract. Do not cite principles ornamentally.

### Deep module, simple interface

Use when the change introduces or modifies an operation boundary. The desired shape is a simple caller-facing command or interface that hides internal complexity such as duplicate detection, validation, auditing, context hydration, or database writes.

Good consequence: "All task creation goes through one canonical operation; callers do not directly assemble database writes."

Bad consequence: "Every prompt or caller must remember all duplicate, status, and validation rules."

### Single enforcement boundary

Use when reliability depends on preventing bypass. If the agent can still directly call lower-level write commands, the contract has not actually enforced the reliability behavior.

Good consequence: "The reliable operation is the only exposed write path for this task flow."

Bad consequence: "The reliable operation exists, but the agent can still ignore it and write directly to the database."

### Evidence before confidence

Use when current reality is uncertain. Keep confirmed facts, inferred facts, and unknowns separate so the user can reason about the contract without false certainty.

Good consequence: "The plan says which task paths were inspected and which remain unknown."

Bad consequence: "The plan asserts there is one task creation path without inspecting the code."

### Change contracts, not app contracts

Use when the draft starts expanding into a whole-system redesign. The contract should represent one bounded change from current state to target state.

Good consequence: "Reliable task creation with duplicate warning."

Bad consequence: "Redesign all task management, goals, dashboard sync, and agent workflows in one pass."

### Verification as product evidence

Use when the plan's proof is too code-centric. The user needs to know what behavior they can observe after implementation.

Good consequence: "Try to create a duplicate task and confirm the system warns instead of silently duplicating."

Bad consequence: "Review code and confirm it looks correct."

## Ready-to-Build Criteria

A contract is ready to convert into a Change Plan when all are true:

1. The target delta is clear.
2. The proposed mechanism is understandable to the user.
3. Major risks are either resolved, explicitly accepted, or converted into verification requirements.
4. Unknowns do not block implementation, or the plan begins with a required inspection step.
5. Scope is small or medium, not too large.
6. Verification evidence is concrete.
7. The plan can stand alone as an implementation prompt.
