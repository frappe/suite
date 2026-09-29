# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""What Mail Queue accepts in its recipients, Reply-To, headers and attachments, and the JMAP
addresses it sends from them. Every sender of mail builds these rows, so a row one of them
shapes differently must fail when it is queued, not when the mail is processed."""

import frappe
from frappe.exceptions import FrappeTypeError
from frappe.tests import UnitTestCase

from suite.mail.api.outbound import format_recipients, format_reply_to
from suite.mail.doctype.mail_queue.mail_queue import bulk_retry
from suite.mail.doctype.mail_queue.payload import Address, Attachments, Headers, Recipients
from suite.mail.jmap.models import EmailAddress, EmailRecipient
from suite.utils.validation import parse


class TestAddresses(UnitTestCase):
    def test_send_api_reply_to_reaches_jmap_with_its_name(self):
        # The send API's Reply-To used to be stored under a key the queue never read, so every
        # API send that named a Reply-To failed when it was processed.
        reply_to = parse(list[Address], format_reply_to("Ann Lee <ann@example.com>"))

        self.assertEqual(
            [a.to_jmap() for a in reply_to], [EmailAddress(name="Ann Lee", email="ann@example.com")]
        )

    def test_send_api_recipients_keep_their_display_names(self):
        rows = format_recipients(to="Bob <Bob@Example.com>", cc="carol@example.com")

        self.assertEqual(
            [r.to_jmap() for r in parse(Recipients, rows)],
            [
                EmailRecipient(name="Bob", email="bob@example.com", type="to"),
                EmailRecipient(name="", email="carol@example.com", type="cc"),
            ],
        )

    def test_an_incomplete_row_refuses_the_whole_list(self):
        # Skipping it would send the mail to the others without someone the sender meant to reach.
        valid = {"type": "To", "email": "a@example.com"}
        for row in (
            {"email": "b@example.com"},
            {"type": "", "email": "b@example.com"},
            {"type": "Cc", "display_name": "Bea"},
            {"type": "Cc", "email": "", "display_name": "Bea"},
            {"type": "Cc", "email": None},
        ):
            with self.subTest(row=row), self.assertRaises(frappe.ValidationError):
                parse(Recipients, [valid, row])

    def test_malformed_recipients_are_refused(self):
        for row in (
            {"type": "Reply-To", "email": "a@example.com"},
            {"type": "To", "email": "not-an-address"},
            {"type": "To", "email": "a@example.com", "name": "A"},  # the key is display_name
        ):
            with self.subTest(row=row), self.assertRaises(frappe.ValidationError):
                parse(Recipients, [row])

    def test_a_raw_message_header_with_a_stray_comma(self):
        # Recipients read off a raw message's headers are split on commas; an empty piece is not
        # an addressee.
        doc = frappe.new_doc("Mail Queue")
        doc.raw_message = "To: Ann <ann@example.com>,\nCc: , bob@example.com\nSubject: Hi\n\nHello"
        doc.validate_raw_message()

        self.assertEqual(doc.to, [{"name": "Ann", "email": "ann@example.com"}])
        self.assertEqual(doc.cc, [{"name": "", "email": "bob@example.com"}])
        self.assertEqual(doc.bcc, [])


class TestAttachments(UnitTestCase):
    def test_compose_ui_rows_with_blank_keys(self):
        # The compose UI sends every key, leaving the ones that don't apply "" or None.
        blob, file = parse(
            Attachments,
            [
                {
                    "file_url": "",
                    "blob_id": "b1",
                    "filename": "logo.png",
                    "type": "image/png",
                    "size": 120,
                    "disposition": "inline",
                    "cid": "logo",
                },
                {
                    "file_url": "/private/files/report.pdf",
                    "blob_id": "",
                    "filename": "",
                    "type": "",
                    "size": "",
                    "disposition": None,
                    "cid": "",
                },
            ],
        )

        self.assertEqual((blob.blob_id, blob.cid, blob.disposition), ("b1", "logo", "inline"))
        self.assertFalse(blob.is_private_file)
        self.assertEqual((file.filename, file.disposition), ("report.pdf", "attachment"))
        self.assertTrue(file.is_private_file)
        self.assertTrue(file.cid)

    def test_a_blob_attached_twice_is_sent_once(self):
        row = {"blob_id": "b1", "type": "text/plain", "disposition": "attachment"}

        self.assertEqual(len(parse(Attachments, [row, dict(row)])), 1)

    def test_malformed_attachments_are_refused(self):
        for row in (
            {"disposition": "attachment"},  # neither a blob nor a file
            {"blob_id": "b1"},  # a blob with no type
            {"file_url": "/etc/passwd"},  # not a site file
            {"file_url": "/files/a.pdf", "disposition": "embedded"},
        ):
            with self.subTest(row=row), self.assertRaises(frappe.ValidationError):
                parse(Attachments, [row])


class TestHeaders(UnitTestCase):
    def test_custom_headers_pass(self):
        self.assertEqual(parse(Headers, {"X-Campaign": "sept"}), {"X-Campaign": "sept"})

    def test_standard_headers_cannot_be_overridden(self):
        for key in ("Subject", "reply-to", "X-Mail-Queue"):
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(frappe.ValidationError, "standard email header"),
            ):
                parse(Headers, {key: "x"})


class TestBulkRetryBoundary(UnitTestCase):
    def test_desk_sends_names_as_a_json_string(self):
        # Iterated as a string, "[]" would look up a Mail Queue named "[" and fail.
        bulk_retry("[]")

        with self.assertRaises(FrappeTypeError):
            bulk_retry("no-such-mail")
