"""Verify the content adapters activated by Suite composition."""

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core import content
from suite.drive._core.content import registry


class TestContentRegistry(IntegrationTestCase):
    def test_the_registry_holds_the_four_activated_apps(self):
        """Staged activation (§10.3, README execution rules).

        An app declares its spec in its own adoption ticket — Writer at 17,
        Slides at 18, Sheets at 19 — and joins `drive_content_types` at ticket
        29, once Build has linked every row. Draw joins through its adoption
        patch before Cleanup. Each declaration is the one its app ships.
        """
        content.clear_registry_cache()
        self.assertEqual(
            sorted(registry()),
            ["Drawing", "Presentation", "Sheet", "Writer Document"],
        )
        for doctype, dotted in (
            ("Writer Document", "suite.writer.drive.SPEC"),
            ("Presentation", "suite.slides.drive.SPEC"),
            ("Sheet", "suite.sheets.drive.SPEC"),
            ("Drawing", "suite.draw.drive.SPEC"),
        ):
            with self.subTest(doctype=doctype):
                self.assertIs(registry()[doctype], frappe.get_attr(dotted))
