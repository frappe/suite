"""How Build is registered, and what the repository no longer carries.

One `bench migrate` runs Build and then Cleanup, both after model sync:
`suite/patches.txt` names this package and then `suite.drive.patches.cleanup`
directly after it. Frappe's model sync never drops a column and only drops
orphan doctypes after the patches have run, so the legacy tables and columns
Build reads are still there when it runs, and Cleanup drops them in the same
migrate. That ordering is what these checks hold.

The legacy code those tables belonged to is gone from the source tree. The
list below is §14.10's deletion list as this repository spelled it; every
name on it must now be absent, so Build cannot quietly depend on one again.

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

# SQL that removes data, as this codebase spells it.
DESTRUCTIVE_SQL = re.compile(r"\b(DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b")

# The ORM spellings of the same thing.
DESTRUCTIVE_CALLS = ("delete_doc", "db.delete", "db.truncate")


def patch_lines():
    return [
        line.strip()
        for line in (SUITE_ROOT / "patches.txt").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]


def build_modules():
    return sorted(p for p in Path(build.__file__).parent.glob("*.py"))


class TestBuildThenCleanupAreRegistered(unittest.TestCase):
    def test_patches_txt_names_each_once(self):
        lines = patch_lines()
        self.assertEqual(lines.count(PATCH_NAME), 1)
        self.assertEqual(lines.count(CLEANUP_NAME), 1)

    def test_both_run_after_model_sync(self):
        lines = patch_lines()
        self.assertGreater(lines.index(PATCH_NAME), lines.index("[post_model_sync]"))
        self.assertGreater(lines.index(CLEANUP_NAME), lines.index("[post_model_sync]"))

    def test_cleanup_runs_directly_after_build_and_nothing_runs_after_cleanup(self):
        # Build reads the legacy tables and Cleanup drops them. Every patch
        # that reshapes those tables has to have finished before Build, and
        # nothing may expect them after Cleanup, so the two close the file.
        lines = patch_lines()
        self.assertEqual(lines[-2:], [PATCH_NAME, CLEANUP_NAME])

    def test_both_packages_export_an_entry_point(self):
        self.assertTrue(callable(build.execute))
        self.assertTrue(callable(importlib.import_module(CLEANUP_NAME).execute))

    def test_only_the_patch_module_defines_build_s_entry_point(self):
        # One entry point, so a half-written phase cannot be run on its own
        # by a hand-added patches.txt line.
        defining = [
            path.stem
            for path in build_modules()
            if hasattr(importlib.import_module(f"{build.__name__}.{path.stem}"), "execute")
        ]
        # `__init__` re-exports it, which is what `patches.txt` imports.
        self.assertEqual(defining, ["__init__", "patch"])

    def test_build_removes_nothing_but_the_docshares_it_rewrote(self):
        """Build is additive but for one row. Everything else runs in Cleanup.

        §5.13's read guards fail closed on a `DocShare` for a governed
        doctype and `framework.validate_content_registry` refuses the
        migration while one is left, so the rows steps 6 and 10 rewrite as
        grants go with them. Nothing else may, so the exception is pinned to
        the exact call: `frappe.db.delete("DocShare", ...)`.
        """
        found = []
        for path in build_modules():
            tree = ast.parse(path.read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    with self.subTest(module=path.name, line=node.lineno):
                        self.assertIsNone(DESTRUCTIVE_SQL.search(node.value))
                if isinstance(node, ast.Call):
                    called = ast.unparse(node.func)
                    if not any(called.endswith(name) for name in DESTRUCTIVE_CALLS):
                        continue
                    with self.subTest(module=path.name, line=node.lineno, call=called):
                        self.assertEqual(called, "frappe.db.delete")
                        self.assertTrue(node.args)
                        self.assertEqual(getattr(node.args[0], "value", None), "DocShare")
                    found.append(path.name)
        # Two ports write it: `SiteDrive` for the Sheet rows step 6 owns and
        # `SiteContentTarget` for the content rows step 10 owns. A third
        # would be a deletion nobody decided.
        self.assertEqual(found, ["ports.py", "ports.py"])


# §14.10's deletion list, as this repository spelled it. Cleanup drops every
# runtime trace of these on a site; the source tree must carry none of them.
# The list is written out rather than derived: a check that read the same
# files it guards would pass on an empty repository.
REMOVED_DOCTYPES = (
    "drive/doctype/drive_permission",
    "drive/doctype/drive_entity_activity_log",
    "drive/doctype/drive_entity_log",
    "drive/doctype/drive_token",
    "drive/doctype/drive_team",
    "drive/doctype/drive_team_member",
    "drive/doctype/drive_user_invitation",
    "drive/doctype/drive_legacy_call",
    "drive/doctype/account_request",
    "writer/doctype/writer_version",
    "writer/doctype/writer_doc_version",
    "writer/doctype/writer_template",
    "sheets/doctype/sheet_snapshot",
)

REMOVED_PACKAGES = (
    "drive/api",
    "drive/utils",
    "drive/overrides",
    "drive/http/shims.py",
    "drive/http/legacy_calls.py",
)

# Doctype JSON, and the fields on it Cleanup drops. §3.13's ten `Drive Disk
# Settings` fields and all three of Sheet's trash columns, in full.
REMOVED_FIELDS = (
    ("drive/doctype/drive_settings", ("user_folder", "quota")),
    (
        "drive/doctype/drive_disk_settings",
        (
            "quota",
            "root_folder",
            "thumbnail_prefix",
            "flat",
            "enabled",
            "aws_key",
            "aws_secret",
            "bucket",
            "endpoint_url",
            "signature_version",
        ),
    ),
    ("drive/doctype/drive_storage_reservation", ("storage_owner",)),
    ("drive/doctype/drive_favourite", ("entity",)),
    ("drive/doctype/drive_root", ("acl_generation",)),
    (
        "drive/doctype/drive_notification",
        ("from_user", "type", "message", "notif_doctype", "notif_doctype_name", "entity_type"),
    ),
    ("slides/doctype/presentation", ("title",)),
    ("sheets/doctype/sheet", ("title", "trashed", "trashed_on", "trashed_by")),
    ("writer/doctype/writer_document", ("versions",)),
)

LEGACY_METHOD_PREFIX = "/api/method/suite.drive.api."


def fixture_rows(name):
    path = SUITE_ROOT / "fixtures" / f"{name}.json"
    return json.loads(path.read_text()) if path.is_file() else []


def doctype_fields(path):
    folder = SUITE_ROOT / path
    return {
        field["fieldname"] for field in json.loads((folder / f"{folder.name}.json").read_text())["fields"]
    }


class TestTheLegacyBackendIsGoneFromTheSource(unittest.TestCase):
    """Cleanup drops these on the site; nothing in the tree may still ship
    them, or the next model sync would recreate what Cleanup removed."""

    def test_the_legacy_doctypes_are_no_longer_shipped(self):
        for path in REMOVED_DOCTYPES:
            with self.subTest(doctype=path):
                self.assertFalse((SUITE_ROOT / path).exists())

    def test_the_legacy_packages_are_no_longer_shipped(self):
        for path in REMOVED_PACKAGES:
            with self.subTest(path=path):
                self.assertFalse((SUITE_ROOT / path).exists())

    def test_no_fixture_adds_a_file_custom_field_or_property_setter(self):
        self.assertEqual([row for row in fixture_rows("custom_field") if row.get("dt") == "File"], [])
        self.assertEqual(
            [row for row in fixture_rows("property_setter") if row.get("doc_type") == "File"], []
        )

    def test_every_legacy_column_cleanup_drops_is_undeclared(self):
        for path, fieldnames in REMOVED_FIELDS:
            held = doctype_fields(path)
            for fieldname in fieldnames:
                with self.subTest(doctype=path, fieldname=fieldname):
                    self.assertNotIn(fieldname, held)

    def test_the_legacy_method_prefix_is_no_longer_reachable(self):
        hooks = importlib.import_module("suite.hooks")
        self.assertNotIn(LEGACY_METHOD_PREFIX, hooks.ALLOWED_WILDCARD_PATHS)
        self.assertIn("/api/suite/drive/", hooks.ALLOWED_WILDCARD_PATHS)

    def test_build_imports_nothing_from_the_removed_packages(self):
        for path in build_modules():
            for node in ast.walk(ast.parse(path.read_text())):
                if isinstance(node, ast.ImportFrom) and node.module:
                    with self.subTest(module=path.name, line=node.lineno, imported=node.module):
                        self.assertFalse(
                            node.module.startswith(
                                ("suite.drive.api", "suite.drive.utils", "suite.drive.overrides")
                            )
                        )


class TestBuildIsOnlyAPatch(unittest.TestCase):
    def test_it_ships_no_doctype_no_fixture_and_no_json(self):
        self.assertEqual(sorted(p.name for p in Path(build.__file__).parent.glob("*.json")), [])

    def test_hooks_do_not_reference_it(self):
        # Code, not prose: `hooks.py` may explain where Build runs in a
        # comment, and naming it there wires nothing.
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
        for path in build_modules():
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
        for path in build_modules():
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
