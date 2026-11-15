from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _is_repo_root(path: Path) -> bool:
    return (path / "memory" / "engine" / "cli.py").exists() and (path / "skills" / "skills.json").exists()


def _find_repo_root() -> Path:
    current = Path(__file__).resolve()

    candidates: list[Path] = []
    for path in [current.parent] + list(current.parents):
        candidates.append(path)
        candidates.append(path / "central-agent-system")
        if path.parent:
            candidates.append(path.parent / "central-agent-system")

    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        if _is_repo_root(candidate):
            return candidate

    raise RuntimeError("Cannot locate central-agent-system repo root for skill-design memory retrieval.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Retrieve skill-design memories")
    parser.add_argument("--query-text", required=True)
    parser.add_argument("--workspace-id", default="central-agent-system")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = _find_repo_root()
    sys.path.insert(0, str(repo_root))
    from memory.engine.cli import main as engine_main

    return engine_main(
        [
            "retrieve",
            "--skill-id",
            "skill-design",
            "--workspace-id",
            args.workspace_id,
            "--query-text",
            args.query_text,
        ]
    )


if __name__ == "__main__":
    raise SystemExit(main())
