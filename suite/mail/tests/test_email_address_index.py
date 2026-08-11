# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""The email-address index's normalization, counting and ranking contracts: display names lose the
quotes clients wrap them in, only syntactically valid addresses ever reach the index, every sighting
of an address adds to the count that separates otherwise equal matches, and suggestions come back
ordered by how well the query matches a name or address rather than in index order."""

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
        document = self.to_document({"name": "'Jane Doe'", "email": "Jane@Example.com"})
        self.assertEqual(
            document,
            {
                "id": "jane@example.com",
                "email": "Jane@Example.com",
                "name": "Jane Doe",
                "text": "Jane Doe Jane@Example.com",
                "count": 0,
            },
        )

    def test_missing_name_leaves_email_only_text(self):
        document = self.to_document({"email": "jane@example.com"})
        self.assertIsNone(document["name"])
        self.assertEqual(document["text"], "jane@example.com")

    def test_batch_sightings_are_carried_into_the_count(self):
        document = self.to_document({"email": "jane@example.com", "sightings": 3})
        self.assertEqual(document["count"], 3)


class IndexAddresses(unittest.TestCase):
    """``index_addresses`` — drop invalid entries, dedupe the batch, tally every sighting."""

    def index_addresses(self, addresses, count=True):
        """Return the sources that survive filtering and reach ``index_documents``."""

        index = mock.Mock(spec=EmailAddressIndex)
        EmailAddressIndex.index_addresses(index, addresses, count=count)
        return index.index_documents.call_args[0][0]

    def test_valid_email_is_indexed(self):
        address = {"name": "Jane", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([address]), [{**address, "sightings": 1}])

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
        valid = {"name": "Jane", "email": "jane@example.com"}
        self.assertEqual(
            self.index_addresses([{"email": "not-an-email"}, valid]), [{**valid, "sightings": 1}]
        )

    def test_batch_dedupes_case_insensitively_and_counts_both(self):
        # One upsert, but the address was on two messages: the batch is deduped, the sightings aren't.
        first = {"name": "Jane", "email": "jane@example.com"}
        second = {"name": "Jane Doe", "email": "Jane@Example.com"}
        self.assertEqual(self.index_addresses([first, second]), [{**second, "sightings": 2}])

    def test_a_name_outlives_a_later_nameless_sighting(self):
        # The same address arrives named from one message and bare from the next; last-wins alone
        # would index it with no one behind it.
        named = {"name": "Jane Doe", "email": "jane@example.com"}
        bare = {"email": "jane@example.com"}
        self.assertEqual(self.index_addresses([named, bare]), [{**named, "sightings": 2}])

    def test_a_later_name_still_replaces_an_earlier_one(self):
        old = {"name": "Jane Doe", "email": "jane@example.com"}
        new = {"name": "Jane Roe", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([old, new]), [{**new, "sightings": 2}])

    def test_a_name_that_is_only_quotes_does_not_displace_a_real_one(self):
        # It sanitizes to nothing, so treating it as a name would lose "Jane Doe" for no one.
        named = {"name": "Jane Doe", "email": "jane@example.com"}
        quotes = {"name": "''", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([named, quotes]), [{**named, "sightings": 2}])

    def test_a_name_is_picked_up_from_a_later_sighting(self):
        bare = {"email": "jane@example.com"}
        named = {"name": "Jane Doe", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([bare, named]), [{**named, "sightings": 2}])

    def test_each_address_is_tallied_on_its_own(self):
        jane = {"email": "jane@example.com"}
        john = {"email": "john@example.com"}
        sources = self.index_addresses([jane, john, jane, jane])
        self.assertEqual({s["email"]: s["sightings"] for s in sources}, {jane["email"]: 3, john["email"]: 1})

    def test_uncounted_source_reports_no_sightings(self):
        # A contact sync re-indexes the whole address book; it says nothing about correspondence.
        address = {"name": "Jane", "email": "jane@example.com"}
        self.assertEqual(self.index_addresses([address, address], count=False), [{**address, "sightings": 0}])


class MergeDocument(unittest.TestCase):
    """``merge_document`` — the first sighting establishes an address, every later one counts."""

    def merge(self, document, existing=None):
        # merge_document touches no instance state, so skip SearchStore's on-disk constructor.
        return EmailAddressIndex.merge_document(mock.Mock(spec=EmailAddressIndex), document, existing)

    def document(self, sightings, name="Jane Doe"):
        return {
            "id": "jane@example.com",
            "email": "jane@example.com",
            "name": name,
            "text": " ".join(filter(None, (name, "jane@example.com"))),
            "count": sightings,
        }

    def test_first_sighting_starts_the_count_at_zero(self):
        self.assertEqual(self.merge(self.document(1))["count"], 0)

    def test_first_batch_only_counts_sightings_past_the_first(self):
        self.assertEqual(self.merge(self.document(4))["count"], 3)

    def test_later_sightings_add_to_the_indexed_count(self):
        merged = self.merge(self.document(2), {"count": 5, "name": "Jane Doe"})
        self.assertEqual(merged["count"], 7)

    def test_uncounted_upsert_leaves_the_count_alone(self):
        merged = self.merge(self.document(0), {"count": 5, "name": "Jane Doe"})
        self.assertEqual(merged["count"], 5)

    def test_uncounted_first_sighting_starts_at_zero(self):
        self.assertEqual(self.merge(self.document(0))["count"], 0)

    def test_indexed_name_survives_a_nameless_sighting(self):
        merged = self.merge(self.document(1, name=None), {"count": 0, "name": "Jane Doe"})
        self.assertEqual(merged["name"], "Jane Doe")
        self.assertEqual(merged["text"], "Jane Doe jane@example.com")

    def test_a_named_sighting_replaces_the_indexed_name(self):
        merged = self.merge(self.document(1, name="Jane Roe"), {"count": 0, "name": "Jane Doe"})
        self.assertEqual(merged["name"], "Jane Roe")
        self.assertEqual(merged["text"], "Jane Roe jane@example.com")


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

    def test_equally_good_matches_prefer_the_one_corresponded_with_most(self):
        # The reported case: two addresses for the same person, matched identically by "user".
        org = {"name": "Jane Doe", "email": "user@example.org", "count": 3}
        com = {"name": "Jane Doe", "email": "user@example.com", "count": 42}
        self.assertEqual(self.rank("user", [org, com]), [com["email"], org["email"]])

    def test_correspondence_outranks_the_shortest_address_tie_break(self):
        # Both match "zoe" the same way, and the shorter, alphabetically earlier address is the one
        # with no correspondence behind it — so only the count can order these.
        frequent = {"name": None, "email": "zoe.becker@example.com", "count": 9}
        rare = {"name": None, "email": "zoe.ash@example.com", "count": 0}
        self.assertEqual(self.rank("zoe", [rare, frequent]), [frequent["email"], rare["email"]])

    def test_correspondence_never_beats_a_better_match(self):
        # A much-mailed "Doeringer" still ranks below the "Doe" that was actually typed.
        doe = {"name": "John Doe", "email": "john@example.com", "count": 0}
        doeringer = {"name": "Jane Doeringer", "email": "jane@example.com", "count": 99}
        self.assertEqual(self.rank("doe", [doeringer, doe]), [doe["email"], doeringer["email"]])

    def test_an_uncounted_hit_ranks_as_never_corresponded_with(self):
        counted = {"name": "Jane Doe", "email": "jane.doe@example.com", "count": 1}
        uncounted = {"name": "Jane Doe", "email": "jane.doe@example.org"}
        self.assertEqual(self.rank("jane", [uncounted, counted]), [counted["email"], uncounted["email"]])

    def test_equally_good_matches_prefer_named_then_shortest(self):
        named = {"name": "Jane Doe", "email": "jane.doe@example.com"}
        short = {"name": None, "email": "jane.aoe@example.com"}
        long_ = {"name": None, "email": "jane.abercrombie@example.com"}
        self.assertEqual(
            self.rank("jane", [long_, short, named]),
            [named["email"], short["email"], long_["email"]],
        )


class SearchEmailAddresses(unittest.TestCase):
    """``search_email_addresses`` — ranks the whole match set, so it asks for the whole match set."""

    def test_every_match_is_asked_for_not_a_page_of_them(self):
        # Retrieval is unscored, so a page is an arbitrary slice: the best address sits wherever it
        # was indexed. Ranking a page would let whoever was indexed first win a broad query.
        index = mock.Mock(spec=EmailAddressIndex)
        index.search_prefix.return_value = ([], 0)

        EmailAddressIndex.search_email_addresses(index, "jan", limit=5)

        index.search_prefix.assert_called_once_with(["jan"], limit=None)

    def test_hits_come_back_ranked_and_capped_at_the_limit(self):
        exact = {"name": "Jan Novak", "email": "jan@example.org"}
        longer = {"name": "Janssen One", "email": "janssen1@example.com"}

        index = mock.Mock(spec=EmailAddressIndex)
        index.search_prefix.return_value = ([longer, exact], 2)

        results = EmailAddressIndex.search_email_addresses(index, "jan", limit=1)
        self.assertEqual(results, [{"name": exact["name"], "email": exact["email"]}])

    def test_blank_query_searches_for_nothing(self):
        index = mock.Mock(spec=EmailAddressIndex)

        self.assertEqual(EmailAddressIndex.search_email_addresses(index, "  -- "), [])
        index.search_prefix.assert_not_called()


if __name__ == "__main__":
    unittest.main()
