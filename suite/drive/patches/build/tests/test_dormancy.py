"""How Build is registered, and how Cleanup is not.

Build is additive: it writes new rows and drops no legacy column, so
`suite/patches.txt` runs it on an ordinary migrate. Cleanup is the
destructive half and §14.10 puts it one release later, so nothing may
register it early. §14.11's rollback ("truncate the new tables and ship the
old code") holds only while that stays true.

The rest of these checks are the ones the package has always had: Build is
a patch and nothing else. No doctype, no fixture, no endpoint, no scheduled
job, and no work at import time.
"""

import ast
import importlib
import json
import re
import unittest
from pathlib import Path

import suite.drive.patches.build as build

REPOSITORY_ROOT = Path(build.__file__).resolve().parents[4]
SUITE_ROOT = REPOSITORY_ROOT / "suite"

PATCH_NAME = "suite.drive.patches.build"
CLEANUP_NAME = "suite.drive.patches.cleanup"

# SQL that removes data, as this codebase spells it. Prose about §14.11's
# "truncate the new tables" rollback is lowercase and is not this.
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b")

# The ORM spellings of the same thing.
DESTRUCTIVE_CALLS = ("delete_doc", "db.delete", "db.truncate")


def patch_lines():
    return [
        line.strip()
        for line in (SUITE_ROOT / "patches.txt").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


class TestBuildIsRegistered(unittest.TestCase):
    def test_patches_txt_names_it_once(self):
        self.assertEqual(patch_lines().count(PATCH_NAME), 1)

    def test_it_runs_after_model_sync(self):
        lines = patch_lines()
        self.assertGreater(lines.index(PATCH_NAME), lines.index("[post_model_sync]"))

    def test_it_runs_after_every_other_drive_patch(self):
        # Build reads the legacy tables. Every patch that reshapes them has
        # to have finished first, and the simplest way to hold that is to
        # keep Build last in the file.
        self.assertEqual(patch_lines()[-1], PATCH_NAME)

    def test_the_package_exports_the_entry_point(self):
        self.assertTrue(callable(build.execute))

    def test_only_the_patch_module_defines_it(self):
        # One entry point, so a half-written phase cannot be run on its own
        # by a hand-added patches.txt line.
        defining = [
            path.stem
            for path in self.modules()
            if hasattr(importlib.import_module(f"{build.__name__}.{path.stem}"), "execute")
        ]
        # `__init__` re-exports it, which is what `patches.txt` imports.
        self.assertEqual(defining, ["__init__", "patch"])

    def modules(self):
        return sorted(p for p in Path(build.__file__).parent.glob("*.py"))


class TestCleanupIsNotRegistered(unittest.TestCase):
    """§14.10: the destructive half ships one release later."""

    def test_nothing_names_it(self):
        self.assertNotIn(CLEANUP_NAME, patch_lines())
        self.assertNotIn(CLEANUP_NAME, (SUITE_ROOT / "hooks.py").read_text())

    def test_the_module_does_not_exist_yet(self):
        self.assertFalse((Path(build.__file__).parent.parent / "cleanup.py").exists())

    def test_build_removes_nothing(self):
        """Build is additive. Every statement that is not runs in Cleanup."""
        for path in TestBuildIsRegistered().modules():
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    with self.subTest(module=path.name, line=node.lineno):
                        self.assertIsNone(DESTRUCTIVE_SQL.search(node.value))
                if isinstance(node, ast.Call):
                    called = ast.unparse(node.func)
                    with self.subTest(module=path.name, line=node.lineno, call=called):
                        self.assertFalse(any(called.endswith(name) for name in DESTRUCTIVE_CALLS))


class TestBuildIsOnlyAPatch(unittest.TestCase):
    def test_it_ships_no_doctype_no_fixture_and_no_json(self):
        self.assertEqual(sorted(p.name for p in Path(build.__file__).parent.glob("*.json")), [])

    def test_hooks_do_not_reference_it(self):
        # Code, not prose: `hooks.py` explains where Build runs in the note
        # above `drive_content_types`, and naming it there wires nothing.
        hooks = ast.parse((SUITE_ROOT / "hooks.py").read_text())
        for node in ast.walk(hooks):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                with self.subTest(line=node.lineno):
                    self.assertNotIn("patches.build", node.value)

    def test_no_fixture_names_it(self):
        for fixture in (SUITE_ROOT / "fixtures").glob("*.json"):
            with self.subTest(fixture=fixture.name):
                self.assertNotIn("patches.build", json.dumps(json.loads(fixture.read_text())))

    def test_it_exposes_no_endpoint_and_no_scheduled_work(self):
        for path in TestBuildIsRegistered().modules():
            with self.subTest(module=path.name):
                source = path.read_text()
                self.assertNotIn("frappe.whitelist", source)
                self.assertNotIn("scheduler_events", source)

    def test_nothing_runs_at_import_time(self):
        # A module-level call would fire on any import of the package, which
        # includes the hook loader and the architecture sweep.
        allowed = (
            ast.Import,
            ast.ImportFrom,
            ast.ClassDef,
            ast.FunctionDef,
            ast.Assign,
            ast.AnnAssign,
        )
        for path in TestBuildIsRegistered().modules():
            for node in ast.parse(path.read_text()).body:
                with self.subTest(module=path.name, line=node.lineno):
                    if isinstance(node, ast.Expr):
                        # a docstring, and nothing else
                        self.assertIsInstance(node.value, ast.Constant)
                        self.assertIsInstance(node.value.value, str)
                    else:
                        self.assertIsInstance(node, allowed)


if __name__ == "__main__":
    unittest.main()
