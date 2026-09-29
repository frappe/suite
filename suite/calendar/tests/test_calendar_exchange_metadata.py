# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""A Calendar Exchange's JSON Metadata and Filter are checked when it is saved: a typo or a
wrong shape must be refused then, not surface later inside the import or export job."""

import json

import frappe
from frappe.model.document import Document
from frappe.tests import IntegrationTestCase


def calendar_import(metadata: str) -> Document:
    return frappe.new_doc(
        "Calendar Exchange",
        operation="Import",
        import_format="ics",
        import_file="/private/files/team.ics",
        import_metadata=metadata,
    )


class TestCalendarExchangeJSON(IntegrationTestCase):
    def test_target_calendars_are_kept(self):
        doc = calendar_import('{"calendarIds": {"work": true}}')
        doc.validate_import()

        self.assertEqual(doc.target_calendar_ids, {"work": True})

    def test_malformed_metadata_is_refused(self):
        for metadata in (
            '{"calendarIDs": {"work": true}}',  # misspelt, so events would go to the default calendar
            '{"calendarIds": ["work"]}',
            '{"calendarIds": {"work": True}}',  # Python, not JSON
        ):
            with self.subTest(metadata=metadata), self.assertRaises(frappe.ValidationError):
                calendar_import(metadata).validate_import()

    def test_export_filter_must_be_a_json_object(self):
        doc = frappe.new_doc("Calendar Exchange", operation="Export", export_archive_type=".zip")

        doc.export_filter = '{"after": "2026-01-01T00:00:00Z"}'
        doc.validate_export()
        self.assertEqual(json.loads(doc.export_filter), {"after": "2026-01-01T00:00:00Z"})

        for export_filter in ("[]", "after=2026"):
            doc.export_filter = export_filter
            with self.subTest(export_filter=export_filter), self.assertRaises(frappe.ValidationError):
                doc.validate_export()
