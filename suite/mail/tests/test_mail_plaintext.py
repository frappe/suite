# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from email import message_from_bytes, policy

import frappe

from suite.mail.api.mail import fetch_mail_as_eml
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name

BODY = (
    "<div>Hi Team,</div>"
    "<div><br></div>"
    '<div>Please review <a href="https://example.com/docs/spec">the spec page</a> '
    "and reply to support@example.com if anything looks wrong before Friday.</div>"
    "<div><br></div>"
    "<ul><li>First item</li><li>Second item</li></ul>"
    "<div><br></div>"
    "<div>Regards,</div>"
    "<div>Alex</div>"
)


class TestOutgoingPlaintext(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sender = cls.create_member()
        cls.receiver = cls.create_member()
        cls.disable_screening(cls.receiver)

    def delivered(self, html_body: str = BODY, **kwargs):
        """Sends a mail, waits for it, and returns the parsed MIME message as received."""

        subject = "Plaintext " + unique_name("subject")
        result = self.send_mail(
            self.sender, self.receiver.email, subject=subject, html_body=html_body, **kwargs
        )
        self.assertEqual(result["status"], "Submitted", result.get("error"))

        thread = self.wait_until(
            lambda: next((t for t in self.get_inbox_threads(self.receiver) if t["subject"] == subject), None),
            timeout=60,
            message="Mail did not arrive.",
        )
        with self.set_user(self.receiver.email):
            eml = bytes(fetch_mail_as_eml(thread["messages"][-1]["name"]))
        return message_from_bytes(eml, policy=policy.default)

    @staticmethod
    def body_part(message, content_type: str):
        """The body part of the given type, skipping attachments that share it."""

        return next(
            part
            for part in message.walk()
            if part.get_content_type() == content_type and not part.get_filename()
        )

    def text_body(self, message) -> str:
        """The decoded text part, CRLF normalised so line assertions read naturally.

        Stalwart sends this part quoted-printable, which is what carries a soft break's
        trailing space over the wire (as =20). The decoder hands it back with CRLF endings,
        so splitting on "\\n" alone would leave a "\\r" on every line and hide the space.
        """

        return self.body_part(message, "text/plain").get_content().replace("\r\n", "\n")

    def test_send_carries_a_text_alternative(self):
        message = self.delivered()
        self.assertEqual(message.get_content_type(), "multipart/alternative")
        # Least faithful first, so a reader picks the richest part it can show.
        self.assertEqual([p.get_content_type() for p in message.iter_parts()], ["text/plain", "text/html"])

    def test_text_part_declares_format_flowed(self):
        # The whole reason _get_draft spells out bodyStructure. If this fails, Stalwart dropped
        # the parameters and the flowed encoding should be turned off with it.
        text = self.body_part(self.delivered(), "text/plain")
        self.assertEqual(text.get_param("format"), "flowed")
        self.assertEqual(text.get_param("delsp"), "no")
        self.assertEqual((text.get_content_charset() or "").lower(), "utf-8")

    def test_content_type_is_not_duplicated(self):
        text = self.body_part(self.delivered(), "text/plain")
        self.assertEqual(len(text.get_all("Content-Type") or []), 1)

    def test_text_part_keeps_the_shape_of_the_message(self):
        body = self.text_body(self.delivered())

        self.assertGreater(len(body.splitlines()), 5, "body arrived as one run: " + repr(body))
        self.assertIn("- First item", body)
        self.assertIn("- Second item", body)
        # The old converter turned this into "support@example. com".
        self.assertIn("support@example.com", body)
        self.assertIn("<https://example.com/docs/spec>", body)
        self.assertRegex(body, r"Regards,\n *Alex")

    def test_soft_breaks_survive_transport(self):
        body = self.text_body(self.delivered())
        wrapped = [line for line in body.splitlines() if line.endswith(" ")]
        self.assertTrue(wrapped, "no soft line breaks reached the reader: " + repr(body))

    def test_attachment_send_still_works(self):
        # The bodyStructure switch replaced the `attachments` convenience property.
        message = self.delivered(
            attachments=[{"file_url": self._text_file(), "file_name": "note.txt", "type": "text/plain"}]
        )
        self.assertEqual(message.get_content_type(), "multipart/mixed")
        self.assertIn("note.txt", [p.get_filename() for p in message.walk()])
        self.assertEqual(self.body_part(message, "text/plain").get_param("format"), "flowed")

    def _text_file(self) -> str:
        return (
            frappe.get_doc(
                {
                    "doctype": "File",
                    "file_name": "note-" + unique_name("f") + ".txt",
                    "content": "attached",
                    "is_private": 1,
                }
            )
            .insert(ignore_permissions=True)
            .file_url
        )

    def test_signature_is_introduced_by_the_separator(self):
        # The composer wraps the signature it inserts; without the marker the block is just
        # more markup and a reader cannot tell where the message ends.
        html = (
            "<div>Regards,</div><div>Alex</div><div><br></div>"
            '<div class="frappe_mail_signature"><div>Alex Smith</div>'
            "<div>Support Team</div></div>"
        )
        body = self.text_body(self.delivered(html))

        self.assertIn("\n-- \nAlex Smith\nSupport Team", body)
        # RFC 3676 4.3: the only fixed line allowed to end in a space.
        self.assertEqual([line for line in body.splitlines() if line.endswith(" ")], ["-- "])

    def test_a_text_only_mail_arrives_as_text(self):
        # RFC 8621 lets htmlBody fall back to the text parts, so a mail with no HTML used to
        # reach the reader through html_body, where prose is parsed as markup.
        from suite.mail.api.outbound import send
        from suite.mail.tests.test_mail_inbound_outbound_api import fake_request

        subject = "Text only " + unique_name("subject")
        with self.set_user(self.sender.email), fake_request():
            queue = send(
                from_=self.sender.email,
                to=self.receiver.email,
                subject=subject,
                text="Line one\nLine two",
            )
            frappe.get_doc("Mail Queue", queue)._process()

        thread = self.wait_until(
            lambda: next((t for t in self.get_inbox_threads(self.receiver) if t["subject"] == subject), None),
            timeout=60,
            message="Text-only mail did not arrive.",
        )
        message = thread["messages"][-1]

        self.assertFalse(message["html_body"], "a text-only body must not arrive as HTML")
        self.assertIn("Line one", message["text_body"])
        self.assertIn("Line two", message["text_body"])
