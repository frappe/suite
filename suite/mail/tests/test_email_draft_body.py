# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest

from suite.mail.jmap.models import EmailAttachment, EmailCreateModel, EmailRecipient
from suite.mail.jmap.services.mail.email import TEXT_PLAIN_FLOWED, EmailService


def draft(**kwargs) -> dict:
    email = EmailCreateModel(
        creation_id="c1",
        from_email="sender@example.com",
        recipients=[EmailRecipient(type="to", name=None, email="rcpt@example.com")],
        **kwargs,
    )
    return EmailService._get_draft(email, "mailbox-1")


def attachment(disposition: str) -> EmailAttachment:
    return EmailAttachment(
        name="file.png", type="image/png", cid="cid-1", blob_id="blob-1", disposition=disposition
    )


class TextPart(unittest.TestCase):
    def test_declares_format_flowed(self):
        part = draft(text_body="Hi")["bodyStructure"]
        self.assertEqual(part["type"], TEXT_PLAIN_FLOWED)
        self.assertEqual(part["type"], "text/plain; format=flowed; delsp=no")

    def test_body_value_carries_the_text(self):
        self.assertEqual(draft(text_body="Hi\nthere")["bodyValues"]["text"]["value"], "Hi\nthere")

    def test_no_text_body_means_no_text_part(self):
        self.assertNotIn("text", draft(html_body="<p>Hi</p>")["bodyValues"])


class Structure(unittest.TestCase):
    def test_convenience_properties_are_never_used(self):
        # They are what strips the parameters, so nothing may fall back to them.
        payload = draft(text_body="Hi", html_body="<p>Hi</p>")
        self.assertNotIn("textBody", payload)
        self.assertNotIn("htmlBody", payload)

    def test_both_bodies_become_multipart_alternative(self):
        body = draft(text_body="Hi", html_body="<p>Hi</p>")["bodyStructure"]
        self.assertEqual(body["type"], "multipart/alternative")
        # Least faithful representation last, so a reader picks the richest it can show.
        self.assertEqual([p["partId"] for p in body["subParts"]], ["text", "html"])

    def test_single_body_is_not_wrapped(self):
        self.assertEqual(draft(text_body="Hi")["bodyStructure"]["partId"], "text")

    def test_inline_attachments_nest_in_multipart_related(self):
        body = draft(html_body="<p>Hi</p>", attachments=[attachment("inline")])["bodyStructure"]
        self.assertEqual(body["type"], "multipart/related")
        self.assertEqual(body["subParts"][0]["partId"], "html")

    def test_regular_attachments_nest_in_multipart_mixed(self):
        body = draft(text_body="Hi", attachments=[attachment("attachment")])["bodyStructure"]
        self.assertEqual(body["type"], "multipart/mixed")
        self.assertEqual(body["subParts"][0]["partId"], "text")

    def test_both_kinds_keep_inline_images_out_of_the_mixed_level(self):
        body = draft(
            text_body="Hi",
            html_body="<p>Hi</p>",
            attachments=[attachment("inline"), attachment("attachment")],
        )["bodyStructure"]
        self.assertEqual(body["type"], "multipart/mixed")
        related = body["subParts"][0]
        self.assertEqual(related["type"], "multipart/related")
        self.assertEqual(related["subParts"][0]["type"], "multipart/alternative")

    def test_attachments_without_a_body_stay_on_the_convenience_property(self):
        payload = draft(attachments=[attachment("attachment")])
        self.assertNotIn("bodyStructure", payload)
        self.assertEqual(len(payload["attachments"]), 1)


if __name__ == "__main__":
    unittest.main()
