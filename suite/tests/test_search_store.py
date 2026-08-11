# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``SearchStore``'s search and upsert contracts: an unbounded fetch returns every match, reading
the index once so its own count still describes what it fetched, the deprecated
``search_phrase_prefix`` still searches for a phrase rather than quietly becoming the looser search
that replaced it, and a store that merges on upsert sees the document it is about to replace."""

import unittest
from unittest import mock

import tantivy

from suite.store.search_store import UNBOUNDED_FETCH_PAGE, UPSERT_LOOKUP_CHUNK, SearchStore


class FakeResult:
    """Stands in for Tantivy's search result: a page of hits, and how many there are in total."""

    def __init__(self, hits, count):
        self.hits = hits
        self.count = count


class FakeSearcher:
    """A fixed set of matches, paged out the way Tantivy pages them, recording each limit asked for.

    Like a real searcher it is a snapshot: `matches` is whatever it was made with, so a test can
    change what the index holds without this seeing it.
    """

    def __init__(self, matches):
        self.matches = matches
        self.limits = []

    def search(self, _query, limit, offset=0, count=True, order_by_field=None):
        self.limits.append(limit)
        return FakeResult(self.matches[offset : offset + limit], len(self.matches))

    def doc(self, address):
        return address


class UnboundedFetch(unittest.TestCase):
    """``_run_search(limit=None)`` — every match, from one reading of the index."""

    def search(self, matches, limit=None, offset=0):
        """Run a search over `matches`; returns its hits and the searcher that served them."""

        searcher = FakeSearcher(matches)
        index = mock.Mock()
        index.searcher.return_value = searcher

        store = mock.Mock(spec=SearchStore)
        store.path = "/nonexistent/index"
        store._open.return_value = index
        store._to_hit.side_effect = lambda document, _score: document

        with mock.patch.object(tantivy, "Index") as tantivy_index:
            tantivy_index.exists.return_value = True
            hits, count = SearchStore._run_search(store, lambda _index: "query", limit, offset, None)

        self.assertEqual(count, len(matches))
        return hits, searcher, index

    def test_a_page_that_came_back_short_is_refetched_at_the_full_count(self):
        hits, searcher, _index = self.search([(1.0, n) for n in range(6000)])

        self.assertEqual(searcher.limits, [UNBOUNDED_FETCH_PAGE, 6000])
        self.assertEqual(len(hits), 6000)

    def test_the_refetch_reads_the_searcher_that_reported_the_count(self):
        # The whole point of doing this here rather than by calling search twice: a second reading
        # of the index could have grown, leaving the fetch short of its own count — the truncation
        # an unbounded fetch exists to avoid.
        _hits, _searcher, index = self.search([(1.0, n) for n in range(6000)])

        self.assertEqual(index.searcher.call_count, 1)
        self.assertEqual(index.reload.call_count, 1)

    def test_a_match_set_the_first_page_holds_is_fetched_once(self):
        hits, searcher, _index = self.search([(1.0, n) for n in range(10)])

        self.assertEqual(searcher.limits, [UNBOUNDED_FETCH_PAGE])
        self.assertEqual(len(hits), 10)

    def test_only_what_is_left_past_an_offset_has_to_fit_the_page(self):
        hits, searcher, _index = self.search([(1.0, n) for n in range(6000)], offset=5999)

        self.assertEqual(searcher.limits, [UNBOUNDED_FETCH_PAGE])
        self.assertEqual(len(hits), 1)

    def test_a_bounded_search_is_left_at_the_limit_it_was_given(self):
        hits, searcher, _index = self.search([(1.0, n) for n in range(6000)], limit=20)

        self.assertEqual(searcher.limits, [20])
        self.assertEqual(len(hits), 20)


class SearchPhrasePrefix(unittest.TestCase):
    """``search_phrase_prefix`` — the pre-rename name, still searching for a phrase, still deprecated."""

    def search(self, terms, **kwargs):
        """Return the Tantivy query the deprecated search would run."""

        schema_builder = tantivy.SchemaBuilder()
        schema_builder.add_text_field("text")

        store = mock.Mock(spec=SearchStore)
        store._schema = schema_builder.build()
        store.DEFAULT_SEARCH_FIELDS = ("text",)
        store._build_phrase_prefix_query.side_effect = lambda t, f: SearchStore._build_phrase_prefix_query(
            store, t, f
        )
        store._run_search.side_effect = lambda build_query, *_args: (build_query(None), 0)

        with self.assertWarns(Warning):
            query, _count = SearchStore.search_phrase_prefix(store, terms, **kwargs)

        return query

    def test_terms_are_searched_for_as_a_phrase_not_scattered(self):
        # The contract the name promises, and the reason this isn't a forward to search_prefix:
        # a phrase query matches "Jane Doe" but not "Jane Ann Doe" or "Doe Jane".
        self.assertIn("PhrasePrefixQuery", repr(self.search(["jane", "d"])))

    def test_blank_terms_search_for_nothing(self):
        store = mock.Mock(spec=SearchStore)

        with self.assertWarns(Warning):
            self.assertEqual(SearchStore.search_phrase_prefix(store, ["", None]), ([], 0))

        store._run_search.assert_not_called()


class MergeOnUpsert(unittest.TestCase):
    """``index_documents`` — a merging store reads what it replaces; every other store doesn't."""

    def index(self, sources, merge_on_upsert=True, existing=None):
        """Upsert `sources`; returns the store, the index, and the documents handed to the writer."""

        writer = mock.Mock()
        index = mock.Mock()
        index.writer.return_value = writer

        store = mock.Mock(spec=SearchStore)
        store.ID_FIELD = "id"
        store.MERGE_ON_UPSERT = merge_on_upsert
        store._open.return_value = index
        store.to_document.side_effect = dict
        store._existing_documents.return_value = existing or {}
        store._to_tantivy_document.side_effect = lambda document: document
        store.merge_document.side_effect = lambda document, replaced: {**document, "replaced": replaced}

        with mock.patch("suite.store.search_store.write_lock"):
            SearchStore.index_documents(store, sources)

        return store, index, [call.args[0] for call in writer.add_document.call_args_list]

    def test_the_document_being_replaced_is_handed_to_the_merge(self):
        replaced = {"id": "jane@example.com", "count": 7}
        _store, _index, written = self.index(
            [{"id": "jane@example.com"}], existing={"jane@example.com": replaced}
        )

        self.assertEqual(written, [{"id": "jane@example.com", "replaced": replaced}])

    def test_a_document_the_index_doesnt_hold_merges_against_nothing(self):
        _store, _index, written = self.index([{"id": "jane@example.com"}])

        self.assertEqual(written, [{"id": "jane@example.com", "replaced": None}])

    def test_only_the_ids_being_upserted_are_looked_up(self):
        store, _index, _written = self.index([{"id": "jane@example.com"}, {"id": "john@example.com"}])

        ids = store._existing_documents.call_args.args[1]
        self.assertEqual(ids, ["jane@example.com", "john@example.com"])

    def test_the_lookup_reads_an_index_reloaded_first(self):
        # Another worker may have committed since this index was opened; merging onto a stale view
        # of its documents would drop whatever it carried forward.
        _store, index, _written = self.index([{"id": "jane@example.com"}])

        self.assertEqual(index.reload.call_count, 1)

    def test_a_store_that_doesnt_merge_reads_nothing(self):
        store, index, written = self.index([{"id": "jane@example.com"}], merge_on_upsert=False)

        store._existing_documents.assert_not_called()
        store.merge_document.assert_not_called()
        index.reload.assert_not_called()
        self.assertEqual(written, [{"id": "jane@example.com"}])

    def test_a_batch_holding_one_id_twice_merges_it_onto_itself(self):
        # Both would otherwise merge against the same indexed document and the second would
        # overwrite the first, losing whatever it carried forward.
        _store, _index, written = self.index([{"id": "jane@example.com"}, {"id": "jane@example.com"}])

        self.assertEqual(
            written,
            [{"id": "jane@example.com", "replaced": {"id": "jane@example.com", "replaced": None}}],
        )

    def test_a_source_without_an_id_is_skipped_before_it_is_looked_up(self):
        store, _index, written = self.index([{"id": None}, {"id": "jane@example.com"}])

        self.assertEqual(store._existing_documents.call_args.args[1], ["jane@example.com"])
        self.assertEqual(written, [{"id": "jane@example.com", "replaced": None}])


class ExistingDocuments(unittest.TestCase):
    """``_existing_documents`` — the indexed documents for a batch of IDs, keyed by ID."""

    def lookup(self, ids, hits=(), num_docs=5):
        """Look `ids` up against an index holding `hits`; returns the documents and the searcher."""

        searcher = mock.Mock()
        searcher.num_docs = num_docs
        searcher.search.return_value = FakeResult(list(hits), len(hits))
        searcher.doc.side_effect = lambda address: address

        index = mock.Mock()
        index.searcher.return_value = searcher

        schema_builder = tantivy.SchemaBuilder()
        schema_builder.add_text_field("id", stored=True, tokenizer_name="raw")

        store = mock.Mock(spec=SearchStore)
        store.ID_FIELD = "id"
        store._schema = schema_builder.build()
        store._to_hit.side_effect = lambda document, _score: document

        return SearchStore._existing_documents(store, index, ids), searcher

    def test_documents_come_back_keyed_by_id(self):
        jane = {"id": "jane@example.com", "count": 2}
        found, _searcher = self.lookup(["jane@example.com"], hits=[(1.0, jane)])

        self.assertEqual(found, {"jane@example.com": jane})

    def test_an_id_the_index_doesnt_hold_is_simply_absent(self):
        found, _searcher = self.lookup(["jane@example.com"])

        self.assertEqual(found, {})

    def test_an_empty_index_is_never_searched(self):
        found, searcher = self.lookup(["jane@example.com"], num_docs=0)

        self.assertEqual(found, {})
        searcher.search.assert_not_called()

    def test_a_large_batch_is_looked_up_in_chunks(self):
        # One query per chunk, so upserting thousands of documents doesn't build one boolean query
        # with thousands of clauses in it.
        ids = [f"user{n}@example.com" for n in range(UPSERT_LOOKUP_CHUNK + 1)]
        _found, searcher = self.lookup(ids)

        limits = [call.kwargs["limit"] for call in searcher.search.call_args_list]
        self.assertEqual(limits, [UPSERT_LOOKUP_CHUNK, 1])


if __name__ == "__main__":
    unittest.main()
