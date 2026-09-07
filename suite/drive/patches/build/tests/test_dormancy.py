"""Build cannot run from an ordinary migrate until ticket 30 registers it.

A partial Build that ran on `bench migrate` would leave a site with blobs
and no nodes, and the §14.11 rollback ("truncate the new tables") assumes
Build either ran whole or not at all. These checks fail the moment someone
wires the package up early.
"""

import json
import unittest
from pathlib import Path

import suite.drive.patches.build as build

REPOSITORY_ROOT = Path(build.__file__).resolve().parents[4]
SUITE_ROOT = REPOSITORY_ROOT / "suite"


class TestBuildIsDormant(unittest.TestCase):
    def test_patches_txt_does_not_name_the_build_package(self):
        patches = (SUITE_ROOT / "patches.txt").read_text()
        self.assertNotIn("patches.build", patches)

    def test_the_package_has_no_patch_entry_point(self):
        # Ticket 29 composes `execute` once every step exists. Until then a
        # hand-added patches.txt line fails loudly instead of half-migrating.
        self.assertFalse(hasattr(build, "execute"))
        for module in ("gate", "legacy_bytes", "s3_copy", "state", "ports", "layout"):
            with self.subTest(module=module):
                self.assertFalse(hasattr(getattr(build, module, None), "execute"))

    def test_it_ships_no_doctype_no_fixture_and_no_json(self):
        self.assertEqual(sorted(p.name for p in Path(build.__file__).parent.glob("*.json")), [])

    def test_hooks_do_not_reference_it(self):
        hooks = (SUITE_ROOT / "hooks.py").read_text()
        self.assertNotIn("patches.build", hooks)
        self.assertNotIn("drive.patches.build", hooks)

    def test_no_fixture_names_it(self):
        for fixture in (SUITE_ROOT / "fixtures").glob("*.json"):
            with self.subTest(fixture=fixture.name):
                self.assertNotIn("patches.build", json.dumps(json.loads(fixture.read_text())))

    def test_importing_it_touches_no_site(self):
        # Every module is import-clean: no whitelisted endpoint, no scheduler
        # entry, no database read at import time.
        for module in ("gate", "legacy_bytes", "s3_copy", "state", "ports", "layout", "environment"):
            source = (Path(build.__file__).parent / f"{module}.py").read_text()
            with self.subTest(module=module):
                self.assertNotIn("frappe.whitelist", source)
                self.assertNotIn("scheduler_events", source)


if __name__ == "__main__":
    unittest.main()
