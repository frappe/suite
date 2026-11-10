# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.account import (
    create_contacts_export,
    create_contacts_import,
    create_mail_export,
    create_mail_import,
)
from suite.mail.api.contacts import get_contacts
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailExchangeFormats(StalwartIntegrationTestCase):
    """Round-trips the exchange format matrix: export in each format, re-import the artifact."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.peer = cls.create_member()
        cls.disable_screening(cls.member)
        cls.account = cls.personal_account(cls.member)

        from suite.mail.api.mail import get_mailboxes

        with cls.set_user(cls.member.email):
            cls.inbox = {(m["role"] or "").lower(): m["id"] for m in get_mailboxes(cls.account)}["inbox"]

        # Seed the account with two delivered mails to give every export something to carry.
        cls.subjects = [f"Format seed {unique_name('subject')}" for _ in range(2)]
        for subject in cls.subjects:
            cls.deliver_mail(cls.peer, cls.member, subject=subject)

    def _exported_file_url(self, doctype: str, name: str) -> str:
        url = frappe.db.get_value(
            "File", {"attached_to_doctype": doctype, "attached_to_name": name}, "file_url"
        )
        self.assertTrue(url, f"{doctype} {name} produced no export file.")
        return url

    def _run_mail_round_trip(self, format: str, archive_type: str) -> None:
        with self.set_user(self.member.email):
            create_mail_export(self.account, format, archive_type, "Received At (DESC)")
            export = frappe.get_last_doc("Mail Exchange", {"account": self.account, "operation": "Export"})
            export._export()
            export.reload()
            self.assertEqual(export.status, "Completed", f"{format} export failed")

            # eml/mbox/maildir imports require a target mailbox.
            mailbox = self.inbox if format in ("eml", "mbox", "maildir") else None
            create_mail_import(
                self.account,
                format,
                self._exported_file_url("Mail Exchange", export.name),
                mailbox=mailbox,
            )
            imported = frappe.get_last_doc("Mail Exchange", {"account": self.account, "operation": "Import"})
            imported._import()
            imported.reload()
            self.assertEqual(imported.status, "Completed", f"{format} import failed")

    def test_mail_format_round_trips(self):
        # Formats x archive types, spread so zip/tgz/tar.gz extraction all run.
        for format, archive_type in (
            ("jmap", ".zip"),
            ("mbox", ".tgz"),
            ("maildir", ".tar.gz"),
            ("maildir-nested", ".zip"),
        ):
            with self.subTest(format=format, archive_type=archive_type):
                self._run_mail_round_trip(format, archive_type)

    def test_contacts_format_round_trips(self):
        from suite.mail.api.contacts import get_address_books
        from suite.mail.doctype.contact_card.contact_card import add_contact_card

        contact_email = f"{unique_name('contact')}@elsewhere.example.org"
        with self.set_user(self.member.email):
            books = get_address_books(self.account)
            default_book = next((b["id"] for b in books if b["default"]), books[0]["id"])
            add_contact_card(
                self.account,
                [default_book],
                full_name="Round Trip",
                emails=[{"address": contact_email, "type": "Personal"}],
            )

            for format, archive_type in (("vcf", ".zip"), ("jmap", ".tgz")):
                with self.subTest(format=format):
                    create_contacts_export(self.account, format, archive_type)
                    export = frappe.get_last_doc(
                        "Contacts Exchange", {"account": self.account, "operation": "Export"}
                    )
                    export._export()
                    export.reload()
                    self.assertEqual(export.status, "Completed", f"{format} export failed")

                    create_contacts_import(
                        self.account,
                        format,
                        self._exported_file_url("Contacts Exchange", export.name),
                        address_book=default_book,
                    )
                    imported = frappe.get_last_doc(
                        "Contacts Exchange", {"account": self.account, "operation": "Import"}
                    )
                    imported._import()
                    imported.reload()
                    self.assertEqual(imported.status, "Completed", f"{format} import failed")

            # The contact is still resolvable after the round-trips.
            self.wait_until(
                lambda: contact_email
                in [c["email"] for c in get_contacts(self.account, {"email": contact_email})],
                message="Contact vanished across export/import round-trips.",
            )

    def test_failed_import_can_be_retried(self):
        missing = frappe.get_doc(
            {"doctype": "File", "file_name": "empty.zip", "content": b"not an archive", "is_private": 1}
        ).insert(ignore_permissions=True)

        with self.set_user(self.member.email):
            create_mail_import(self.account, "mbox", missing.file_url, mailbox=self.inbox)
            doc = frappe.get_last_doc("Mail Exchange", {"account": self.account, "operation": "Import"})
            doc._import()
            doc.reload()
            self.assertEqual(doc.status, "Failed")

        # retry resets the exchange to Queued and re-enqueues the job (System Manager only).
        doc.retry()
        doc.reload()
        self.assertEqual(doc.status, "Queued")

        with self.set_user(self.member.email):
            self.assertRaises(frappe.PermissionError, doc.retry)
