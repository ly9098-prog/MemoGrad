"""Regression tests for the CI migration helpers."""

import json
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from scripts import ci_migration_matrix_check
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


@pytest.mark.parametrize(
    ("installed", "missing"),
    [
        ("v21_task_outbox_owner", "v21_import_request_index"),
        ("v21_import_request_index", "v21_task_outbox_owner"),
    ],
)
def test_merge_preserves_both_repairs_for_databases_at_either_parent(
    installed, missing
):
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    pending = {
        revision.revision
        for revision in script.iterate_revisions(
            "v22_merge_import_owner", installed, implicit_base=True
        )
    }
    assert pending == {missing, "v22_merge_import_owner"}


def test_merge_checkpoint_avoids_ambiguous_relative_downgrade(
    monkeypatch, tmp_path: Path
):
    path = tmp_path / "checkpoints.json"
    path.write_text(json.dumps(["v22_merge_import_owner"]))
    calls = []
    monkeypatch.setattr(
        ci_migration_matrix_check, "_run_alembic", lambda *args: calls.append(args)
    )
    ci_migration_matrix_check.run_matrix(path)
    assert calls == [
        ("upgrade", "v22_merge_import_owner"),
        ("downgrade", "v21_import_request_index"),
        ("upgrade", "v22_merge_import_owner"),
        ("upgrade", "head"),
    ]
