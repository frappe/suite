# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

# import frappe
from frappe.tests import IntegrationTestCase

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]


class IntegrationTestMailMessage(IntegrationTestCase):
    """
    Integration tests for MailMessage.
    Use this class for testing interactions between multiple components.
    """

    def test_preview_excludes_quoted_reply_trail(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        # The quote containers the client collapses must not leak into the preview.
        for quote_class in ["gmail_quote", "frappe_mail_quote"]:
            html = (
                "<div>Sounds good, see you then!</div>"
                f'<div class="{quote_class}">On 28 Jul 2026 at 4:47 PM, x@y.com wrote: the original</div>'
            )
            self.assertEqual(preview_from_html(html), "Sounds good, see you then!")

    def test_preview_excludes_nested_quotes(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        html = (
            "<p>Latest reply</p>"
            '<div class="gmail_quote">Previous reply'
            '<blockquote class="frappe_mail_quote">Original message</blockquote></div>'
        )
        self.assertEqual(preview_from_html(html), "Latest reply")

    def test_preview_excludes_trail_outlook_web_prefixed(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        # Outlook on the web prefixes every class it quotes with x_.
        html = (
            "<div>Thanks.</div>"
            '<div class="x_frappe_mail_quote">On 18 Sep wrote:<blockquote>'
            '<div class="x_gmail_quote">older</div></blockquote></div>'
        )
        self.assertEqual(preview_from_html(html), "Thanks.")

    def test_preview_excludes_outlook_web_header_and_what_follows(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        # Outlook wraps nothing: the original follows its From/Sent/To header as siblings.
        html = (
            "<div>Please find the attached.</div>"
            '<div id="appendonsend"></div><hr>'
            '<div id="divRplyFwdMsg"><b>From:</b> A<br><b>Sent:</b> Friday</div>'
            "<div><div>Hi, thanks for the list.</div></div>"
        )
        self.assertEqual(preview_from_html(html), "Please find the attached.")

    def test_preview_excludes_cite_blockquote_with_its_attribution(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        # Thunderbird: a classed attribution line, then <blockquote type="cite">.
        html = (
            "<div>Yes.</div>"
            '<div class="moz-cite-prefix">On 18/09/2026 11:37, A wrote:</div>'
            '<blockquote type="cite"><div>the original</div></blockquote>'
        )
        self.assertEqual(preview_from_html(html), "Yes.")

    def test_preview_keeps_plain_blockquote_and_forwarded_message(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        html = '<blockquote>a pull quote</blockquote><div class="frappe_mail_fwd">the forwarded message</div>'
        self.assertEqual(preview_from_html(html), "a pull quote the forwarded message")

    def test_preview_falls_back_to_full_body_for_quote_only_message(self):
        from suite.mail.doctype.mail_message.mail_message import preview_from_html

        # A forwarded/quote-only message must never end up with a blank preview.
        html = '<div class="gmail_quote">On 28 Jul 2026, John wrote: the original</div>'
        self.assertEqual(preview_from_html(html), "On 28 Jul 2026, John wrote: the original")
