# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``clean_text`` and ``convert_html_to_text`` produce the one-line strings previews are made of.
One line is the point here, unlike ``suite.mail.utils.html_to_text``, which keeps a body's shape
for the text/plain part. What a preview must not do is take a message's words apart."""

import unittest

from suite.utils import clean_text, convert_html_to_text


class CleanText(unittest.TestCase):
    def test_collapses_whitespace(self):
        self.assertEqual(clean_text("one   two\n\nthree"), "one two three")

    def test_trims(self):
        self.assertEqual(clean_text("  padded  "), "padded")

    def test_empty(self):
        self.assertEqual(clean_text(""), "")
        self.assertEqual(clean_text(None), "")

    def test_strips_invisible_characters(self):
        self.assertEqual(clean_text("He​llo﻿"), "Hello")


class TokensSurvive(unittest.TestCase):
    """A rule once split any `,.!?` that ran into a word, to repair sentences whose space had
    gone missing. Nothing needs it: both callers hand over text that is already spaced. What it
    did instead was take apart every address, version and filename it met."""

    def test_address_is_not_split(self):
        self.assertEqual(clean_text("Mail support@example.com today."), "Mail support@example.com today.")

    def test_url_is_not_split(self):
        self.assertEqual(clean_text("See https://example.com/a/b now"), "See https://example.com/a/b now")

    def test_version_is_not_split(self):
        self.assertEqual(clean_text("Version 1.2.3 shipped"), "Version 1.2.3 shipped")

    def test_decimal_is_not_split(self):
        self.assertEqual(clean_text("Costs $3.50 each"), "Costs $3.50 each")

    def test_abbreviation_is_not_split(self):
        self.assertEqual(clean_text("Use e.g. a filter"), "Use e.g. a filter")

    def test_filename_is_not_split(self):
        self.assertEqual(clean_text("Attached report.pdf"), "Attached report.pdf")


class ConvertHtmlToText(unittest.TestCase):
    def test_blocks_are_separated(self):
        # The separator get_text is given, which is what makes the removed rule unnecessary.
        self.assertEqual(convert_html_to_text("<p>Hello.</p><p>World</p>"), "Hello. World")

    def test_adjacent_inline_nodes_are_separated(self):
        self.assertEqual(convert_html_to_text("<p><b>Bold.</b>Next</p>"), "Bold. Next")

    def test_anchor_text_is_kept_without_its_url(self):
        # A preview wants the words, not the destination.
        html = '<p>Read <a href="https://example.com/spec">the spec</a>.</p>'
        self.assertEqual(convert_html_to_text(html), "Read the spec .")

    def test_address_survives_the_round_trip(self):
        self.assertIn("support@example.com", convert_html_to_text("<p>Mail support@example.com.</p>"))

    def test_empty(self):
        self.assertEqual(convert_html_to_text(""), "")


if __name__ == "__main__":
    unittest.main()
