# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``SearchStore``'s two contracts that outlive a single call: an upsert merges each document with
the one it replaces, even when an ID comes round twice in a batch, and the deprecated
``search_phrase_prefix`` keeps searching for a phrase rather than quietly becoming a looser search."""

import unittest
from contextlib import nullcontext
from unittest import mock

import tantivy

from suite.store.search_store import IndexWriteAborted, SearchStore


class IndexDocuments(unittest.TestCase):
    """``index_documents`` — what actually reaches the index writer."""

    def index_documents(self, sources, indexed=None):
        """Index `sources` against an index already holding `indexed`; return the documents written.

        Everything below the merge is stubbed out — the lock, the on-disk index, the writer — so
        this exercises the ordering of read, merge and write rather than Tantivy.
        """

        store = mock.Mock(spec=SearchStore)
        store.ID_FIELD = "id"
        store.to_document.side_effect = lambda source: source
        store.get_documents.side_effect = lambda ids: {
            doc_id: document for doc_id, document in (indexed or {}).items() if doc_id in ids
        }
        # Stand in for a subclass that accumulates a running count across upserts.
        store.merge_document.side_effect = lambda document, replaced: {
            **document,
            "count": document["count"] + (replaced or {}).get("count", 0),
        }
        store._to_tantivy_document.side_effect = lambda document: document

        writer = store._open.return_value.writer.return_value
        with mock.patch("suite.store.search_store.write_lock", return_value=nullcontext()):
            SearchStore.index_documents(store, sources)

        return [call.args[0] for call in writer.add_document.call_args_list]

    def test_document_is_merged_with_the_one_it_replaces(self):
        written = self.index_documents([{"id": "a", "count": 1}], indexed={"a": {"id": "a", "count": 5}})
        self.assertEqual([document["count"] for document in written], [6])

    def test_first_sighting_has_nothing_to_merge_with(self):
        self.assertEqual(self.index_documents([{"id": "a", "count": 1}]), [{"id": "a", "count": 1}])

    def test_repeated_id_in_one_batch_builds_on_the_previous_write(self):
        # Both entries have to land: merging each against the pre-batch document instead would
        # write 6 twice, and the last write would silently drop the first entry's contribution.
        written = self.index_documents(
            [{"id": "a", "count": 1}, {"id": "a", "count": 1}], indexed={"a": {"id": "a", "count": 5}}
        )
        self.assertEqual([document["count"] for document in written], [6, 7])

    def test_a_source_that_replaces_is_written_as_given(self):
        # A recount states the whole total, so nothing is read to fold into it.
        store = mock.Mock(spec=SearchStore)
        store.ID_FIELD = "id"
        store.to_document.side_effect = lambda source: source
        store._to_tantivy_document.side_effect = lambda document: document
        writer = store._open.return_value.writer.return_value

        with mock.patch("suite.store.search_store.write_lock", return_value=nullcontext()):
            SearchStore.index_documents(store, [{"id": "a", "count": 3}], merge=False)

        store.get_documents.assert_not_called()
        store.merge_document.assert_not_called()
        self.assertEqual(
            [call.args[0] for call in writer.add_document.call_args_list], [{"id": "a", "count": 3}]
        )

    def test_sources_without_an_id_never_reach_the_writer(self):
        written = self.index_documents([{"count": 1}, {"id": None, "count": 1}, {"id": "a", "count": 1}])
        self.assertEqual(written, [{"id": "a", "count": 1}])


class IndexWriteFailures(unittest.TestCase):
    """``index_documents`` — a write that changed nothing says so, so a caller can undo its half."""

    def store(self):
        store = mock.Mock(spec=SearchStore)
        store.ID_FIELD = "id"
        store.ENTITY = "thing"
        store.to_document.side_effect = lambda source: source
        store.get_documents.return_value = {}
        store.merge_document.side_effect = lambda document, replaced: document
        store._to_tantivy_document.side_effect = lambda document: document
        return store

    def index(self, store):
        with mock.patch("suite.store.search_store.write_lock", return_value=nullcontext()):
            return SearchStore.index_documents(store, [{"id": "a"}])

    def test_a_failure_before_the_commit_reports_an_untouched_index(self):
        store = self.store()
        store._open.return_value.writer.return_value.commit.side_effect = OSError("no space left")

        with self.assertRaises(IndexWriteAborted):
            self.index(store)

    def test_a_read_that_fails_reports_an_untouched_index(self):
        store = self.store()
        store.get_documents.side_effect = OSError("index unreadable")

        with self.assertRaises(IndexWriteAborted):
            self.index(store)

    def test_the_lock_going_untaken_reports_an_untouched_index(self):
        with mock.patch("suite.store.search_store.write_lock", side_effect=RuntimeError("held")):
            with self.assertRaises(IndexWriteAborted):
                SearchStore.index_documents(self.store(), [{"id": "a"}])

    def test_a_failure_after_the_commit_is_left_as_it_is(self):
        # The documents are in the index by now, so this must not read as "nothing happened":
        # a caller undoing its half here would let the same work be counted twice on retry.
        store = self.store()
        store._open.return_value.writer.return_value.wait_merging_threads.side_effect = OSError("merge")

        with self.assertRaises(OSError):
            self.index(store)


class SearchPhrasePrefix(unittest.TestCase):
    """``search_phrase_prefix`` — the pre-rename name, still searching for a phrase, still deprecated."""

    def search(self, terms, **kwargs):
        """Return the Tantivy query the deprecated search would run, and the search's result."""

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


if __name__ == "__main__":
    unittest.main()
