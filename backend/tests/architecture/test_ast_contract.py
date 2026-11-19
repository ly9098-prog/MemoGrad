"""Cross-version fingerprints retain declaration and body semantics."""

import ast

import pytest

from tests.ast_contract import digest


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            "def fn(x: int = 1) -> int:\n    return x + 1",
            "88c4a218f63667c97e59f75c591097923349154d36c4bf138bf7fd8c857515cb",
        ),
        (
            "class Item:\n    async def run(self):\n        return 1",
            "b84d96c7cb13091e8dad64b78fdcf0f80aab4b3f847696f0974974150f4fa8b1",
        ),
    ],
)
def test_fingerprint_matches_python312_without_mutating_source(source, expected):
    tree = ast.parse(source)
    original_dump = ast.dump(tree)
    assert digest(tree) == expected
    assert ast.dump(tree) == original_dump


def test_nonempty_type_parameters_are_not_discarded():
    node = ast.parse("def fn():\n    return 1").body[0]
    original_digest = digest(node)
    if "type_params" not in node._fields:
        node._fields = (*node._fields, "type_params")
    node.type_params = [ast.Name(id="T", ctx=ast.Load())]
    assert digest(node) != original_digest
