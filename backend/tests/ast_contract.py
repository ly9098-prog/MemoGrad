"""AST fingerprints with a common shape for Python 3.11 and 3.12."""

import ast
import copy
import hashlib


def digest(node: ast.AST) -> str:
    """Use the 3.12 declaration shape without erasing nonempty type parameters.

    Python 3.12 added ``type_params`` to function and class declarations. Add
    the equivalent empty field on 3.11 so existing 3.12 fingerprints remain
    valid. Work on a copy because callers also inspect the original tree.
    """
    tree = copy.deepcopy(node)
    for declaration in ast.walk(tree):
        if isinstance(
            declaration, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            if "type_params" not in declaration._fields:
                declaration._fields = (*declaration._fields, "type_params")
                declaration.type_params = []
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()
