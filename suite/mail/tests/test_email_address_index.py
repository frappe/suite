# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The email-address index's contracts: display names lose the quotes clients wrap them in, only
valid addresses are indexed, and re-indexing is safe — a name survives a nameless sighting, the
last-sent date only moves forward, and the contact flag only turns on."""

import shutil
import tempfile
import unittest
from contextlib import nullcontext
from unittest import mock

from suite.mail.store.indexes.email_address import (
    EmailAddressIndex,
    _sanitize_name,
    matches_email_address,
    tokenize,
)


class SanitizeName(unittest.TestCase):
    """``_sanitize_name`` — strip wrapping quote pairs, leave everything else alone."""

    def test_single_quote_pair_is_stripped(self):
        self.assertEqual(_sanitize_name("'Jane Doe'"), "Jane Doe")

    def test_double_quote_pair_is_stripped(self):
        self.assertEqual(_sanitize_name('"Jane Doe"'), "Jane Doe")

    def test_backtick_pair_is_stripped(self):
        self.assertEqual(_sanitize_name("`Jane Doe`"), "Jane Doe")

    def test_nested_quote_pairs_are_stripped(self):
        self.assertEqual(_sanitize_name("\"'Jane Doe'\""), "Jane Doe")

    def test_whitespace_between_nested_pairs_is_stripped(self):
        self.assertEqual(_sanitize_name(" ' \"Jane\" ' "), "Jane")

    def test_unbalanced_quote_is_kept(self):
        self.assertEqual(_sanitize_name("'Jane"), "'Jane")
        self.assertEqual(_sanitize_name("Jane'"), "Jane'")

    def test_mismatched_quotes_are_kept(self):
        self.assertEqual(_sanitize_name("'Jane\""), "'Jane\"")

    def test_interior_apostrophe_is_kept(self):
        self.assertEqual(_sanitize_name("O'Brien"), "O'Brien")

    def test_quotes_only_becomes_none(self):
        self.assertIsNone(_sanitize_name("''"))
        self.assertIsNone(_sanitize_name('" "'))

    def test_blank_becomes_none(self):
        self.assertIsNone(_sanitize_name(None))
        self.assertIsNone(_sanitize_name(""))
        self.assertIsNone(_sanitize_name("   "))


class Tokenize(unittest.TestCase):
    """``tokenize`` — lowercased alphanumeric runs, matching how the index tokenized the text."""

    def test_name_and_address_split_on_punctuation(self):
        self.assertEqual(
            tokenize("Jane Doe jane.doe@example.com"), ["jane", "doe", "jane", "doe", "example", "com"]
        )

    def test_accented_word_stays_whole(self):
        self.assertEqual(tokenize("Jörg Müller"), ["jörg", "müller"])

    def test_non_latin_script_stays_whole(self):
        self.assertEqual(tokenize("山田太郎"), ["山田太郎"])

    def test_underscore_separates_words(self):
        self.assertEqual(tokenize("jane_doe"), ["jane", "doe"])

    def test_blank_has_no_tokens(self):
        self.assertEqual(tokenize(None), [])
        self.assertEqual(tokenize("  -- "), [])


class MatchesEmailAddress(unittest.TestCase):
    """``matches_email_address`` — the index's own matching, for addresses from other sources."""

    def setUp(self):
        self.jane = {"name": "Jane Doe", "email": "jd@example.com"}

    def test_trailing_term_matches_as_a_prefix_of_any_word(self):
        self.assertTrue(matches_email_address("jan", self.jane))
        self.assertTrue(matches_email_address("exam", self.jane))

    def test_earlier_terms_must_match_whole_words(self):
        self.assertTrue(matches_email_address("jane d", self.jane))
        self.assertFalse(matches_email_address("ja doe", self.jane))

    def test_terms_may_span_name_and_address(self):
        self.assertTrue(matches_email_address("doe jd", self.jane))

    def test_a_word_inside_another_does_not_match(self):
        self.assertFalse(matches_email_address("ane", self.jane))

    def test_blank_query_matches_nothing(self):
        self.assertFalse(matches_email_address(" - ", self.jane))


class Index(unittest.TestCase):
    """A real index on disk; only the site path and the Redis write lock are stood in for."""

    def setUp(self):
        path = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, path, ignore_errors=True)
        for target, value in (
            ("suite.store.search_store.get_search_base_path", lambda: path),
            ("suite.store.search_store.write_lock", lambda *args, **kwargs: nullcontext()),
        ):
            patcher = mock.patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        self.index = EmailAddressIndex(("mail", "account"))

    def get(self, email):
        """The stored entry for `email`, as a hit returns it."""

        hits = [hit for hit in self.index.get_email_address_hits(email) if hit["id"] == email.lower()]
        self.assertEqual(len(hits), 1)
        hit = hits[0]
        return {key: hit.get(key) for key in ("name", "email", "last_sent_at", "is_contact")}

    def test_an_address_comes_back_as_indexed(self):
        self.index.index_addresses([{"name": "'Jane Doe'", "email": "Jane@Example.com", "last_sent_at": 100}])

        self.assertEqual(
            self.get("jane@example.com"),
            {"name": "Jane Doe", "email": "Jane@Example.com", "last_sent_at": 100, "is_contact": False},
        )

    def test_invalid_addresses_are_not_indexed(self):
        self.index.index_addresses(
            [
                {"name": "No Email"},
                {"email": "not-an-email"},
                {"email": "Jane <jane@example.com>"},
                {"email": "jane@example"},
                {"name": "Valid", "email": "valid@example.com"},
            ]
        )

        # Every candidate shares "example"; only the valid one was indexed.
        self.assertEqual(
            [hit["email"] for hit in self.index.get_email_address_hits("example")], ["valid@example.com"]
        )

    def test_indexing_the_same_address_twice_changes_nothing(self):
        address = {"name": "Jane Doe", "email": "jane@example.com", "last_sent_at": 100, "is_contact": True}
        self.index.index_addresses([address])
        first = self.get("jane@example.com")

        self.index.index_addresses([address])

        self.assertEqual(self.get("jane@example.com"), first)

    def test_the_last_sent_date_only_moves_forward(self):
        self.index.index_addresses([{"email": "jane@example.com", "last_sent_at": 200}])
        self.index.index_addresses([{"email": "jane@example.com", "last_sent_at": 100}])
        self.index.index_addresses([{"email": "jane@example.com"}])

        self.assertEqual(self.get("jane@example.com")["last_sent_at"], 200)

        self.index.index_addresses([{"email": "jane@example.com", "last_sent_at": 300}])
        self.assertEqual(self.get("jane@example.com")["last_sent_at"], 300)

    def test_the_contact_flag_stays_on(self):
        self.index.index_addresses([{"email": "jane@example.com", "is_contact": True}])
        self.index.index_addresses([{"email": "jane@example.com"}])

        self.assertTrue(self.get("jane@example.com")["is_contact"])

    def test_a_name_survives_a_nameless_sighting_and_yields_to_a_new_one(self):
        self.index.index_addresses([{"name": "Jane Doe", "email": "jane@example.com"}])
        self.index.index_addresses([{"name": "''", "email": "jane@example.com"}])
        self.assertEqual(self.get("jane@example.com")["name"], "Jane Doe")

        self.index.index_addresses([{"name": "Jane Roe", "email": "jane@example.com"}])
        self.assertEqual(self.get("jane@example.com")["name"], "Jane Roe")

    def test_one_batch_merges_its_own_copies_the_same_way(self):
        self.index.index_addresses(
            [
                {"name": "Jane Doe", "email": "jane@example.com", "last_sent_at": 200},
                {"email": "JANE@example.com", "last_sent_at": 100, "is_contact": True},
            ]
        )

        entry = self.get("jane@example.com")
        self.assertEqual((entry["name"], entry["last_sent_at"], entry["is_contact"]), ("Jane Doe", 200, True))

    def test_the_new_name_is_searchable_and_the_old_one_is_not(self):
        self.index.index_addresses([{"name": "Jane Doe", "email": "jd@example.com"}])
        self.index.index_addresses([{"name": "Jane Roe", "email": "jd@example.com"}])

        self.assertEqual(
            [hit["email"] for hit in self.index.get_email_address_hits("roe")], ["jd@example.com"]
        )
        self.assertEqual(self.index.get_email_address_hits("doe"), [])

    def test_blank_query_finds_nothing(self):
        self.index.index_addresses([{"email": "jane@example.com"}])

        self.assertEqual(self.index.get_email_address_hits("  -- "), [])


if __name__ == "__main__":
    unittest.main()
