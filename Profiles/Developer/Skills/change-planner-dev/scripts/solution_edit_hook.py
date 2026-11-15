#!/usr/bin/env python3
"""PreToolUse logging hook for change-planner-dev (dual-runtime).

Observes attempts to edit any `.change-requests/<id>/solution.md` and appends a
diagnostic record to that change request's events.jsonl, then allows the edit.
Logging only; it never blocks.

Supports two payload formats:
- Claude Code: stdin has `tool_name` + `tool_input.file_path` (+ `cwd`). Output
  contract: print NOTHING to stdout and exit 0 (any stdout JSON would be parsed
  as a permission decision).
- Antigravity: stdin has `toolCall.name` + `toolCall.args`. Output contract:
  print {"decision": "allow"}.
"""

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_strings(item)


def detect_runtime(payload) -> str:
    if isinstance(payload, dict) and "toolCall" in payload and "tool_input" not in payload:
        return "antigravity"
    return "claude"


def normalize_candidate(raw_path: str, workspace_paths):
    path_text = raw_path.replace("\\", "/")
    is_cr_solution = (
        "/.change-requests/" in path_text or path_text.startswith(".change-requests/")
    ) and path_text.endswith("/solution.md")
    if not is_cr_solution:
        return None
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    for workspace in workspace_paths:
        if not workspace:
            continue
        joined = Path(workspace) / raw_path
        if joined.exists() or ".change-requests" in joined.as_posix():
            return joined
    return candidate


def collect_raw_strings(payload):
    """Pull candidate path strings from either payload format."""
    strings = []
    if isinstance(payload, dict):
        if "tool_input" in payload:  # Claude Code
            strings.extend(iter_strings(payload.get("tool_input") or {}))
        args = ((payload.get("toolCall") or {}).get("args") or {})  # Antigravity
        strings.extend(iter_strings(args))
    return strings


def find_solution_targets(payload):
    workspace_paths = list(payload.get("workspacePaths") or [])
    if payload.get("cwd"):
        workspace_paths.append(payload["cwd"])
    targets, seen = [], set()
    for raw in collect_raw_strings(payload):
        target = normalize_candidate(raw, workspace_paths)
        if target is None:
            continue
        key = str(target.resolve() if target.is_absolute() else target)
        if key not in seen:
            seen.add(key)
            targets.append(target)
    return targets


def change_id_from_solution_path(solution_path: Path):
    parts = list(solution_path.parts)
    for index, part in enumerate(parts):
        if part == ".change-requests" and index + 2 < len(parts):
            if parts[index + 2] == "solution.md":
                return parts[index + 1]
    return None


def solution_stats(solution_path: Path):
    if not solution_path.exists():
        return {"solution_md_sha256": None, "solution_md_bytes": None}
    content = solution_path.read_bytes()
    return {"solution_md_sha256": hashlib.sha256(content).hexdigest(),
            "solution_md_bytes": len(content)}


def tool_name_of(payload):
    return payload.get("tool_name") or (payload.get("toolCall") or {}).get("name")


def append_hook_event(payload, solution_path: Path, runtime: str):
    change_id = change_id_from_solution_path(solution_path)
    if not change_id:
        return
    change_folder = solution_path.parent
    event = {
        "timestamp": utc_now_iso(),
        "command": "pre_tool_use",
        "event": "solution_edit_attempt",
        "runtime": runtime,
        "change_id": change_id,
        "phase": None,
        "intent": "Hook observed an attempted solution.md edit.",
        "hook_event": payload.get("hook_event_name") or "PreToolUse",
        "tool_name": tool_name_of(payload),
        "target_file": str(solution_path),
        "session_id": payload.get("session_id"),
        "stepIdx": payload.get("stepIdx"),
        "conversationId": payload.get("conversationId"),
    }
    event.update(solution_stats(solution_path))
    change_json_path = change_folder / "change.json"
    if change_json_path.exists():
        try:
            change_data = json.loads(change_json_path.read_text(encoding="utf-8"))
            event["phase"] = change_data.get("phase")
            event["locks"] = change_data.get("locks")
        except Exception:
            pass
    try:
        with (change_folder / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        pass


def main():
    runtime = "claude"
    try:
        payload = json.load(sys.stdin)
        runtime = detect_runtime(payload)
        for target in find_solution_targets(payload):
            append_hook_event(payload, target, runtime)
    except Exception as error:
        # Never fail loudly to stdout; that could be parsed as a decision.
        print(f"solution_edit_hook logging failed: {error}", file=sys.stderr)
        runtime = "claude"
    if runtime == "antigravity":
        print(json.dumps({"decision": "allow"}))
    # Claude Code / unknown: print nothing, exit 0 = proceed normally.
    sys.exit(0)


if __name__ == "__main__":
    main()
