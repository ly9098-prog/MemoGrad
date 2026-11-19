"""Exercise the Alembic migration history at CI checkpoints.

The caller provides checkpoints collected from the current migration graph.
Each checkpoint is upgraded, downgraded by one revision, and upgraded again.
This avoids crossing intentionally irreversible historical migrations while
still checking representative upgrade/downgrade paths throughout the graph.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]


def _run_alembic(*arguments: str) -> None:
    command = [sys.executable, "-m", "alembic", *arguments]
    result = subprocess.run(
        command,
        cwd=BACKEND,
        env=os.environ.copy(),
        check=False,
    )
    if result.returncode:
        raise RuntimeError(
            f"Alembic command failed ({result.returncode}): {' '.join(command)}"
        )


def _load_checkpoints(path: Path) -> list[str]:
    checkpoints = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(checkpoints, list) or not checkpoints:
        raise ValueError("migration checkpoints must be a non-empty JSON array")
    if any(
        not isinstance(checkpoint, str) or not checkpoint for checkpoint in checkpoints
    ):
        raise ValueError(
            "migration checkpoints must contain non-empty revision strings"
        )
    if len(set(checkpoints)) != len(checkpoints):
        raise ValueError("migration checkpoints must not contain duplicates")
    return checkpoints


def run_matrix(checkpoint_path: Path) -> None:
    checkpoints = _load_checkpoints(checkpoint_path)
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    for checkpoint in checkpoints:
        _run_alembic("upgrade", checkpoint)
        revision = script.get_revision(checkpoint)
        # Relative -1 is ambiguous at a merge. Naming either parent unmerges
        # that revision and leaves both parent repairs installed.
        parent = revision.down_revision
        target = parent[0] if isinstance(parent, tuple) else "-1"
        _run_alembic("downgrade", target)
        _run_alembic("upgrade", checkpoint)
    _run_alembic("upgrade", "head")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise SystemExit(f"usage: {Path(argv[0]).name} CHECKPOINTS_JSON")
    run_matrix(Path(argv[1]).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
