# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""An exchange's JSON Metadata and Filter are checked when it is saved: a typo or a wrong shape
must be refused then, not surface later inside the import or export job."""

import json

import frappe
from frappe.model.document import Document
from frappe.tests import IntegrationTestCase


def mail_import(metadata: str) -> Document:
    return frappe.new_doc(
        "Mail Exchange",
        operation="Import",
        import_format="eml",
        import_file="/private/files/inbox.eml",
        import_metadata=metadata,
    )


def contacts_import(metadata: str) -> Document:
    return frappe.new_doc(
        "Contacts Exchange",
        operation="Import",
        import_format="vcf",
        import_file="/private/files/people.vcf",
        import_metadata=metadata,
    )


class TestMailImportMetadata(IntegrationTestCase):
    def test_flags_set_to_false_are_dropped_and_the_date_is_read_as_utc(self):
        doc = mail_import(
            json.dumps(
                {
                    "mailboxIds": {"inbox": True, "archive": False},
                    "keywords": {"$seen": True, "$flagged": False},
                    "receivedAt": "2026-01-31T09:30:00+05:30",
                }
            )
        )
        doc.validate_import()

        self.assertEqual(
            doc.import_metadata_dict,
            {
                "mailboxIds": {"inbox": True},
                "keywords": {"$seen": True},
                "receivedAt": "2026-01-31T04:00:00Z",
            },
        )

    def test_malformed_metadata_is_refused(self):
        for metadata in (
            '{"mailboxIDs": {"inbox": true}}',  # misspelt, so the mail would land nowhere
            '{"mailboxIds": {}}',
            '{"mailboxIds": ["inbox"]}',
            '{"mailboxIds": {"inbox": true}, "receivedAt": "last week"}',
            "{mailboxIds: {inbox: true}}",
        ):
            with self.subTest(metadata=metadata), self.assertRaises(frappe.ValidationError):
                mail_import(metadata).validate_import()


class TestContactsExchangeJSON(IntegrationTestCase):
    def test_target_address_books_are_kept(self):
        doc = contacts_import('{"addressBookIds": {"work": true}}')
        doc.validate_import()

        self.assertEqual(doc.target_address_book_ids, {"work": True})

    def test_malformed_metadata_is_refused(self):
        for metadata in ('{"addressBooks": {"work": true}}', '{"addressBookIds": "work"}', "[]"):
            with self.subTest(metadata=metadata), self.assertRaises(frappe.ValidationError):
                contacts_import(metadata).validate_import()

    def test_export_filter_must_be_a_json_object(self):
        doc = frappe.new_doc("Contacts Exchange", operation="Export", export_archive_type=".zip")

        doc.export_filter = '{"text": "ann"}'
        doc.validate_export()
        self.assertEqual(json.loads(doc.export_filter), {"text": "ann"})

        for export_filter in ('["ann"]', "text=ann"):
            doc.export_filter = export_filter
            with self.subTest(export_filter=export_filter), self.assertRaises(frappe.ValidationError):
                doc.validate_export()
