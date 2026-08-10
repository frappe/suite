# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
"""``SearchStore.index_documents``' upsert contract: every document is merged with the one it
replaces, including when the same ID comes round more than once in a single batch."""

import unittest
from contextlib import nullcontext
from unittest import mock

from suite.store.search_store import SearchStore


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

    def test_sources_without_an_id_never_reach_the_writer(self):
        written = self.index_documents([{"count": 1}, {"id": None, "count": 1}, {"id": "a", "count": 1}])
        self.assertEqual(written, [{"id": "a", "count": 1}])


if __name__ == "__main__":
    unittest.main()
