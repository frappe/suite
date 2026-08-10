# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The email-address index's normalization and ranking contracts: display names lose the quotes
clients wrap them in, only syntactically valid addresses ever reach the index, and suggestions come
back ordered by how well the query matches a name or address rather than in index order."""

import unittest
from unittest import mock

from suite.mail.store.indexes.email_address import (
    EmailAddressIndex,
    _relevance_key,
    _sanitize_name,
    _tokenize,
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


class ToDocument(unittest.TestCase):
    """``to_document`` — lowercased key, original-cased address, sanitized name in the text blob."""

    def to_document(self, address):
        # to_document touches no instance state, so skip SearchStore's on-disk constructor.
        return EmailAddressIndex.to_document(mock.Mock(spec=EmailAddressIndex), address)

    def test_name_is_sanitized_everywhere(self):
        document = self.to_document({"name": "'Jane Doe'", "email": "Jane@Example.com", "count": 3})
        self.assertEqual(
            document,
            {
                "id": "jane@example.com",
                "email": "Jane@Example.com",
                "name": "Jane Doe",
                "text": "Jane Doe Jane@Example.com",
                "count": 3,
            },
        )

    def test_missing_name_leaves_email_only_text(self):
        document = self.to_document({"email": "jane@example.com"})
        self.assertIsNone(document["name"])
        self.assertEqual(document["text"], "jane@example.com")

    def test_missing_count_is_no_interactions(self):
        self.assertEqual(self.to_document({"email": "jane@example.com"})["count"], 0)


class MergeDocument(unittest.TestCase):
    """``merge_document`` — an upsert adds to the count already indexed instead of resetting it."""

    def merge(self, document, replaced):
        return EmailAddressIndex.merge_document(mock.Mock(spec=EmailAddressIndex), document, replaced)

    def test_counts_accumulate_across_upserts(self):
        merged = self.merge({"id": "jane@example.com", "count": 2}, {"id": "jane@example.com", "count": 5})
        self.assertEqual(merged["count"], 7)

    def test_first_sighting_keeps_its_own_count(self):
        self.assertEqual(self.merge({"id": "jane@example.com", "count": 2}, None)["count"], 2)

    def test_uncounted_entry_leaves_the_total_alone(self):
        # A contact card re-indexing an address the user has exchanged messages with.
        merged = self.merge({"id": "jane@example.com", "count": 0}, {"id": "jane@example.com", "count": 5})
        self.assertEqual(merged["count"], 5)


class IndexAddresses(unittest.TestCase):
    """``index_addresses`` — drop entries without a syntactically valid email, add up the rest."""

    def index_addresses(self, addresses):
        """Return the addresses that survive filtering and reach ``index_documents``."""

        index = mock.Mock(spec=EmailAddressIndex)
        EmailAddressIndex.index_addresses(index, addresses)
        return index.index_documents.call_args[0][0]

    def test_valid_email_is_indexed(self):
        address = {"name": "Jane", "email": "jane@example.com", "count": 1}
        self.assertEqual(self.index_addresses([address]), [address])

    def test_missing_email_is_skipped(self):
        self.assertEqual(self.index_addresses([{"name": "Jane"}, {"name": "No Email", "email": ""}]), [])

    def test_malformed_emails_are_skipped(self):
        malformed = [
            {"email": "not-an-email"},
            {"email": "Jane <jane@example.com>"},
            {"email": "jane@example"},  # no TLD
            {"email": "jane @example.com"},
            {"email": "@example.com"},
        ]
        self.assertEqual(self.index_addresses(malformed), [])

    def test_valid_survives_malformed_neighbours(self):
        valid = {"name": "Jane", "email": "jane@example.com", "count": 1}
        self.assertEqual(self.index_addresses([{"email": "not-an-email"}, valid]), [valid])

    def test_batch_dedupes_case_insensitively(self):
        first = {"name": "Jane", "email": "jane@example.com", "count": 1}
        second = {"name": "Jane Doe", "email": "Jane@Example.com", "count": 1}
        self.assertEqual(self.index_addresses([first, second]), [{**second, "count": 2}])

    def test_missing_count_is_no_interactions(self):
        address = {"name": "Jane", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([address]), [{**address, "count": 0}])


class Tokenize(unittest.TestCase):
    """``_tokenize`` — lowercased alphanumeric runs, matching how the index tokenized the text."""

    def test_name_and_address_split_on_punctuation(self):
        self.assertEqual(
            _tokenize("Jane Doe jane.doe@example.com"), ["jane", "doe", "jane", "doe", "example", "com"]
        )

    def test_accented_word_stays_whole(self):
        self.assertEqual(_tokenize("Jörg Müller"), ["jörg", "müller"])

    def test_non_latin_script_stays_whole(self):
        self.assertEqual(_tokenize("山田太郎"), ["山田太郎"])

    def test_underscore_separates_words(self):
        self.assertEqual(_tokenize("jane_doe"), ["jane", "doe"])

    def test_blank_has_no_tokens(self):
        self.assertEqual(_tokenize(None), [])
        self.assertEqual(_tokenize("  -- "), [])


class Relevance(unittest.TestCase):
    """``_relevance_key`` — the order suggestions are presented in, most relevant first."""

    def rank(self, query, addresses):
        """Return `addresses` ordered as the suggestion list would present them."""

        tokens = _tokenize(query)
        ordered = sorted(addresses, key=lambda hit: _relevance_key(tokens, hit))
        return [address["email"] for address in ordered]

    def test_whole_word_beats_longer_word_starting_with_it(self):
        # The reported case: "Doe" is what was typed, "Doeringer" merely starts with it.
        doe = {"name": "John Doe", "email": "john@example.com"}
        doeringer = {"name": "Jane Doeringer", "email": "jane@example.com"}
        self.assertEqual(self.rank("doe", [doeringer, doe]), [doe["email"], doeringer["email"]])

    def test_first_word_beats_later_word(self):
        first = {"name": "Doe Jansen", "email": "dj@example.com"}
        later = {"name": "Ann Doe", "email": "ad@example.com"}
        self.assertEqual(self.rank("doe", [later, first]), [first["email"], later["email"]])

    def test_whole_local_part_beats_name_match(self):
        address = {"name": None, "email": "jane@example.com"}
        named = {"name": "Jane Roe", "email": "jane.roe@example.com"}
        self.assertEqual(self.rank("jane", [named, address]), [address["email"], named["email"]])

    def test_name_match_beats_domain_match(self):
        named = {"name": "Acme Support", "email": "support@example.com"}
        hosted = {"name": "Jane Doe", "email": "jane@acme.test"}
        self.assertEqual(self.rank("acme", [hosted, named]), [named["email"], hosted["email"]])

    def test_adjacent_terms_beat_scattered_ones(self):
        # Addresses run counter to the alphabetical tie-break, so only the ranking can order these.
        adjacent = {"name": "Jane Doe", "email": "c@example.com"}
        interrupted = {"name": "Jane Ann Doe", "email": "b@example.com"}
        reversed_ = {"name": "Doe Jane", "email": "a@example.com"}
        self.assertEqual(
            self.rank("jane doe", [reversed_, interrupted, adjacent]),
            [adjacent["email"], interrupted["email"], reversed_["email"]],
        )

    def test_match_spanning_name_and_address_sorts_last(self):
        # Indexed as one "<name> <email>" blob, so this matches the query without any single
        # field explaining it — it stays a hit, but below every address that does explain one.
        spanning = {"name": "Jane", "email": "doe@example.com"}
        explained = {"name": "Jane Doelan", "email": "jane.doelan@example.com"}
        self.assertEqual(
            self.rank("jane doe", [spanning, explained]), [explained["email"], spanning["email"]]
        )

    def test_most_corresponded_with_wins_between_equal_matches(self):
        # Two addresses for the same person: the one they actually exchange mail with leads.
        active = {"name": "Jane Doe", "email": "jane@example.org", "count": 42}
        stale = {"name": "Jane Doe", "email": "jane@example.com", "count": 1}
        self.assertEqual(self.rank("jane", [stale, active]), [active["email"], stale["email"]])

    def test_correspondence_never_outranks_a_better_match(self):
        # However often they mail Doeringer, "doe" is the whole of the other name's second word.
        exact = {"name": "John Doe", "email": "john@example.com", "count": 1}
        frequent = {"name": "Jane Doeringer", "email": "jane@example.com", "count": 500}
        self.assertEqual(self.rank("doe", [frequent, exact]), [exact["email"], frequent["email"]])

    def test_equally_good_matches_prefer_named_then_shortest(self):
        named = {"name": "Jane Doe", "email": "jane.doe@example.com"}
        short = {"name": None, "email": "jane.aoe@example.com"}
        long_ = {"name": None, "email": "jane.abercrombie@example.com"}
        self.assertEqual(
            self.rank("jane", [long_, short, named]),
            [named["email"], short["email"], long_["email"]],
        )


if __name__ == "__main__":
    unittest.main()
