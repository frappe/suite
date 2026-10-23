"""Cleanup's wiring: one entry point, registered once, directly after Build.

Mirrors `suite.drive.patches.build.tests.test_registration`, against this
package instead. Cleanup is the destructive half of the migration, so the
checks here are stricter about the entry point: exactly one, on exactly one
line of `patches.txt`, and nothing else that could run it.
"""

import ast
import importlib
import inspect
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import suite.drive.patches.cleanup as cleanup

REPOSITORY_ROOT = Path(cleanup.__file__).resolve().parents[4]
SUITE_ROOT = REPOSITORY_ROOT / "suite"

PATCH_NAME = "suite.drive.patches.cleanup"
BUILD_NAME = "suite.drive.patches.build"


def patch_lines():
    return [
        line.strip()
        for line in (SUITE_ROOT / "patches.txt").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def source_modules():
    """This package's own `.py` files, not `tests/`."""
    return sorted(p for p in Path(cleanup.__file__).parent.glob("*.py"))


class TestCleanupIsRegisteredOnce(unittest.TestCase):
    def test_patches_txt_names_the_package_once_and_no_submodule(self):
        lines = patch_lines()
        self.assertEqual(lines.count(PATCH_NAME), 1)
        # No hand-added "suite.drive.patches.cleanup.removal" line either.
        # Matched as a dotted segment, not a bare substring: `suite.slides...
        # cleanup_unused_thumbnail_files` is an unrelated patch.
        self.assertEqual([line for line in lines if line.startswith(f"{PATCH_NAME}.")], [])

    def test_it_runs_directly_after_build_after_model_sync(self):
        lines = patch_lines()
        self.assertGreater(lines.index(PATCH_NAME), lines.index("[post_model_sync]"))
        self.assertEqual(lines.index(PATCH_NAME), lines.index(BUILD_NAME) + 1)

    def test_hooks_and_fixtures_do_not_reference_it(self):
        hooks = ast.parse((SUITE_ROOT / "hooks.py").read_text())
        for node in ast.walk(hooks):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                with self.subTest(line=node.lineno):
                    self.assertNotIn(PATCH_NAME, node.value)
        for fixture in (SUITE_ROOT / "fixtures").glob("*.json"):
            with self.subTest(fixture=fixture.name):
                self.assertNotIn(PATCH_NAME, json.dumps(json.loads(fixture.read_text())))

    def test_only_the_patch_module_defines_the_entry_point(self):
        self.assertTrue(callable(cleanup.execute))
        defining = [
            path.stem
            for path in source_modules()
            if hasattr(importlib.import_module(f"{cleanup.__name__}.{path.stem}"), "execute")
        ]
        # `__init__` re-exports it, which is what `patches.txt` imports.
        self.assertEqual(defining, ["__init__", "patch"])

    def test_execute_runs_the_site_environment_through_run_cleanup(self):
        source = inspect.getsource(cleanup.execute)
        self.assertIn("run_cleanup(CleanupEnvironment.for_site())", source)


class TestCleanupQueuesThePreviewBackfill(unittest.TestCase):
    """§9.2: migrated files get thumbnails from one job queued after Cleanup."""

    def setUp(self):
        self.calls = MagicMock()

    def _execute(self):
        with (
            patch("suite.drive.patches.cleanup.patch.CleanupEnvironment.for_site"),
            patch("suite.drive.patches.cleanup.patch.run_cleanup", self.calls.run_cleanup),
            patch("suite.drive._core.previews.enqueue_backfill", self.calls.enqueue_backfill),
        ):
            cleanup.execute()

    def test_a_completed_cleanup_queues_the_backfill_once_after_its_phases(self):
        self._execute()
        self.assertEqual([call[0] for call in self.calls.mock_calls], ["run_cleanup", "enqueue_backfill"])

    def test_a_refused_cleanup_queues_nothing(self):
        self.calls.run_cleanup.side_effect = cleanup.CleanupAuthorizationError("no backup recorded")
        with self.assertRaises(cleanup.CleanupAuthorizationError):
            self._execute()
        self.calls.enqueue_backfill.assert_not_called()


class TestCleanupIsOnlyAPatch(unittest.TestCase):
    def test_it_ships_no_doctype_no_fixture_and_no_json(self):
        self.assertEqual(sorted(p.name for p in Path(cleanup.__file__).parent.glob("*.json")), [])

    def test_it_exposes_no_endpoint_and_no_scheduled_work(self):
        for path in source_modules():
            with self.subTest(module=path.name):
                source = path.read_text()
                self.assertNotIn("frappe.whitelist", source)
                self.assertNotIn("scheduler_events", source)

    def test_nothing_runs_at_import_time(self):
        # A module-level call would fire on any import of this package,
        # including one from a test that only meant to import a sibling.
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
        # Importing this package for its exception classes or dataclasses
        # must never require a running site underneath.
        source = inspect.getsource(cleanup.CleanupEnvironment.for_site)
        self.assertIn("from suite.drive.patches.cleanup.ports import", source)


class TestCleanupSurfaceMatchesTheSpec(unittest.TestCase):
    """§14.10's own words, checked against what this package actually exports."""

    def test_check_gates_runs_both_gates_and_only_those(self):
        source = inspect.getsource(cleanup.check_gates)
        for name in ("check_gate_reachable_nodes", "check_gate_gc_discovery"):
            with self.subTest(gate=name):
                self.assertIn(name, source)
        self.assertNotIn("legacy_callers", source)

    def test_phases_is_the_14_10_order_with_no_bucket_delete(self):
        # Step 8, the legacy bucket objects, has no phase: Cleanup deletes
        # no bucket object, so the backup restore stays a complete rollback.
        names = [name for name, _phase in cleanup.PHASES]
        self.assertEqual(
            names,
            [
                "file_rows",
                "slides_media_rows",
                "custom_fields",
                "legacy_doctypes",
                "content_history",
                "content_fields",
                "thumbnails",
            ],
        )

    def test_the_legacy_object_delete_is_a_manual_command_not_a_patch_entry_point(self):
        from suite.drive.patches.cleanup import delete_legacy_objects

        self.assertTrue(callable(delete_legacy_objects.run))
        self.assertFalse(hasattr(delete_legacy_objects, "execute"))
        self.assertIn("delete_legacy_objects.run", cleanup.__doc__)
        self.assertIn("--kwargs \"{'confirm': True}\"", cleanup.__doc__)

    def test_the_backup_key_in_the_refusal_matches_the_documented_one(self):
        self.assertEqual(cleanup.BACKUP_CONFIG_KEY, "drive_cleanup_backup")
        self.assertIn(f"set-config {cleanup.BACKUP_CONFIG_KEY}", cleanup.__doc__)


if __name__ == "__main__":
    unittest.main()
