"""Regression tests for the CI migration helpers."""

import json
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from scripts.ci_collect_migration_checkpoints import collect_checkpoints
from scripts.ci_migration_matrix_check import _load_checkpoints


def test_collect_migration_checkpoints_is_a_non_empty_unique_chain():
    checkpoints = collect_checkpoints()

    assert checkpoints
    assert len(checkpoints) == len(set(checkpoints))
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [checkpoints[-1]]


def test_load_migration_checkpoints_rejects_invalid_shape(tmp_path: Path):
    path = tmp_path / "checkpoints.json"
    path.write_text(json.dumps({"revision": "head"}), encoding="utf-8")

    try:
        _load_checkpoints(path)
    except ValueError as exc:
        assert "non-empty JSON array" in str(exc)
    else:
        raise AssertionError("invalid checkpoint JSON was accepted")
