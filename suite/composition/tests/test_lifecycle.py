"""A migrate syncs the modules on disk, not the module map cached before a pull."""

import unittest

import frappe

from suite.composition.lifecycle import before_migrate


class TestBeforeMigrate(unittest.TestCase):
    def tearDown(self):
        frappe.cache.delete_value("app_modules")
        frappe.setup_module_map()

    def test_a_module_missing_from_the_cached_map_is_mapped_from_disk(self):
        stale = {**frappe.local.app_modules, "suite": ["drive", "writer"]}
        frappe.cache.set_value("app_modules", stale)
        frappe.setup_module_map()

        before_migrate()

        self.assertIn("content", frappe.local.app_modules["suite"])
        self.assertEqual(frappe.local.module_app["content"], "suite")
