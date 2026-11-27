# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""A sent mail carries no quoted link that reads as one host and leads to another, which Rspamd
scores as PHISHING. Links the sender wrote, and links that read true, are left as they are."""

import unittest

from suite.mail.utils.quoted_content import unlink_lookalike_links


def quoted(inner: str, block: str = "frappe_mail_quote") -> str:
    return f'<div>Reply</div><div class="{block}"><blockquote>{inner}</blockquote></div>'


class Lookalikes(unittest.TestCase):
    def test_a_gmail_signature_link_that_drops_a_letter_becomes_plain_text(self):
        html = quoted('e<a href="https://www.example.com/">xample.com</a>')

        self.assertEqual(unlink_lookalike_links(html), quoted("example.com"))

    def test_a_link_reading_as_another_site_in_a_forward_becomes_plain_text(self):
        html = quoted(
            '<a href="https://tracker.example.net/c/1">https://bank.example.com/login</a>', "frappe_mail_fwd"
        )

        self.assertEqual(
            unlink_lookalike_links(html), quoted("https://bank.example.com/login", "frappe_mail_fwd")
        )

    def test_a_link_inside_nested_quotes_is_unlinked_once(self):
        html = quoted(quoted('<a href="https://other.org">example.com</a>'))

        self.assertEqual(unlink_lookalike_links(html), quoted(quoted("example.com")))

    def test_a_malformed_target_behind_host_text_becomes_plain_text(self):
        html = quoted('<a href="http://[www.example.com/](https://www.example.com/)">example.com</a>')

        self.assertEqual(unlink_lookalike_links(html), quoted("example.com"))


class LeftAlone(unittest.TestCase):
    def test_links_that_read_as_their_own_host_are_kept(self):
        for inner in (
            '<a href="https://www.example.com/">example.com</a>',
            '<a href="http://example.com/">https://www.example.com/</a>',
            '<a href="https://mail.example.com/inbox">example.com</a>',
            '<a href="https://example.com">www.example.com/about</a>',
        ):
            with self.subTest(inner=inner):
                self.assertEqual(unlink_lookalike_links(quoted(inner)), quoted(inner))

    def test_links_whose_text_is_not_an_address_are_kept(self):
        for inner in (
            '<a href="https://example.com">LinkedIn</a>',
            '<a href="mailto:ann@example.com">ann@example.com</a>',
            '<a href="tel:+911234567890">+91 1234567890</a>',
        ):
            with self.subTest(inner=inner):
                self.assertEqual(unlink_lookalike_links(quoted(inner)), quoted(inner))

    def test_the_senders_own_links_are_kept(self):
        html = '<div><a href="https://track.example.net/c/1">example.com</a></div>'

        self.assertEqual(unlink_lookalike_links(html), html)

    def test_no_body_stays_no_body(self):
        self.assertIsNone(unlink_lookalike_links(None))
        self.assertEqual(unlink_lookalike_links(""), "")


if __name__ == "__main__":
    unittest.main()
