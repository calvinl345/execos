#!/usr/bin/env python3
import sys
import json
import argparse
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from string import Template

SCOPE_ALIGNMENT_PROMPT = """Current discovery phase: scope_alignment
Scope is not locked.

Ask only scope-level, user-facing questions. You may inspect the repo and draft
provisional implementation detail in solution.md, but the question you ask the
user must clarify product outcome, V1 scope, explicit exclusions, workflow
boundary, or success criteria. If a technical uncertainty matters, translate it
upward into the scope question behind that uncertainty."""

SOLUTION_ALIGNMENT_PHASE = "solution_alignment"
LEGACY_SOLUTION_DEVELOPMENT_PHASE = "solution_development"

SOLUTION_ALIGNMENT_PROMPT = """Current discovery phase: solution_alignment
Scope is locked.

Continue discovery. Do not implement application code. Ask behavior-facing and
architecture-relevant questions that help align the Solution Contract before a
separate implementation request. Still reason technically and ask behaviorally.
Avoid asking the user to choose filenames, schemas, module names, or raw
technical structure unless the user is already working at that level."""

def get_next_change_id():
    cr_dir = Path(".change-requests")
    if not cr_dir.exists():
        return "change-001"
    existing_folders = [d.name for d in cr_dir.iterdir() if d.is_dir() and d.name.startswith("change-")]
    if not existing_folders:
        return "change-001"
    nums = []
    for folder in existing_folders:
        try:
            nums.append(int(folder.split("-")[1]))
        except ValueError:
            continue
    next_num = max(nums) + 1 if nums else 1
    return f"change-{next_num:03d}"

def load_prompt_template(template_name: str, **kwargs) -> str:
    template_path = Path(__file__).resolve().parent.parent / "templates" / f"{template_name}.txt"
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            template_content = f.read()
        return Template(template_content).substitute(kwargs)
    except Exception as e:
        print(json.dumps({"status": "ERROR", "message": f"Error loading template {template_name}: {e}"}))
        sys.exit(1)

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def require_intent(args, command: str) -> str:
    intent = getattr(args, "intent", "") or ""
    intent = intent.strip()
    if command != "init" and not intent:
        print(json.dumps({"status": "ERROR", "message": f"--intent is required for {command}."}))
        sys.exit(1)
    return intent

def load_change_data(change_id: str):
    folder_path = Path(".change-requests") / change_id
    change_json_path = folder_path / "change.json"
    if not change_json_path.exists():
        print(json.dumps({"status": "ERROR", "message": f"Change ID {change_id} not found."}))
        sys.exit(1)
    with open(change_json_path, "r") as f:
        return data_with_phase_defaults(json.load(f)), change_json_path

def data_with_phase_defaults(data):
    data.setdefault("phase", "scope_alignment")
    data.setdefault("scope_locked", False)
    data.setdefault("scope_locked_at", None)
    data.setdefault("scope_lock_notes", None)
    data.setdefault("scope_events", [])
    if data.get("phase") == LEGACY_SOLUTION_DEVELOPMENT_PHASE:
        data["phase"] = SOLUTION_ALIGNMENT_PHASE
    return data

def save_change_data(change_json_path: Path, data):
    with open(change_json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def yaml_scalar(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)

def solution_front_matter(data):
    front_matter = {
        "change_id": data.get("change_id"),
        "name": data.get("name"),
        "phase": data.get("phase"),
        "scope_locked": data.get("scope_locked"),
        "scope_locked_at": data.get("scope_locked_at"),
        "scope_lock_notes": data.get("scope_lock_notes"),
        "metadata_source": "change.json",
        "metadata_schema": 1,
        "last_metadata_sync_at": utc_now_iso(),
    }
    lines = ["---"]
    for key, value in front_matter.items():
        lines.append(f"{key}: {yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines)

def strip_solution_front_matter(content: str) -> str:
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return content
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "".join(lines[index + 1:]).lstrip("\r\n")
    return content

def sync_solution_metadata(change_id: str, data):
    folder_path = Path(".change-requests") / change_id
    solution_path = folder_path / "solution.md"
    if not solution_path.exists():
        return
    body = strip_solution_front_matter(solution_path.read_text(encoding="utf-8"))
    content = f"{solution_front_matter(data)}\n\n{body}"
    solution_path.write_text(content, encoding="utf-8")

def solution_stats(folder_path: Path):
    solution_path = folder_path / "solution.md"
    if not solution_path.exists():
        return {
            "solution_md_sha256": None,
            "solution_md_bytes": None
        }
    content = solution_path.read_bytes()
    return {
        "solution_md_sha256": hashlib.sha256(content).hexdigest(),
        "solution_md_bytes": len(content)
    }

def append_event(change_id: str, command: str, intent: str, data=None, **fields):
    folder_path = Path(".change-requests") / change_id
    folder_path.mkdir(parents=True, exist_ok=True)
    event = {
        "timestamp": utc_now_iso(),
        "command": command,
        "change_id": change_id,
        "phase": (data or {}).get("phase"),
        "scope_locked": (data or {}).get("scope_locked"),
        "intent": intent
    }
    event.update(solution_stats(folder_path))
    event.update({key: value for key, value in fields.items() if value is not None})
    events_path = folder_path / "events.jsonl"
    with open(events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")

def phase_context(data) -> str:
    if data.get("phase") == SOLUTION_ALIGNMENT_PHASE or data.get("scope_locked"):
        return SOLUTION_ALIGNMENT_PROMPT
    return SCOPE_ALIGNMENT_PROMPT

def cmd_init(args):
    intent = (args.intent or args.name).strip()
    cr_dir = Path(".change-requests")
    cr_dir.mkdir(exist_ok=True)
    
    change_id = get_next_change_id()
    folder_path = cr_dir / change_id
    folder_path.mkdir(parents=True, exist_ok=True)
    
    change_json_path = folder_path / "change.json"
    solution_md_path = folder_path / "solution.md"
    
    change_data = {
        "change_id": change_id,
        "name": args.name,
        "phase": "scope_alignment",
        "scope_locked": False,
        "scope_locked_at": None,
        "scope_lock_notes": None,
        "scope_events": [],
        "questions": []
    }
    with open(change_json_path, "w", encoding="utf-8") as f:
        json.dump(change_data, f, indent=2)
        
    solution_body = (
        f"# Solution: {args.name}\n\n"
        "> Living implementation contract. Rewrite this file after every answer so it reflects the current best plan. Do not use it as a notes log; `change.json` is the question/answer ledger and source of truth for workflow state.\n\n"
        "> Metadata rule: the YAML front matter is CLI-managed. Do not edit it manually or duplicate phase/scope lock state in the markdown body.\n\n"
        "> Confidence rule: user-stated behavior and repo facts may be written as confirmed. Agent-inferred behavior, workflow mechanics, interfaces, and implementation details must stay `ASSUMED` until confirmed.\n\n"
        "> Boundary rule: this document is not permission to modify application code. It is a planning artifact until the user separately asks for implementation outside this skill workflow.\n\n"
        "## Scope Contract\n"
        "- Alignment Summary: OPEN: summarize whether the scope is clear enough to discuss solution details. Do not duplicate locked/unlocked workflow state here.\n"
        "- Workflow state is recorded in the CLI-managed metadata above and in `change.json`.\n\n"
        "### Product Outcome\n"
        "- OPEN: State the user-visible outcome this change should create and how the user will know it worked. Resolve this before narrow behavior questions.\n\n"
        "### V1 Scope\n"
        "- OPEN: List only what the user has confirmed this first version definitely includes. Put inferred scope in Assumptions instead.\n\n"
        "### Explicitly Out Of Scope\n"
        "- OPEN: List adjacent workflows or tempting extras that this change should not include.\n\n"
        "### Workflow Boundary\n"
        "- OPEN: Describe where the workflow starts, where it ends, who uses it, and what must happen before the system can call the scope complete.\n\n"
        "### Success Criteria\n"
        "- OPEN: Describe what examples or outcomes would convince the user that V1 worked.\n\n"
        "---\n\n"
        "## Solution Contract\n"
        "- This section should become increasingly implementation-complete throughout discovery, even while the Scope Contract is still open.\n"
        "- During scope_alignment, use provisional `ASSUMED` implementation detail to reveal better scope questions, but ask the user only scope-level questions.\n\n"
        "### Behavior Rules\n"
        "- OPEN: Describe user-visible behavior, failure handling, authority, lifecycle, and escalation rules.\n\n"
        "### Command Or API Surface\n"
        "- OPEN: Name the commands, APIs, options, inputs, and outputs this change introduces or modifies. Use ASSUMED for provisional surfaces derived from repo patterns.\n\n"
        "### Packet Or Data Shape\n"
        "- OPEN: Sketch the structured data, packet sections, or output format the implementation must produce.\n\n"
        "### Data Reads And Writes\n"
        "- OPEN: Identify source-of-truth tables/files, read paths, write paths, and ownership boundaries.\n\n"
        "### Module And File Impact Map\n"
        "- OPEN: Identify likely source files, tests, profile prompts, skills, or generated surfaces. Do not leave blank after repo inspection; use ASSUMED if provisional.\n\n"
        "### Provisional Build Plan\n"
        "- OPEN: Break the possible build into ordered planning steps. This is a sketch for alignment, not permission to edit application code.\n\n"
        "### Pseudocode Sketch\n"
        "```text\n"
        "OPEN: Sketch the core execution path. Use placeholders until enough is known, then replace them with concrete logic.\n"
        "```\n\n"
        "### Tests And Verification\n"
        "- OPEN: List tests, command checks, validators, smoke tests, or manual verifications required.\n\n"
        "### Assumptions\n"
        "- ASSUMED: Record provisional decisions that should be verified, confirmed, or replaced. Move items here instead of overstating them as confirmed scope.\n\n"
        "### Open Questions\n"
        "- OPEN: List unresolved questions in priority order. While scope is unlocked, the next decision frame should be scope-level even if implementation details are drafted below.\n"
    )
    with open(solution_md_path, "w", encoding="utf-8") as f:
        f.write(f"{solution_front_matter(change_data)}\n\n{solution_body}")
        
    print(json.dumps({
        "status": "SUCCESS",
        "change_id": change_id,
        "message": f"Initialized change environment in {folder_path}"
    }))
    append_event(
        change_id,
        "init",
        intent,
        change_data,
        status="SUCCESS",
        result="initialized"
    )

def cmd_question_ask(args):
    intent = require_intent(args, "question-ask")
    data, change_json_path = load_change_data(args.id)
        
    question_idx = len(data["questions"]) + 1
    new_question_node = {
        "question_number": question_idx,
        "question_text": "PENDING_GENERATION",
        "phase": data["phase"],
        "scope_locked": data["scope_locked"],
        "user_response": None,
        "status": "OPEN"
    }
    data["questions"].append(new_question_node)
    save_change_data(change_json_path, data)
    sync_solution_metadata(args.id, data)
        
    prompt = load_prompt_template(
        "question_ask",
        question_idx=question_idx,
        change_id=args.id,
        current_phase=data["phase"],
        scope_locked=str(data["scope_locked"]).lower(),
        phase_context=phase_context(data)
    )
    print(prompt)
    append_event(
        args.id,
        "question-ask",
        intent,
        data,
        question_number=question_idx,
        status="OPEN",
        result="prompt_emitted"
    )

def cmd_scope_lock(args):
    intent = require_intent(args, "scope-lock")
    data, change_json_path = load_change_data(args.id)

    if data.get("scope_locked"):
        if data.get("phase") != SOLUTION_ALIGNMENT_PHASE:
            data["phase"] = SOLUTION_ALIGNMENT_PHASE
            save_change_data(change_json_path, data)
            sync_solution_metadata(args.id, data)
        print(json.dumps({
            "status": "ALREADY_LOCKED",
            "change_id": args.id,
            "phase": data["phase"],
            "scope_locked": data["scope_locked"],
            "scope_locked_at": data["scope_locked_at"],
            "next_required_command": "question-ask",
            "message": "Scope is already locked. Continue discovery in solution_alignment. Do not edit application code."
        }))
        append_event(
            args.id,
            "scope-lock",
            intent,
            data,
            status="ALREADY_LOCKED",
            result="scope_already_locked"
        )
        return

    locked_at = utc_now_iso()
    data["phase"] = SOLUTION_ALIGNMENT_PHASE
    data["scope_locked"] = True
    data["scope_locked_at"] = locked_at
    data["scope_lock_notes"] = args.notes or None
    data.setdefault("scope_events", []).append({
        "event": "scope_locked",
        "at": locked_at,
        "notes": args.notes or None
    })
    save_change_data(change_json_path, data)
    sync_solution_metadata(args.id, data)
    print(json.dumps({
        "status": "SUCCESS",
        "change_id": args.id,
        "phase": data["phase"],
        "scope_locked": data["scope_locked"],
        "scope_locked_at": data["scope_locked_at"],
        "next_required_command": "question-ask",
        "message": "Scope is locked. Continue discovery in solution_alignment. Do not edit application code."
    }))
    append_event(
        args.id,
        "scope-lock",
        intent,
        data,
        status="SUCCESS",
        result="scope_locked"
    )

def cmd_scope_unlock(args):
    intent = require_intent(args, "scope-unlock")
    data, change_json_path = load_change_data(args.id)
    unlocked_at = utc_now_iso()
    data["phase"] = "scope_alignment"
    data["scope_locked"] = False
    data["scope_locked_at"] = None
    data["scope_lock_notes"] = None
    data.setdefault("scope_events", []).append({
        "event": "scope_unlocked",
        "at": unlocked_at,
        "reason": args.reason
    })
    save_change_data(change_json_path, data)
    sync_solution_metadata(args.id, data)
    print(json.dumps({
        "status": "SUCCESS",
        "change_id": args.id,
        "phase": data["phase"],
        "scope_locked": data["scope_locked"],
        "message": "Scope unlocked. Return to scope alignment before continuing solution alignment."
    }))
    append_event(
        args.id,
        "scope-unlock",
        intent,
        data,
        status="SUCCESS",
        result="scope_unlocked"
    )

def cmd_question_answer(args):
    intent = require_intent(args, "question-answer")
    data, change_json_path = load_change_data(args.id)
    if not data["questions"]:
        print(json.dumps({"status": "ERROR", "message": "No active question node found. Run question-ask first."}))
        sys.exit(1)
        
    active_q = data["questions"][-1]
    active_q["question_text"] = args.question
    
    if args.rejected:
        active_q["user_response"] = f"REJECTED: {args.reason}"
        active_q["status"] = "REJECTED"
    else:
        active_q["user_response"] = args.answer
        active_q["status"] = "ANSWERED"
        
    save_change_data(change_json_path, data)
    sync_solution_metadata(args.id, data)
        
    prompt = load_prompt_template(
        "question_answer",
        question_idx=active_q["question_number"],
        change_id=args.id,
        current_phase=data["phase"],
        scope_locked=str(data["scope_locked"]).lower(),
        phase_context=phase_context(data)
    )
    print(prompt)
    append_event(
        args.id,
        "question-answer",
        intent,
        data,
        question_number=active_q["question_number"],
        status=active_q["status"],
        result="answer_recorded"
    )

def cmd_checkpoint(args):
    intent = require_intent(args, "checkpoint")
    data, _change_json_path = load_change_data(args.id)
    sync_solution_metadata(args.id, data)
    append_event(
        args.id,
        "checkpoint",
        intent,
        data,
        status="SUCCESS",
        result="checkpoint_recorded"
    )
    stats = solution_stats(Path(".change-requests") / args.id)
    print(json.dumps({
        "status": "SUCCESS",
        "change_id": args.id,
        "phase": data["phase"],
        "scope_locked": data["scope_locked"],
        **stats
    }))

def main():
    parser = argparse.ArgumentParser(description="Agentic Change Request CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    p_init = subparsers.add_parser("init")
    p_init.add_argument("--name", required=True)
    p_init.add_argument("--intent", default="")
    
    p_ask = subparsers.add_parser("question-ask")
    p_ask.add_argument("--id", required=True)
    p_ask.add_argument("--intent", required=True)

    p_scope_lock = subparsers.add_parser("scope-lock")
    p_scope_lock.add_argument("--id", required=True)
    p_scope_lock.add_argument("--notes", default="")
    p_scope_lock.add_argument("--intent", required=True)

    p_scope_unlock = subparsers.add_parser("scope-unlock")
    p_scope_unlock.add_argument("--id", required=True)
    p_scope_unlock.add_argument("--reason", required=True)
    p_scope_unlock.add_argument("--intent", required=True)
    
    p_ans = subparsers.add_parser("question-answer")
    p_ans.add_argument("--id", required=True)
    p_ans.add_argument("--question", required=True)
    p_ans.add_argument("--answer", default="")
    p_ans.add_argument("--rejected", action="store_true")
    p_ans.add_argument("--reason", default="")
    p_ans.add_argument("--intent", required=True)

    p_checkpoint = subparsers.add_parser("checkpoint")
    p_checkpoint.add_argument("--id", required=True)
    p_checkpoint.add_argument("--intent", required=True)
    
    args = parser.parse_args()
    if args.command == "init":
        cmd_init(args)
    elif args.command == "scope-lock":
        cmd_scope_lock(args)
    elif args.command == "scope-unlock":
        cmd_scope_unlock(args)
    elif args.command == "question-ask":
        cmd_question_ask(args)
    elif args.command == "question-answer":
        cmd_question_answer(args)
    elif args.command == "checkpoint":
        cmd_checkpoint(args)

if __name__ == "__main__":
    main()
