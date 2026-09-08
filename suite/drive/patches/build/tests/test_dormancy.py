"""How Build is registered, and how Cleanup is not.

Build is additive: it writes new rows and drops no legacy column, so
`suite/patches.txt` runs it on an ordinary migrate. Cleanup is the
destructive half and §14.10 puts it one release later, so nothing may
register it early. §14.11's rollback ("truncate the new tables and ship the
old code") holds only while that stays true, and while everything the old
code reads is still here, so §14.10's deletion list is checked item by item.

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


# §14.10's deletion list, as this repository spells it today. Every name here
# is something Cleanup removes, so finding all of them is what proves Cleanup
# has not started. The list is written out rather than derived: a gate that
# read the same files it guards would pass on an empty repository.
RETAINED_DOCTYPES = (
    "drive/doctype/drive_permission",
    "drive/doctype/drive_entity_activity_log",
    "drive/doctype/drive_token",
    "writer/doctype/writer_version",
    "writer/doctype/writer_doc_version",
    "writer/doctype/writer_template",
    "sheets/doctype/sheet_snapshot",
)

RETAINED_FILE_CUSTOM_FIELDS = (
    "section_break_nfot8",
    "mime_type",
    "status",
    "file_modified",
    "column_break_tapww",
    "content_doctype",
    "content_docname",
)

RETAINED_PROPERTY_SETTERS = (
    ("File", "file_url", "depends_on"),
    ("File", "folder", "hidden"),
    ("File", "folder", "depends_on"),
)

# Doctype JSON, and the fields on it Cleanup drops.
RETAINED_FIELDS = (
    ("drive/doctype/drive_settings", ("user_folder", "quota")),
    ("drive/doctype/drive_disk_settings", ("quota", "aws_key", "aws_secret", "bucket", "endpoint_url")),
    ("drive/doctype/drive_storage_reservation", ("storage_owner",)),
    ("slides/doctype/presentation", ("title",)),
    ("sheets/doctype/sheet", ("title", "trashed", "sheets_data")),
    ("writer/doctype/writer_document", ("ycomments", "versions")),
)

LEGACY_METHOD_PREFIX = "/api/method/suite.drive.api."


def fixture(name):
    return json.loads((SUITE_ROOT / "fixtures" / f"{name}.json").read_text())


def doctype_fields(path):
    folder = SUITE_ROOT / path
    return {
        field["fieldname"]
        for field in json.loads((folder / f"{folder.name}.json").read_text())["fields"]
    }


class TestCleanupHasRemovedNothingYet(unittest.TestCase):
    """§14.10's list, still whole, one release before it may be cut.

    Build is the expand half. §14.11's rollback is "truncate the new tables
    and ship the old code", and the old code reads every name below. A
    Ticket 29 change that removed one of them early would leave the branch
    with no way back, and would do it quietly: the new tables would answer
    every read, so nothing would look broken until someone rolled back.
    """

    def test_the_source_doctypes_are_all_still_shipped(self):
        for path in RETAINED_DOCTYPES:
            with self.subTest(doctype=path):
                folder = SUITE_ROOT / path
                self.assertTrue((folder / f"{folder.name}.json").is_file())

    def test_the_seven_file_custom_fields_are_still_in_the_fixture(self):
        held = {row["fieldname"] for row in fixture("custom_field") if row.get("dt") == "File"}
        self.assertEqual(held, set(RETAINED_FILE_CUSTOM_FIELDS))

    def test_the_three_property_setters_are_still_in_the_fixture(self):
        held = {
            (row["doc_type"], row.get("field_name"), row["property"])
            for row in fixture("property_setter")
        }
        self.assertEqual(held, set(RETAINED_PROPERTY_SETTERS))

    def test_every_legacy_column_cleanup_drops_is_still_declared(self):
        for path, fieldnames in RETAINED_FIELDS:
            held = doctype_fields(path)
            for fieldname in fieldnames:
                with self.subTest(doctype=path, fieldname=fieldname):
                    self.assertIn(fieldname, held)

    def test_the_legacy_method_prefix_is_still_reachable(self):
        # Additive: §11.2's route namespace was added beside the old prefix,
        # not in place of it, and Cleanup removes the old one.
        hooks = importlib.import_module("suite.hooks")
        self.assertIn(LEGACY_METHOD_PREFIX, hooks.ALLOWED_WILDCARD_PATHS)
        self.assertIn("/api/suite/drive/", hooks.ALLOWED_WILDCARD_PATHS)

    def test_all_sixty_nine_forwarders_are_still_classified(self):
        shims = importlib.import_module("suite.drive.http.shims")
        self.assertEqual(len(shims.CLASSIFICATION), 69)


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
