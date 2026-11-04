# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import unittest

import frappe

from suite.mail.api.mail import attachment_rows
from suite.mail.jmap import TEXT_PLAIN_FLOWED, build_email_draft


def draft(**kwargs) -> dict:
    return build_email_draft(
        from_email="sender@example.com",
        recipients=[{"type": "to", "name": None, "email": "rcpt@example.com"}],
        draft_mailbox_id="mailbox-1",
        queue_name="c1",
        **kwargs,
    )


def attachment(disposition: str) -> dict:
    return {
        "name": "file.png",
        "type": "image/png",
        "cid": "cid-1",
        "blob_id": "blob-1",
        "disposition": disposition,
    }


class HeldAttachments(unittest.TestCase):
    """What a draft update keeps of the attachments the draft already holds."""

    def setUp(self):
        held = frappe._dict(blob_id="held-blob", file_url="", filename="old.png", type="image/png", size=1)
        held.as_dict = lambda: dict(held)
        self.held = {"cid-1": held}

    def test_a_row_the_composer_read_earlier_keeps_the_drafts_bytes(self):
        [row] = attachment_rows([{"cid": "cid-1", "blob_id": "stale-blob"}], self.held)
        self.assertEqual(row["blob_id"], "held-blob")

    def test_a_new_upload_under_a_held_cid_replaces_the_bytes(self):
        [row] = attachment_rows([{"cid": "cid-1", "file_url": "/files/new.png"}], self.held)
        self.assertEqual((row["file_url"], row["blob_id"]), ("/files/new.png", ""))


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


class ReplyTo(unittest.TestCase):
    def test_goes_out_as_addresses_with_their_names(self):
        payload = draft(
            reply_to=[
                {"name": 'Ann "Nan" Lee', "email": "ann@example.com"},
                {"name": "Doe, John", "email": "john@example.com"},
            ]
        )

        self.assertEqual(
            payload["replyTo"],
            [
                {"name": 'Ann "Nan" Lee', "email": "ann@example.com"},
                {"name": "Doe, John", "email": "john@example.com"},
            ],
        )

    def test_an_address_without_a_name_gets_no_name(self):
        # An identity's Reply-To may carry no name; it used to be written out as "None".
        payload = draft(reply_to=[{"name": None, "email": "team@example.com"}])

        self.assertEqual(payload["replyTo"], [{"name": None, "email": "team@example.com"}])
        self.assertNotIn("header:Reply-To", payload)

    def test_no_reply_to_sets_nothing(self):
        self.assertNotIn("replyTo", draft())


if __name__ == "__main__":
    unittest.main()
