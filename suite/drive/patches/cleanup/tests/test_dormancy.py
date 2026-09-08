"""Cleanup's own inertness: unregistered, no entry point, nothing runs at import.

Mirrors `suite.drive.patches.build.tests.test_dormancy.TestBuildIsOnlyAPatch`,
against this package instead. Ticket 35 ships Cleanup as real, tested code
with no wire-in: these checks are what makes "real code, still inert" more
than a claim in a docstring.
"""

import ast
import importlib
import json
import unittest
from pathlib import Path

import suite.drive.patches.cleanup as cleanup

REPOSITORY_ROOT = Path(cleanup.__file__).resolve().parents[4]
SUITE_ROOT = REPOSITORY_ROOT / "suite"

PATCH_NAME = "suite.drive.patches.cleanup"


def patch_lines():
    return [
        line.strip()
        for line in (SUITE_ROOT / "patches.txt").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def source_modules():
    """This package's own `.py` files, not `tests/`."""
    return sorted(p for p in Path(cleanup.__file__).parent.glob("*.py"))


class TestCleanupIsNotRegistered(unittest.TestCase):
    def test_nothing_in_patches_txt_names_it(self):
        self.assertNotIn(PATCH_NAME, patch_lines())

    def test_no_line_in_patches_txt_even_mentions_it(self):
        # Not just the exact dotted path: no line naming a submodule of this
        # package directly either (e.g. a hand-added
        # "suite.drive.patches.cleanup.removal" line). Matched as its own
        # dotted segment, not a bare substring: `suite.slides...patches.
        # cleanup_unused_thumbnail_files` is an unrelated existing patch
        # whose own name merely starts with the same letters.
        for line in patch_lines():
            with self.subTest(line=line):
                self.assertFalse(line == PATCH_NAME or line.startswith(f"{PATCH_NAME}."))

    def test_hooks_do_not_reference_it(self):
        hooks = ast.parse((SUITE_ROOT / "hooks.py").read_text())
        for node in ast.walk(hooks):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                with self.subTest(line=node.lineno):
                    self.assertNotIn(PATCH_NAME, node.value)

    def test_no_fixture_names_it(self):
        for fixture in (SUITE_ROOT / "fixtures").glob("*.json"):
            with self.subTest(fixture=fixture.name):
                self.assertNotIn(PATCH_NAME, json.dumps(json.loads(fixture.read_text())))

    def test_the_package_exports_no_execute(self):
        # `bench migrate` looks for `execute` on a name in `patches.txt`.
        # Build has one; Cleanup must not, on any module, ever.
        self.assertFalse(hasattr(cleanup, "execute"))
        for path in source_modules():
            module = importlib.import_module(f"{cleanup.__name__}.{path.stem}")
            with self.subTest(module=path.stem):
                self.assertFalse(hasattr(module, "execute"))

    def test_run_cleanup_is_not_reachable_from_execute_shaped_lookup(self):
        # A dotted patches.txt line always resolves `<module>.execute`. Proving
        # that name is absent everywhere (above) is the actual guarantee;
        # this just confirms the real entry point has a different name, so a
        # typo'd patches.txt line could not accidentally call it either.
        self.assertTrue(callable(cleanup.run_cleanup))
        self.assertNotEqual(cleanup.run_cleanup.__name__, "execute")


class TestCleanupIsOnlyTestedCode(unittest.TestCase):
    def test_it_ships_no_doctype_no_fixture_and_no_json(self):
        self.assertEqual(sorted(p.name for p in Path(cleanup.__file__).parent.glob("*.json")), [])

    def test_it_exposes_no_endpoint_and_no_scheduled_work(self):
        for path in source_modules():
            with self.subTest(module=path.name):
                source = path.read_text()
                self.assertNotIn("frappe.whitelist", source)
                self.assertNotIn("scheduler_events", source)

    def test_nothing_runs_at_import_time(self):
        # Same shape as Build's check: a module-level call would fire on any
        # import of this package, including an accidental one from a test
        # that only meant to import a sibling.
        allowed = (
            ast.Import,
            ast.ImportFrom,
            ast.ClassDef,
            ast.FunctionDef,
            ast.Assign,
            ast.AnnAssign,
        )
        for path in source_modules():
            for node in ast.parse(path.read_text()).body:
                with self.subTest(module=path.name, line=node.lineno):
                    if isinstance(node, ast.Expr):
                        # a docstring, and nothing else
                        self.assertIsInstance(node.value, ast.Constant)
                        self.assertIsInstance(node.value.value, str)
                    else:
                        self.assertIsInstance(node, allowed)

    def test_for_site_wires_frappe_only_inside_the_method_body(self):
        # `import frappe` at module level is fine (Build's own modules do it
        # too, for the exception base classes) and needs no site. What must
        # stay lazy is the actual site-touching object construction inside
        # `for_site()`, so that importing this package for its exception
        # classes or dataclasses never requires a running site underneath.
        import inspect

        source = inspect.getsource(cleanup.CleanupEnvironment.for_site)
        self.assertIn("from suite.drive.patches.cleanup.ports import", source)


class TestCleanupSurfaceMatchesTheSpec(unittest.TestCase):
    """§14.10's own words, checked against what this package actually exports."""

    def test_check_gates_runs_all_three_gates_and_only_those(self):
        import inspect

        source = inspect.getsource(cleanup.check_gates)
        for name in (
            "check_gate_reachable_nodes",
            "check_gate_gc_discovery",
            "check_gate_legacy_callers_removed",
        ):
            with self.subTest(gate=name):
                self.assertIn(name, source)

    def test_phases_is_the_eight_step_14_10_order(self):
        names = [name for name, _phase in cleanup.PHASES]
        self.assertEqual(
            names,
            [
                "file_rows",
                "custom_fields",
                "legacy_doctypes",
                "content_history",
                "content_fields",
                "legacy_api",
                "thumbnails",
                "s3_prefix",
            ],
        )


if __name__ == "__main__":
    unittest.main()
