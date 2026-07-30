# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import unittest

from suite.utils import clean_text


class TestCleanText(unittest.TestCase):
    def test_keeps_email_addresses_intact(self):
        # "x@y.com" must not become "x@y. com" in list-row previews
        self.assertEqual(clean_text("Contact x@y.com for help"), "Contact x@y.com for help")

    def test_keeps_urls_intact(self):
        self.assertEqual(clean_text("See https://frappe.io/docs now"), "See https://frappe.io/docs now")

    def test_spaces_out_run_on_sentences(self):
        self.assertEqual(clean_text("word.Next sentence,here!Go"), "word. Next sentence, here! Go")

    def test_collapses_and_trims_whitespace(self):
        self.assertEqual(clean_text("  hello   world  "), "hello world")

    def test_strips_invisible_characters(self):
        self.assertEqual(clean_text("zero​width"), "zerowidth")

    def test_empty_input(self):
        self.assertEqual(clean_text(""), "")
