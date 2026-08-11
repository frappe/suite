# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``decode_encoded_words`` — the RFC 2047 decoding display names need when the mail server could
not do it: an encoded-word inside a quoted string, which the standard does not allow and a strict
parser therefore passes through untouched."""

import unittest

from suite.mail.utils.email_parser import decode_encoded_words


class DecodeEncodedWords(unittest.TestCase):
    def test_encoded_word_is_decoded(self):
        self.assertEqual(decode_encoded_words("=?UTF-8?B?7KCV7J2A7Jyk?="), "정은윤")

    def test_word_joined_to_plain_text_keeps_the_join(self):
        """No separator is invented — `make_header` would put a space after the slash."""

        self.assertEqual(
            decode_encoded_words("Jungeun Yun/=?UTF-8?B?7KCV7J2A7Jyk?="), "Jungeun Yun/정은윤"
        )

    def test_surrounding_text_and_spacing_survive(self):
        self.assertEqual(decode_encoded_words("Ann =?utf-8?q?caf=C3=A9?= Lee"), "Ann café Lee")

    def test_whitespace_between_two_words_is_dropped(self):
        """It belongs to the encoding, not to the name (RFC 2047, §6.2)."""

        self.assertEqual(decode_encoded_words("=?utf-8?q?Jane?= =?utf-8?q?_Doe?="), "Jane Doe")

    def test_quoted_printable_is_decoded(self):
        self.assertEqual(decode_encoded_words("=?utf-8?q?caf=C3=A9?="), "café")

    def test_unknown_charset_falls_back_to_utf8(self):
        self.assertEqual(decode_encoded_words("=?bogus-charset?q?hi?="), "hi")

    def test_malformed_word_is_left_alone(self):
        self.assertEqual(decode_encoded_words("=?utf-8?q?broken"), "=?utf-8?q?broken")

    def test_plain_name_is_untouched(self):
        self.assertEqual(decode_encoded_words("Jane Doe"), "Jane Doe")
        self.assertEqual(decode_encoded_words("a=?b"), "a=?b")

    def test_blank_values_pass_through(self):
        self.assertIsNone(decode_encoded_words(None))
        self.assertEqual(decode_encoded_words(""), "")


if __name__ == "__main__":
    unittest.main()
