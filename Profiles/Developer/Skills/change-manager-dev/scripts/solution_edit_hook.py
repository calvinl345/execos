#!/usr/bin/env python3
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def allow():
    print(json.dumps({"decision": "allow"}))


def iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_strings(item)


def normalize_candidate(raw_path: str, workspace_paths):
    path_text = raw_path.replace("\\", "/")
    is_change_request_solution = (
        "/.change-requests/" in path_text or path_text.startswith(".change-requests/")
    ) and path_text.endswith("/solution.md")
    if not is_change_request_solution:
        return None

    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate

    for workspace in workspace_paths:
        joined = Path(workspace) / raw_path
        if joined.exists() or ".change-requests" in joined.as_posix():
            return joined
    return candidate


def find_solution_targets(payload):
    workspace_paths = payload.get("workspacePaths") or []
    targets = []
    seen = set()
    args = ((payload.get("toolCall") or {}).get("args") or {})
    for raw in iter_strings(args):
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
        return {
            "solution_md_sha256": None,
            "solution_md_bytes": None,
        }
    content = solution_path.read_bytes()
    return {
        "solution_md_sha256": hashlib.sha256(content).hexdigest(),
        "solution_md_bytes": len(content),
    }


def append_hook_event(payload, solution_path: Path):
    change_id = change_id_from_solution_path(solution_path)
    if not change_id:
        return

    change_folder = solution_path.parent
    event = {
        "timestamp": utc_now_iso(),
        "command": "antigravity_pre_tool_use",
        "event": "solution_edit_attempt",
        "change_id": change_id,
        "phase": None,
        "scope_locked": None,
        "intent": "Antigravity hook observed an attempted solution.md edit.",
        "hook_event": "PreToolUse",
        "tool_name": (payload.get("toolCall") or {}).get("name"),
        "target_file": str(solution_path),
        "stepIdx": payload.get("stepIdx"),
        "conversationId": payload.get("conversationId"),
    }
    event.update(solution_stats(solution_path))

    change_json_path = change_folder / "change.json"
    if change_json_path.exists():
        try:
            change_data = json.loads(change_json_path.read_text(encoding="utf-8"))
            event["phase"] = change_data.get("phase")
            event["scope_locked"] = change_data.get("scope_locked")
        except Exception:
            pass

    events_path = change_folder / "events.jsonl"
    with events_path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False) + "\n")


def main():
    try:
        payload = json.load(sys.stdin)
        for target in find_solution_targets(payload):
            append_hook_event(payload, target)
    except Exception as error:
        print(f"solution_edit_hook logging failed: {error}", file=sys.stderr)
    allow()


if __name__ == "__main__":
    main()
