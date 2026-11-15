#!/usr/bin/env python3
"""change-planner-dev CLI.

A dependency-graph planning engine driven as a STATE MACHINE. The plan
(solution.md) is a list of items across three phases (scope -> architecture ->
tasks). Each item declares the items it depends_on. The CLI does the bookkeeping
the agent is unreliable at: it parses the graph, validates structure, and tracks
which confirmed items have gone STALE because their content or a dependency
changed. The agent owns content; the CLI owns verdicts.

Trampoline design: there are no bare-verdict outputs. Every command ends by
emitting one full PLANNER PACKET whose last line is exactly one next action,
terminating in another CLI call (or a user question plus the command that
consumes the answer). The model never has to decide when to hydrate; it just
obeys the packet. The loop verb is `sync`:

    edit solution.md  ->  sync (--affirm <ids>)  ->  obey the packet  ->  repeat

`sync` with no --affirm is a pure re-hydrate, which is also how a fresh session
RESUMES. State lives entirely on disk under .change-requests/<id>/ (change.json,
solution.md, events.jsonl).

Core invariant (the spreadsheet model): a confirmed item is CLEAN only while its
own content and each dependency's content match the snapshot taken when it was
last affirmed. Editing an item, or editing anything it depends on, makes it STALE
until the agent re-affirms it. The plan is done only when every item is CLEAN.
"""

import sys
import json
import re
import argparse
import hashlib
import shutil
from string import Template
from datetime import datetime, timezone
from pathlib import Path

PHASES = ["scope", "architecture", "tasks"]
PHASE_ORDER = {name: i for i, name in enumerate(PHASES)}
PREFIX_SECTION = {"S": "scope", "A": "architecture", "T": "tasks"}
STATUSES = {"open", "assumed", "confirmed"}

PERSONA = {
    "scope": "Business Analyst (discovery)",
    "architecture": "Senior Engineer (architecture)",
    "tasks": "Lead Engineer (task planning)",
}

# How the agent invokes this CLI. Shown verbatim in the NEXT line of every packet.
CLI = "python .claude/skills/change-planner-dev/scripts/change_cli.py"

# Fallbacks used only if a templates/phase_<phase>.txt file is missing.
PHASE_BLOCK_FALLBACK = {
    "scope": "Persona: Business Analyst. Establish scope from the user's view. "
             "Reason technically, ask behaviorally. Propose (assumed) items; never "
             "ask the user to do solution design. Challenge your own understanding.",
    "architecture": "Persona: Senior Engineer. Ground in the real codebase, "
                    "generate more than one approach, converge respecting invariants.",
    "tasks": "Persona: Lead Engineer. Enumerate ordered, verifiable tasks bottom-up.",
}


# ----------------------------- io helpers -----------------------------

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def fail(message: str):
    print(json.dumps({"status": "ERROR", "message": message}, ensure_ascii=False))
    sys.exit(1)


def cr_dir() -> Path:
    return Path(".change-requests")


def change_folder(change_id: str) -> Path:
    return cr_dir() / change_id


def templates_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "templates"


def load_template(name: str):
    path = templates_dir() / f"{name}.txt"
    return path.read_text(encoding="utf-8") if path.exists() else None


def render(template_text: str, **kwargs) -> str:
    return Template(template_text).safe_substitute(**kwargs)


def phase_block(phase: str) -> str:
    tpl = load_template(f"phase_{phase}")
    return tpl.strip() if tpl is not None else PHASE_BLOCK_FALLBACK.get(phase, "")


def load_change(change_id: str):
    path = change_folder(change_id) / "change.json"
    if not path.exists():
        fail(f"Change ID {change_id} not found.")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path


def save_change(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def next_change_id() -> str:
    d = cr_dir()
    if not d.exists():
        return "change-001"
    nums = []
    for folder in d.iterdir():
        if folder.is_dir() and folder.name.startswith("change-"):
            try:
                nums.append(int(folder.name.split("-")[1]))
            except (ValueError, IndexError):
                continue
    return f"change-{(max(nums) + 1) if nums else 1:03d}"


def request_path(change_id: str) -> Path:
    return change_folder(change_id) / "request.md"


def read_request(change_id: str):
    p = request_path(change_id)
    if p.exists():
        text = p.read_text(encoding="utf-8").strip()
        return text or None
    return None


def solution_stats(change_id: str):
    p = change_folder(change_id) / "solution.md"
    if not p.exists():
        return {"solution_md_sha256": None, "solution_md_bytes": None}
    content = p.read_bytes()
    return {"solution_md_sha256": hashlib.sha256(content).hexdigest(),
            "solution_md_bytes": len(content)}


def append_event(change_id: str, command: str, intent: str, **fields):
    folder = change_folder(change_id)
    folder.mkdir(parents=True, exist_ok=True)
    event = {"timestamp": utc_now_iso(), "command": command,
             "intent": intent or None}
    event.update(solution_stats(change_id))
    event.update({k: v for k, v in fields.items() if v is not None})
    with open(folder / "events.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# ----------------------------- parsing -----------------------------

ITEM_RE = re.compile(r"^###\s+\[(?P<id>[A-Z]+\d+)\]\s+\((?P<status>open|assumed|confirmed)\)\s*(?P<title>.*)$")
DEPENDS_RE = re.compile(r"^depends_on:\s*(?P<deps>.*)$", re.IGNORECASE)
# grounds_on: the A#/S# items a task REALIZES. A coherence edge like depends_on
# (validated downward-only, must exist, propagates STALE), but it carries NO
# execution ordering: compile-build uses depends_on for the build order and grounds_on
# to bake each task's architecture into its build prompt (the design it implements).
GROUNDS_RE = re.compile(r"^grounds_on:\s*(?P<v>.*)$", re.IGNORECASE)
SECTION_RE = re.compile(r"^#{1,2}\s")          # phase headers / doc title delimit items
COMMENT_RE = re.compile(r"^\s*<!--")           # html comments are never item content
# Structured task fields compile-build reads (parsed like depends_on).
FILES_CREATE_RE = re.compile(r"^files_create:\s*(?P<v>.*)$", re.IGNORECASE)
FILES_EDIT_RE = re.compile(r"^files_edit:\s*(?P<v>.*)$", re.IGNORECASE)
FILES_READ_RE = re.compile(r"^files_read:\s*(?P<v>.*)$", re.IGNORECASE)
VERIFY_RE = re.compile(r"^verify:\s*(?P<v>.*)$", re.IGNORECASE)


def _csv(value: str):
    value = value.strip()
    if not value or value in ("-", "none", "None"):
        return []
    return [x.strip() for x in value.split(",") if x.strip()]


def content_hash(title: str, body: str, depends_on, grounds_on=None,
                 files_create=None, files_edit=None, files_read=None, verify=None) -> str:
    base = (title.strip() + "\n" + body.strip()).strip()
    payload = base + "|deps:" + ",".join(sorted(depends_on))
    # Only append when present, so items without these fields keep their prior hash.
    if grounds_on:
        payload += "|grounds:" + ",".join(sorted(grounds_on))
    if files_create:
        payload += "|create:" + ",".join(sorted(files_create))
    if files_edit:
        payload += "|edit:" + ",".join(sorted(files_edit))
    if files_read:
        payload += "|read:" + ",".join(sorted(files_read))
    if verify:
        payload += "|verify:" + verify.strip()
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def parse_solution(change_id: str):
    """Return (items, parse_errors). items: id -> dict."""
    path = change_folder(change_id) / "solution.md"
    if not path.exists():
        return {}, [f"solution.md not found for {change_id}."]
    lines = path.read_text(encoding="utf-8").splitlines()

    items = {}
    errors = []
    current = None
    body_lines = []

    def flush():
        if current is None:
            return
        title = current["title"]
        body = "\n".join(body_lines).strip()
        current["body"] = body
        current["content_hash"] = content_hash(
            title, body, current["depends_on"], current["grounds_on"],
            current["files_create"], current["files_edit"],
            current["files_read"], current["verify"])
        items[current["id"]] = current

    for raw in lines:
        m = ITEM_RE.match(raw)
        if m:
            flush()
            body_lines = []
            item_id = m.group("id")
            prefix = re.match(r"^[A-Z]+", item_id).group(0)
            section = PREFIX_SECTION.get(prefix)
            if section is None:
                errors.append(f"{item_id}: unknown id prefix '{prefix}' (use S/A/T).")
            if item_id in items:
                errors.append(f"{item_id}: duplicate item id.")
            current = {
                "id": item_id,
                "prefix": prefix,
                "section": section,
                "status": m.group("status"),
                "title": m.group("title").strip(),
                "depends_on": [],
                "grounds_on": [],
                "files_create": [],
                "files_edit": [],
                "files_read": [],
                "verify": None,
            }
            continue
        # A section header (## Phase) or the doc title (# ...) ends the current
        # item and is never part of any item's body. This keeps an item's hash
        # stable when later phases gain items below it.
        if SECTION_RE.match(raw):
            flush()
            current = None
            body_lines = []
            continue
        if current is not None:
            stripped = raw.strip()
            dm = DEPENDS_RE.match(stripped)
            if dm:
                current["depends_on"] = _csv(dm.group("deps"))
                continue
            gm = GROUNDS_RE.match(stripped)
            if gm:
                current["grounds_on"] = _csv(gm.group("v"))
                continue
            fcm = FILES_CREATE_RE.match(stripped)
            if fcm:
                current["files_create"] = _csv(fcm.group("v"))
                continue
            fem = FILES_EDIT_RE.match(stripped)
            if fem:
                current["files_edit"] = _csv(fem.group("v"))
                continue
            frm = FILES_READ_RE.match(stripped)
            if frm:
                current["files_read"] = _csv(frm.group("v"))
                continue
            vm = VERIFY_RE.match(stripped)
            if vm:
                current["verify"] = vm.group("v").strip() or None
                continue
            if COMMENT_RE.match(raw):
                continue
            body_lines.append(raw)
    flush()
    return items, errors


# ----------------------------- validation + state -----------------------------

def all_deps(item):
    """The item's full set of coherence edges: ordering deps + grounding edges.

    Both kinds must point downward, must reference real items, and propagate
    staleness identically, so every coherence computation (validation, cycle
    detection, overconfidence, CLEAN/STALE, dependents) treats them as one set.
    They diverge ONLY at compile time: depends_on drives the build DAG's execution
    order; grounds_on is context-only (the architecture a task realizes), never an
    ordering edge. Order-preserving, de-duplicated.
    """
    merged = []
    for d in list(item.get("depends_on", [])) + list(item.get("grounds_on", [])):
        if d not in merged:
            merged.append(d)
    return merged


def validate_structure(items):
    """Hard structural errors: missing deps, upward deps, cycles."""
    errors = []
    for item in items.values():
        for dep in all_deps(item):
            if dep not in items:
                kind = "depends_on" if dep in item["depends_on"] else "grounds_on"
                errors.append(f"{item['id']}: {kind} missing item {dep}.")
                continue
            if item["section"] and items[dep]["section"]:
                if PHASE_ORDER[items[dep]["section"]] > PHASE_ORDER[item["section"]]:
                    kind = "depends on" if dep in item["depends_on"] else "grounds on"
                    errors.append(
                        f"{item['id']} ({item['section']}) {kind} {dep} "
                        f"({items[dep]['section']}): dependencies must point downward."
                    )
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {i: WHITE for i in items}

    def visit(node, stack):
        color[node] = GRAY
        for dep in all_deps(items[node]):
            if dep not in items:
                continue
            if color[dep] == GRAY:
                errors.append("Dependency cycle: " + " -> ".join(stack + [node, dep]) + ".")
                return
            if color[dep] == WHITE:
                visit(dep, stack + [node])
        color[node] = BLACK

    for node in items:
        if color[node] == WHITE:
            visit(node, [])
    return errors


def compute_states(items, ledger):
    """Per item -> {'state', 'reason'}. states: open, assumed, clean, stale, overconfident."""
    result = {}
    for item_id, item in items.items():
        status = item["status"]
        if status in ("open", "assumed"):
            result[item_id] = {"state": status, "reason": None}
            continue
        deps = all_deps(item)
        not_confirmed = [d for d in deps if d in items and items[d]["status"] != "confirmed"]
        if not_confirmed:
            result[item_id] = {"state": "overconfident",
                               "reason": f"confirmed but depends on non-confirmed: {', '.join(not_confirmed)}"}
            continue
        snap = (ledger.get(item_id) or {}).get("snapshot")
        cur_self = item["content_hash"]
        cur_deps = {d: items[d]["content_hash"] for d in deps if d in items}
        if snap is None:
            result[item_id] = {"state": "stale", "reason": "never affirmed"}
        elif snap.get("self") != cur_self:
            result[item_id] = {"state": "stale", "reason": "content edited since affirmed"}
        elif snap.get("deps", {}) != cur_deps:
            old = snap.get("deps", {})
            changed = [d for d in cur_deps if d in old and old[d] != cur_deps[d]]
            added = [d for d in cur_deps if d not in old]
            dropped = [d for d in old if d not in cur_deps]
            bits = []
            if changed:
                bits.append("changed: " + ", ".join(changed))
            if added:
                bits.append("added: " + ", ".join(added))
            if dropped:
                bits.append("removed: " + ", ".join(dropped))
            result[item_id] = {"state": "stale", "reason": "dependency " + "; ".join(bits)}
        else:
            result[item_id] = {"state": "clean", "reason": None}
    return result


def dependents_of(items):
    rev = {i: [] for i in items}
    for item in items.values():
        for dep in all_deps(item):
            if dep in rev:
                rev[dep].append(item["id"])
    return rev


def health(items, states):
    counts = {"open": 0, "assumed": 0, "clean": 0, "stale": 0, "overconfident": 0}
    for s in states.values():
        counts[s["state"]] = counts.get(s["state"], 0) + 1
    unsettled = [i for i, s in states.items() if s["state"] != "clean"]
    return counts, unsettled


# ----------------------------- situation (the state machine) -----------------------------

TIER = {"overconfident": 0, "stale": 1, "open": 2, "assumed": 3, "clean": 9}


def pick_focus(items, states, candidates):
    rev = dependents_of(items)

    def key(i):
        return (TIER[states[i]["state"]], PHASE_ORDER.get(items[i]["section"], 9),
                -len(rev.get(i, [])), i)
    return sorted(candidates, key=key)[0] if candidates else None


def compute_situation(data, items, states, errors):
    """Decide the single situation the change request is in and the one next action.

    Returns dict: label, headline, focus, next_lines (list of strings; the LAST
    one is the literal command to run, or a user-turn instruction).
    """
    phase = data["phase"]
    cid = data["change_id"]
    locks = data.get("locks", {})

    # 1. ERROR (global) -- blocks everything.
    if errors:
        return {
            "label": "ERROR",
            "headline": f"{len(errors)} structural error(s) in solution.md; nothing else can proceed.",
            "focus": None,
            "next_lines": [
                "Fix the exact structural errors listed above in solution.md (missing/upward deps,",
                "cycles, bad ids). Do not affirm anything until they are gone, then:",
                f'  {CLI} sync --id {cid} --intent "<what you fixed>"',
            ],
        }

    # 2. DRIFT (global) -- a locked earlier phase is no longer clean.
    drift = []
    for locked_phase, is_locked in locks.items():
        if is_locked:
            drift += [i for i in items
                      if items[i]["section"] == locked_phase and states[i]["state"] != "clean"]
    if drift:
        return {
            "label": "DRIFT",
            "headline": f"Locked phase reopened: {', '.join(sorted(drift))} are no longer clean.",
            "focus": pick_focus(items, states, drift),
            "next_lines": [
                f"Downstream work reopened a LOCKED phase ({', '.join(sorted(drift))}). Either reconcile",
                "and re-affirm those items if the change is small, or surface it to the user, who may run:",
                f'  {CLI} unlock --id {cid} --phase <phase> --reason "<why>"',
                "Tell the user plainly that earlier-settled work has reopened. Then:",
                f'  {CLI} sync --id {cid} --affirm <ids you reconciled> --intent "<what changed>"',
            ],
        }

    cur = [i for i in items if items[i]["section"] == phase]
    cur_unsettled = [i for i in cur if states[i]["state"] != "clean"]
    persona = PERSONA.get(phase, phase)

    # 3. EMPTY -- this phase has no items yet.
    if not cur:
        if phase == "scope":
            draft = ("Draft the initial Scope (S#) items as (assumed), derived from the user's intent "
                     "and what you read in the repo. Propose them as concrete assertions to confirm.")
        elif phase == "architecture":
            draft = ("Draft Architecture (A#) items: candidate approach(es) and the invariants tasks "
                     "must respect. Ground them in the real codebase. A# may depend_on S#.")
        if phase == "tasks":
            return {
                "label": "EMPTY",
                "headline": "The tasks phase has no items yet; author them investigate -> draft -> critique.",
                "focus": None,
                "next_lines": [
                    "Author the Tasks list with this exact sequence (plain sub-agents, no workflow tool):",
                    "  1. INVESTIGATE: spawn ONE sub-agent to study the codebase against the LOCKED scope",
                    "     and architecture. It returns a structured report: every file to create/edit, plus",
                    "     any gotchas or contradictions where a scope/architecture item looks wrong.",
                    "  2. DRAFT: YOU (main agent) write the T# items yourself, file-first (the report's files",
                    "     -> per-file pseudocode -> package into tasks LAST), per the PERSONA & METHOD best",
                    "     practices. Set depends_on / grounds_on / files_* / verify. Mark them (assumed).",
                    "  3. CRITIQUE: spawn ONE sub-agent as a critic to find anything missing, broken, or",
                    "     against best practices (including architectural mistakes). Fix what it surfaces.",
                    "If the investigator finds a scope/architecture contradiction, surface it to the user: a",
                    "LOCKED phase needs the user to unlock before you change it. Then:",
                    f'  {CLI} sync --id {cid} --intent "<tasks drafted>"',
                ],
            }
        return {
            "label": "EMPTY",
            "headline": f"The {phase} phase has no items yet.",
            "focus": None,
            "next_lines": [
                draft,
                "Mark repo/user facts (confirmed) and your inferences (assumed). Then:",
                f'  {CLI} sync --id {cid} --affirm <confirmed ids you stand behind> --intent "<what you drafted>"',
            ],
        }

    # 4/5/6. Unsettled items in the current phase -> dominant sub-state.
    if cur_unsettled:
        present = {states[i]["state"] for i in cur_unsettled}
        focus = pick_focus(items, states, cur_unsettled)
        if "overconfident" in present:
            bad = [i for i in cur_unsettled if states[i]["state"] == "overconfident"]
            return {
                "label": "OVERCONFIDENT",
                "headline": f"{', '.join(sorted(bad))} are (confirmed) but depend on non-confirmed items.",
                "focus": focus,
                "next_lines": [
                    "A confirmed item cannot rest on an unconfirmed one. For each, either downgrade it to",
                    "(assumed)/(open), or confirm the dependency it rests on. Reconcile in this pass, then:",
                    f'  {CLI} sync --id {cid} --affirm <ids you re-examined> --intent "<what changed>"',
                ],
            }
        if "stale" in present:
            bad = [i for i in cur_unsettled if states[i]["state"] == "stale"]
            return {
                "label": "STALE",
                "headline": f"{len(bad)} confirmed item(s) need re-examination: {', '.join(sorted(bad))}.",
                "focus": focus,
                "next_lines": [
                    "These were affirmed before, but their own content or a dependency changed. Re-read each",
                    "against its CURRENT dependencies, edit if needed, and re-affirm only what still holds:",
                    f'  {CLI} sync --id {cid} --affirm <ids you re-examined> --intent "<what changed>"',
                ],
            }
        # open / assumed remain
        f_item = items[focus]
        f_state = states[focus]["state"]
        ask = ("If resolving it depends on the user's intent/preference/risk/business meaning, ask ONE "
               "concrete behavioral question; if the repo can answer it, go read the code instead.")
        return {
            "label": "UNSETTLED",
            "headline": f"{len(cur_unsettled)} item(s) still need work; focus: {focus} ({f_state}).",
            "focus": focus,
            "next_lines": [
                f"Work {focus}: \"{f_item['title']}\". {ask}",
                "Capture user answers and propagate every implication across the document in this pass.",
                "When you record a user answer, log it:",
                f'  {CLI} answer --id {cid} --question "<q>" --answer "<a>" --intent "<why>"',
                "After editing, affirm what you now stand behind:",
                f'  {CLI} sync --id {cid} --affirm <ids> --intent "<what changed>"',
            ],
        }

    # 7. Current phase is fully clean. Collaboration gate first: a phase the agent
    # drove with zero recorded user input cannot be declared ready; it must be
    # surfaced for review and the user's direction recorded via `answer`.
    touchpoints = sum(1 for q in data.get("questions", [])
                      if q.get("phase") == phase and q.get("status") == "ANSWERED")
    if touchpoints == 0:
        return {
            "label": "REVIEW",
            "headline": f"The {phase} phase is structurally clean but has NO recorded user input this phase.",
            "focus": None,
            "next_lines": [
                f"You have driven the entire {phase} phase with zero recorded user input. This skill is",
                "collaborative: do NOT finalize a phase you decided alone. Surface your key decisions in plain",
                "language, ESPECIALLY anything user-facing (behavior, UX, visual style, keymaps, copy), and ask",
                "the user for direction or sign-off. Record their response so it is on the record:",
                f'  {CLI} answer --id {cid} --question "<what you asked>" --answer "<their reply>" --intent "<why>"',
                "Then sync again. Once real user input is recorded for this phase, it can be marked ready.",
            ],
        }

    global_unsettled = [i for i in items if states[i]["state"] != "clean"]
    if phase == "tasks" and not global_unsettled:
        if locks.get("tasks"):
            return {
                "label": "COMPLETE",
                "headline": "Tasks locked and every item is CLEAN; materialize the build folder.",
                "focus": None,
                "next_lines": [
                    "The plan is locked and complete. Materialize the build folder now: one prompt file per",
                    "task plus a README entry point that any agent or model can follow to build the change.",
                    f"  {CLI} compile-build --id {cid}",
                    "Then hand the user the build folder (README.md is the entry-point prompt they give to",
                    "their build model). This skill does NOT build; the user runs the build themselves.",
                ],
            }
        return {
            "label": "COMPLETE",
            "headline": "Every item across all phases is CLEAN and the structure is valid.",
            "focus": None,
            "next_lines": [
                "Planning is complete. This is a planning milestone, NOT permission to build.",
                "Tell the user the plan is ready and that locking the tasks phase is their call. Locking",
                "is what triggers materializing the build folder. To lock:",
                f'  {CLI} lock --id {cid} --intent "<why>"',
            ],
        }

    # READY: this phase is clean; the user owns the lock decision.
    return {
        "label": "READY",
        "headline": f"Every {phase} item is CLEAN and valid.",
        "focus": None,
        "next_lines": [
            f"The {phase} phase is structurally clean. Before you tell the user it is ready, verify EVERY",
            "item in this phase's EXIT CHECKLIST (in the PERSONA & METHOD block above) is fully satisfied;",
            "if any is not, do that work and sync again. Then challenge it once more (edge cases, omissions,",
            "alternative readings); turn anything real into items and sync again. If nothing new survives,",
            "TELL THE USER the phase is ready and that locking is their call. Do not lock it yourself. Then:",
            f'  {CLI} lock --id {cid} --intent "<why>"',
        ],
    }


# ----------------------------- packet rendering -----------------------------

def render_item(item, states, rev):
    s = states[item["id"]]
    deps = ", ".join(item["depends_on"]) or "-"
    dependents = ", ".join(rev.get(item["id"], [])) or "-"
    reason = f"  [{s['state'].upper()}: {s['reason']}]" if s["reason"] else f"  [{s['state'].upper()}]"
    lines = [f"  [{item['id']}] ({item['status']}) {item['title']}{reason}",
             f"      depends_on: {deps} | depended_on_by: {dependents}"]
    grounds = ", ".join(item.get("grounds_on", []))
    if grounds:
        lines.append(f"      grounds_on: {grounds}")
    return "\n".join(lines)


def build_header(data) -> str:
    phase = data["phase"]
    locks = data.get("locks", {})
    bits = [phase.upper()]
    bits.append("SCOPE: LOCKED" if locks.get("scope") else "SCOPE: UNLOCKED")
    if locks.get("architecture"):
        bits.append("ARCH: LOCKED")
    return "[" + " | ".join(bits) + "]"


def render_packet(change_id: str, verdict_line: str = ""):
    """Emit the single PLANNER PACKET. This is the only thing the model reads."""
    data, _ = load_change(change_id)
    phase = data["phase"]
    items, parse_errors = parse_solution(change_id)
    struct_errors = validate_structure(items)
    errors = parse_errors + struct_errors
    ledger = data.get("ledger", {})
    states = compute_states(items, ledger)
    counts, _ = health(items, states)
    rev = dependents_of(items)

    sit = compute_situation(data, items, states, errors)
    header = build_header(data)

    # work block: errors first, then the graph of unsettled items.
    wb = []
    if errors:
        wb.append("STRUCTURAL ERRORS (fix these in solution.md first):")
        wb += [f"  - {e}" for e in errors]
        wb.append("")
    if not items:
        wb.append("The plan is empty.")
    else:
        unsettled = [i for i in items if states[i]["state"] != "clean"]
        if unsettled:
            wb.append("UNSETTLED ITEMS (overconfident/stale first; current phase matters most):")
            order = sorted(unsettled, key=lambda i: (TIER[states[i]["state"]],
                                                     PHASE_ORDER.get(items[i]["section"], 9), i))
            wb += [render_item(items[i], states, rev) for i in order]
        else:
            wb.append("All items are CLEAN.")
    # Tasks-phase build-readiness: every T# needs a write-set and a verify so its build
    # prompt file is executable, and grounds_on so the prompt carries its architecture.
    # Advisory, not a structural error.
    if phase == "tasks":
        def tnum(i):
            digits = "".join(ch for ch in i if ch.isdigit())
            return (int(digits) if digits else 0, i)
        not_ready, thin = [], []
        for i, it in items.items():
            if it.get("section") != "tasks":
                continue
            missing = []
            if not (it.get("files_create") or it.get("files_edit")):
                missing.append("files_create/files_edit")
            if not it.get("verify"):
                missing.append("verify")
            if missing:
                not_ready.append((i, missing))
            # grounds_on becomes the architecture baked into the task's build prompt;
            # a task with none ships a prompt blind to the design it realizes.
            if not it.get("grounds_on"):
                thin.append(i)
        if not_ready:
            wb.append("")
            wb.append("NOT BUILD-READY (each task needs a write-set and a verify for its build prompt file):")
            wb += [f"  {i}: missing {', '.join(m)}"
                   for i, m in sorted(not_ready, key=lambda p: tnum(p[0]))]
        if thin:
            wb.append("")
            wb.append("THIN CONTEXT (add grounds_on: the A#/S# items each task REALIZES, so its build prompt")
            wb.append("carries that architecture; depends_on is execution order, grounds_on is context):")
            wb.append("  " + ", ".join(sorted(thin, key=tnum)))
    work_block = "\n".join(wb)

    situation_line = f"SITUATION: {sit['label']} -- {sit['headline']}"
    focus_line = f"FOCUS: {sit['focus']}" if sit.get("focus") else "FOCUS: -"
    verdict = verdict_line.strip() or "(re-hydrate; no change applied this call)"
    next_block = ">>> NEXT (do exactly this):\n" + "\n".join("  " + ln for ln in sit["next_lines"])
    request_block = read_request(change_id) or (
        "(no original request captured; ask the user to restate the goal and record it in "
        f".change-requests/{change_id}/request.md)")

    subs = dict(
        header=header, change_id=change_id, name=data.get("name", ""),
        phase=phase, persona=PERSONA.get(phase, phase),
        situation_line=situation_line, focus_line=focus_line,
        verdict_line=f"VERDICT: {verdict}", request_block=request_block,
        health=json.dumps(counts), phase_block=phase_block(phase),
        work_block=work_block, next_block=next_block,
    )
    tpl = load_template("packet")
    if tpl is not None:
        print(render(tpl, **subs))
    else:
        print(f"[PLANNER PACKET]\n{header}\n\n--- ORIGINAL REQUEST ---\n{request_block}\n\n"
              f"{situation_line}\n{subs['verdict_line']}\n"
              f"Phase: {phase}  Persona: {PERSONA.get(phase, phase)}  Health: {json.dumps(counts)}\n"
              f"{focus_line}\n\n{phase_block(phase)}\n\n{work_block}\n\n{next_block}")
    return sit, counts


# ----------------------------- commands -----------------------------

INITIAL_SOLUTION = """# Solution: {name}

> Living plan. Items only. Each item: ### [ID] (status) one-line title, then an
> optional body, then `depends_on:` (comma list or `-`). IDs: S# scope, A#
> architecture, T# tasks. Dependencies point downward only (T->A->S). Status is
> open / assumed / confirmed. The CLI tracks CLEAN/STALE; you affirm via `sync`.
>
> A scope item is a DELIVERABLE; its acceptance criteria and notes live in the item
> body, and exclusions are consolidated into one Boundaries item. Body format: no
> `#`/`##` headings inside a body (they end the item), and no body line starting with
> `depends_on:`/`grounds_on:`/`files_*:`/`verify:` unless it is the real field.

## Scope (Deliverables + acceptance criteria + notes; what is in and out)
### [S1] (open) State the user-visible outcome this change should create.
depends_on: -

## Architecture (Approach + invariants; depends on Scope)
<!-- add A# items as the approach takes shape -->

## Tasks (Concrete actions; depends on Architecture)
<!-- add T# items once the approach is settled -->
"""


def cmd_init(args):
    cr_dir().mkdir(exist_ok=True)
    change_id = next_change_id()
    folder = change_folder(change_id)
    folder.mkdir(parents=True, exist_ok=True)
    data = {
        "change_id": change_id,
        "name": args.name,
        "phase": "scope",
        "locks": {"scope": False, "architecture": False},
        "phase_events": [],
        "questions": [],
        "ledger": {},
        "seen_items": [],
    }
    save_change(folder / "change.json", data)
    (folder / "solution.md").write_text(INITIAL_SOLUTION.format(name=args.name), encoding="utf-8")
    request_text = (getattr(args, "request", "") or "").strip()
    request_path(change_id).write_text(
        (request_text or "(no original request captured at init; restate the goal and record it here)") + "\n",
        encoding="utf-8",
    )
    append_event(change_id, "init", args.intent or args.name, phase="scope",
                 result="initialized", request_captured=bool(request_text))
    sit, counts = render_packet(change_id, verdict_line=f"initialized {change_id}")
    append_event(change_id, "render", "post-init packet", phase="scope",
                 situation=sit["label"], counts=counts)


def cmd_sync(args):
    """The loop verb: validate, affirm what was re-examined, then emit the packet."""
    data, path = load_change(args.id)
    items, parse_errors = parse_solution(args.id)
    struct_errors = validate_structure(items)
    errors = parse_errors + struct_errors

    affirm_ids = [a.strip() for a in (args.affirm or "").split(",") if a.strip()]
    ledger = data.setdefault("ledger", {})
    affirmed, refused = [], []

    # Collaboration gate (no create-and-confirm in one sync): an item first seen this
    # sync cannot be affirmed yet; it must be proposed, then affirmed on a later sync.
    # Legacy change requests (no seen_items field) grandfather their existing items so
    # they are not falsely refused.
    seen = data.get("seen_items")
    if seen is None:
        seen = list(items.keys())
    new_this_sync = {i for i in items if i not in seen}

    if affirm_ids and errors:
        refused = [{"id": a, "why": "structural errors must be fixed before affirming"} for a in affirm_ids]
    elif affirm_ids:
        for aid in affirm_ids:
            if aid not in items:
                refused.append({"id": aid, "why": "no such item"})
                continue
            if aid in new_this_sync:
                refused.append({"id": aid, "why": "created this sync; propose it and sync once before you affirm it (no create-and-confirm in one step)"})
                continue
            item = items[aid]
            if item["status"] != "confirmed":
                refused.append({"id": aid, "why": f"status is ({item['status']}), must be (confirmed)"})
                continue
            deps = all_deps(item)
            not_conf = [d for d in deps if d in items and items[d]["status"] != "confirmed"]
            if not_conf:
                refused.append({"id": aid, "why": f"rests on non-confirmed: {', '.join(not_conf)}"})
                continue
            ledger[aid] = {"snapshot": {
                "self": item["content_hash"],
                "deps": {d: items[d]["content_hash"] for d in deps if d in items},
            }, "affirmed_at": utc_now_iso()}
            affirmed.append(aid)

    # prune ledger entries for deleted items
    for gone in [k for k in ledger if k not in items]:
        del ledger[gone]
    # record every item now present as "seen" so it is affirmable on the NEXT sync
    data["seen_items"] = sorted(set(seen) | set(items.keys()))
    save_change(path, data)

    bits = []
    if affirmed:
        bits.append("affirmed " + ", ".join(affirmed))
    if refused:
        bits.append("REFUSED " + "; ".join(f"{r['id']} ({r['why']})" for r in refused))
    if errors:
        bits.append(f"{len(errors)} structural error(s)")
    if not bits:
        bits.append("no items affirmed (re-hydrate)")
    verdict_line = "; ".join(bits)

    append_event(args.id, "sync", args.intent, phase=data["phase"],
                 affirmed=affirmed or None, refused=len(refused) or None,
                 errors=len(errors) or None)
    sit, counts = render_packet(args.id, verdict_line=verdict_line)
    append_event(args.id, "render", "post-sync packet", phase=data["phase"],
                 situation=sit["label"], counts=counts)


def cmd_answer(args):
    data, path = load_change(args.id)
    data.setdefault("questions", []).append({
        "n": len(data.get("questions", [])) + 1,
        "phase": data["phase"],
        "question": args.question,
        "answer": (f"REJECTED: {args.reason}" if args.rejected else args.answer),
        "status": "REJECTED" if args.rejected else "ANSWERED",
        "at": utc_now_iso(),
    })
    save_change(path, data)
    append_event(args.id, "answer", args.intent, phase=data["phase"],
                 status=("REJECTED" if args.rejected else "ANSWERED"))
    verdict = f"logged answer #{len(data['questions'])} ({'REJECTED' if args.rejected else 'ANSWERED'})"
    render_packet(args.id, verdict_line=verdict)


def cmd_lock(args):
    data, path = load_change(args.id)
    phase = data["phase"]
    items, parse_errors = parse_solution(args.id)
    errors = parse_errors + validate_structure(items)
    if errors:
        fail("Cannot lock: structural errors present. Run sync and fix them first.")
    states = compute_states(items, ledger=data.get("ledger", {}))
    section_items = [i for i in items if items[i]["section"] == phase]
    not_clean = [i for i in section_items if states[i]["state"] != "clean"]
    if not section_items:
        fail(f"Cannot lock '{phase}': no items in this phase yet.")
    if not_clean:
        fail(f"Cannot lock '{phase}': these items are not CLEAN confirmed: {', '.join(not_clean)}.")

    data.setdefault("locks", {})[phase] = True
    data.setdefault("phase_events", []).append(
        {"event": f"{phase}_locked", "at": utc_now_iso(), "notes": args.notes or None})
    idx = PHASE_ORDER[phase]
    if idx + 1 < len(PHASES):
        data["phase"] = PHASES[idx + 1]
    save_change(path, data)
    append_event(args.id, "lock", args.intent, locked_phase=phase,
                 phase=data["phase"], status="SUCCESS")
    render_packet(args.id, verdict_line=f"locked {phase}; now in {data['phase']}")


def cmd_unlock(args):
    data, path = load_change(args.id)
    phase = args.phase
    if phase not in PHASES:
        fail(f"Unknown phase '{phase}'. Use one of {PHASES}.")
    data.setdefault("locks", {})[phase] = False
    data["phase"] = phase
    data.setdefault("phase_events", []).append(
        {"event": f"{phase}_unlocked", "at": utc_now_iso(), "reason": args.reason})
    save_change(path, data)
    append_event(args.id, "unlock", args.intent, unlocked_phase=phase,
                 phase=phase, status="SUCCESS")
    render_packet(args.id, verdict_line=f"unlocked {phase}; returned to {phase}")


# ----------------------------- build-folder compiler -----------------------------
#
# compile-build turns the locked task graph into a portable build/ FOLDER: one
# markdown prompt file per task (YAML front matter with its edges + write-set +
# verify, then a fully compiled, self-contained build prompt) plus a README.md
# entry point that doubles as the table of contents AND the instruction prompt for
# a build agent (any model: Claude, Gemini, Codex). No workflow, no orchestration,
# no agents spawned here: this is deterministic codegen that writes files. The user
# drives the build by handing README.md to the model of their choice. It reads two
# edge types per task: depends_on (execution ORDER, sets the sequence) and grounds_on
# (the architecture the task REALIZES, baked into the prompt as its context).


def item_num(i: str) -> int:
    digits = "".join(ch for ch in i if ch.isdigit())
    return int(digits) if digits else 0


def task_order(items):
    """Topo-sort task items by T->T depends_on edges (cross-phase deps ignored for
    ordering). Tie-break by task number for deterministic output. None on cycle."""
    tasks = {i: it for i, it in items.items() if it["section"] == "tasks"}
    indeg = {i: 0 for i in tasks}
    succ = {i: [] for i in tasks}
    for i, it in tasks.items():
        for d in it["depends_on"]:
            if d in tasks:
                indeg[i] += 1
                succ[d].append(i)
    ready = sorted([i for i in tasks if indeg[i] == 0], key=item_num)
    order = []
    while ready:
        n = ready.pop(0)
        order.append(n)
        for s in succ[n]:
            indeg[s] -= 1
            if indeg[s] == 0:
                ready.append(s)
        ready.sort(key=item_num)
    return order if len(order) == len(tasks) else None


def context_closure(task_id, items):
    """Ordered S#/A# item ids reachable from a task via ALL coherence edges
    (depends_on + grounds_on, transitively). Other tasks (T#) are excluded: they are
    dependencies, not injectable context. Scope first, then architecture, by number."""
    seen, out, stack = set(), [], list(all_deps(items[task_id]))
    while stack:
        cur = stack.pop(0)
        if cur in seen or cur not in items:
            continue
        seen.add(cur)
        if items[cur]["section"] in ("scope", "architecture"):
            out.append(cur)
        stack.extend(all_deps(items[cur]))
    out.sort(key=lambda i: (PHASE_ORDER[items[i]["section"]], item_num(i)))
    return out


def _ctx_block(ids, items):
    L = []
    for c in ids:
        L.append(f"  [{c}] {items[c]['title']}")
        for ln in (items[c]["body"] or "").splitlines():
            L.append(f"    {ln}")
    return L


def assemble_builder_prompt(task_id, items, change_id, name):
    it = items[task_id]
    closure = context_closure(task_id, items)
    scope_ctx = [c for c in closure if items[c]["section"] == "scope"]
    arch_ctx = [c for c in closure if items[c]["section"] == "architecture"]
    L = [
        "You are a senior implementation engineer building ONE task of a larger,",
        "already-planned change. The plan was made deliberately. Do NOT redesign it:",
        "build exactly this task, verify it, and report what you did.",
        "",
        f"CHANGE: {change_id} -- {name}",
        "You are on the SHARED branch. Do NOT create branches, commit, or push. Leave",
        "your edits in the working tree.",
        "",
    ]
    if scope_ctx:
        L.append("WHY THIS EXISTS (scope this task rests on):")
        L += _ctx_block(scope_ctx, items)
        L.append("")
    if arch_ctx:
        L.append("ARCHITECTURE TO IMPLEMENT AND HONOR (INVARIANT: items are non-negotiable):")
        L += _ctx_block(arch_ctx, items)
        L.append("")
    L.append(f"YOUR TASK -- [{task_id}] {it['title']}")
    if it["body"]:
        L.append(it["body"])
    L += [
        "",
        "FILES (your lane):",
        f"  create: {', '.join(it['files_create']) or '-'}",
        f"  edit:   {', '.join(it['files_edit']) or '-'}",
        f"  read:   {', '.join(it['files_read']) or '-'}  (context only; do not modify)",
        "",
        "LANE DISCIPLINE: modify ONLY the files under create/edit. If you discover you",
        "must change a file not listed, STOP and report which file and why before",
        "continuing. An inaccurate write-set is a planning bug to surface, not patch around.",
        "",
    ]
    if "A18" in arch_ctx:
        L += [
            "SVELTE: this task touches src/web. Follow the Svelte MCP workflow: list-sections",
            "+ get-documentation before writing any runes/SvelteKit code, then svelte-autofixer",
            "in a loop on every .svelte file you touch until it reports no issues.",
            "",
        ]
    verify = it["verify"] or "(no verify command specified -- flag this before continuing)"
    L += [
        "VERIFY: run exactly this and make it pass before this task is done:",
        f"  {verify}",
        "Iterate until it passes. If it cannot pass, STOP and report rather than building",
        "further on a broken task. When it passes, move on to the next task file.",
    ]
    return "\n".join(L)


def _yaml_front_matter(it, order_index):
    fm = {
        "task": it["id"],
        "title": it["title"],
        "order": order_index,
        "depends_on": it["depends_on"],
        "grounds_on": it["grounds_on"],
        "files_create": it["files_create"],
        "files_edit": it["files_edit"],
        "files_read": it["files_read"],
        "verify": it["verify"] or "",
    }
    # JSON is valid YAML, so json.dumps each value keeps it safe and parseable.
    lines = ["---"] + [f"{k}: {json.dumps(v)}" for k, v in fm.items()] + ["---"]
    return "\n".join(lines)


def emit_entry_point(change_id, items, order, name, request):
    L = [
        f"# Build plan: {change_id} -- {name}",
        "",
        "This folder is a build plan: one prompt file per task, in dependency order. Each",
        "task file has YAML front matter (its dependencies, the architecture it realizes, its",
        "file write-set, and its verify command) followed by a complete, self-contained build",
        "prompt. THIS file is both the table of contents and the instruction prompt: hand it",
        "to a build agent (any model) to drive the whole build.",
        "",
    ]
    if request.strip():
        L.append("## What you are building")
        L += ["> " + ln for ln in request.strip().splitlines()]
        L.append("")
    L += [
        "## How to build it",
        "You are implementing this change on the shared git branch. Work through the tasks in",
        "the ORDER below, one at a time, top to bottom. For each task:",
        "  1. Open its file (e.g. build/T1.md) and read it in full.",
        "  2. Implement exactly what it specifies. Edit ONLY the files it declares under",
        "     files_create / files_edit. If you must change a file it does not list, STOP and",
        "     report it rather than guessing; the plan may be wrong.",
        "  3. Run its verify command and make it pass before moving on.",
        "  4. If a task's verify cannot pass, STOP and report which task and why. Do not build",
        "     further on top of a broken task.",
        "Do not create branches, commit, or push unless explicitly asked. After the final task,",
        "run the whole-project gates and make them pass:",
        "  npm run typecheck && npm run lint && npm test",
        "",
        "## Task order",
    ]
    for n, tid in enumerate(order, 1):
        it = items[tid]
        deps = ", ".join(it["depends_on"]) or "-"
        L.append(f"{n}. [{tid}] {it['title']}")
        L.append(f"   file: {tid}.md  |  depends_on: {deps}")
    L.append("")
    return "\n".join(L)


def cmd_compile_build(args):
    data, _ = load_change(args.id)
    items, parse_errors = parse_solution(args.id)
    errors = parse_errors + validate_structure(items)
    if errors:
        fail("Cannot compile: structural errors present. Run sync and fix them first:\n  - "
             + "\n  - ".join(errors))
    if not [i for i in items if items[i]["section"] == "tasks"]:
        fail("Cannot compile: no task (T#) items exist yet.")
    order = task_order(items)
    if order is None:
        fail("Cannot compile: a cycle exists among task depends_on edges.")

    name = data.get("name", args.id)
    request = read_request(args.id) or ""
    build_dir = Path(args.out) if args.out else (change_folder(args.id) / "build")
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True)

    (build_dir / "README.md").write_text(
        emit_entry_point(args.id, items, order, name, request), encoding="utf-8")
    for n, tid in enumerate(order, 1):
        fm = _yaml_front_matter(items[tid], n)
        body = assemble_builder_prompt(tid, items, args.id, name)
        (build_dir / f"{tid}.md").write_text(fm + "\n\n" + body + "\n", encoding="utf-8")

    append_event(args.id, "compile-build", args.intent, phase=data["phase"],
                 tasks=len(order), out=str(build_dir))

    states = compute_states(items, data.get("ledger", {}))
    not_clean = [i for i in order if states[i]["state"] != "clean"]
    no_writeset = [i for i in order if not (items[i]["files_create"] or items[i]["files_edit"])]
    thin = [i for i in order if not items[i]["grounds_on"]]

    print(f"[BUILD FOLDER] {build_dir}")
    print(f"  {len(order)} task prompt file(s) + README.md entry point")
    print(f"  order: {' -> '.join(order)}")
    print("  Hand README.md to your build agent (Gemini or any model); it walks the tasks in order.")
    if not_clean or no_writeset or thin:
        print("")
        print("HEADS UP (soft gaps; fix in solution.md + recompile if they matter):")
        if not_clean:
            print(f"  ! not CLEAN (plan still settling): {', '.join(not_clean)}")
        if no_writeset:
            print(f"  ! no write-set (lane discipline is a no-op for these): {', '.join(no_writeset)}")
        if thin:
            print(f"  ! thin context (no grounds_on; little architecture in the prompt): {', '.join(thin)}")


# ----------------------------- arg parsing -----------------------------

def main():
    p = argparse.ArgumentParser(description="change-planner-dev CLI")
    sub = p.add_subparsers(dest="command", required=True)

    pi = sub.add_parser("init", help="Create a change request and emit the first packet")
    pi.add_argument("--name", required=True)
    pi.add_argument("--request", default="",
                    help="The user's original feature request, captured verbatim, stored on disk")
    pi.add_argument("--intent", default="")

    ps = sub.add_parser("sync", help="Loop verb: validate, affirm --affirm <ids>, emit the packet")
    ps.add_argument("--id", required=True)
    ps.add_argument("--affirm", default="")
    ps.add_argument("--intent", default="")

    pa = sub.add_parser("answer", help="Log a user answer to the audit trail, then re-emit the packet")
    pa.add_argument("--id", required=True)
    pa.add_argument("--question", required=True)
    pa.add_argument("--answer", default="")
    pa.add_argument("--rejected", action="store_true")
    pa.add_argument("--reason", default="")
    pa.add_argument("--intent", default="")

    pl = sub.add_parser("lock", help="USER-owned: lock the current phase and advance")
    pl.add_argument("--id", required=True)
    pl.add_argument("--notes", default="")
    pl.add_argument("--intent", default="")

    pu = sub.add_parser("unlock", help="USER-owned: unlock a phase and return to it")
    pu.add_argument("--id", required=True)
    pu.add_argument("--phase", required=True)
    pu.add_argument("--reason", required=True)
    pu.add_argument("--intent", default="")

    pc = sub.add_parser("compile-build",
                        help="Materialize a build/ folder: one prompt file per task + a README entry point")
    pc.add_argument("--id", required=True)
    pc.add_argument("--out", default="", help="output dir (default: <change>/build)")
    pc.add_argument("--intent", default="")

    args = p.parse_args()
    {
        "init": cmd_init, "sync": cmd_sync, "answer": cmd_answer,
        "lock": cmd_lock, "unlock": cmd_unlock,
        "compile-build": cmd_compile_build,
    }[args.command](args)


if __name__ == "__main__":
    main()
