import gzip

import frappe

from suite.content import compaction
from suite.content.http import routes
from suite.writer.content.tests.compaction_case import CompactionCase


class TestWriterOpening(CompactionCase):
    def test_opening_a_long_edited_document_reads_its_body_plus_the_tail(self):
        node = self.new_document()
        self.type_into(node, [f"{number} " for number in range(2000)])
        self.compact(node)
        self.type_into(node, ["and ", "more"])

        opened = self.opened(node)

        self.assertEqual((opened.header["base"], opened.revs), (2000, [2001, 2002]))
        self.assertEqual(opened.text, "".join(f"{number} " for number in range(2000)) + "and more")

    def test_opening_starts_from_a_fallback_only_while_it_is_newer_than_the_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.compact(node)
        self.type_into(node, [" three"])
        doc_id = self.doc_row(node).id
        snapshot = routes.content.read("writer", doc_id)
        body = self.body_of(node)
        payloads = snapshot.payloads()
        state = compaction.pycrdt.merge_updates(body, *payloads)
        fallback = compaction.Compacted(state, integrated=False)
        self.compaction_job(doc_id).keep_fallback(snapshot, fallback)

        opened = self.opened(node)
        self.assertEqual((opened.header["base"], opened.revs, opened.text), (3, [], "one two three"))

        frappe.db.sql(
            "UPDATE `__writer_content_checkpoint` SET `through_rev` = 1 WHERE `doc_id` = %s",
            doc_id,
        )
        frappe.db.commit()

        opened = self.opened(node)
        self.assertEqual((opened.header["base"], opened.revs, opened.text), (2, [3], "one two three"))

    def test_a_fallback_that_fails_its_sha_is_passed_over_for_the_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        self.compact(node)
        self.type_into(node, [" three"])
        doc_id = self.doc_row(node).id
        snapshot = routes.content.read("writer", doc_id)
        body = self.body_of(node)
        payloads = snapshot.payloads()
        state = compaction.pycrdt.merge_updates(body, *payloads)
        fallback = compaction.Compacted(state, integrated=False)
        self.compaction_job(doc_id).keep_fallback(snapshot, fallback)
        older_body_gz = gzip.compress(body).hex()
        frappe.db.sql(
            "UPDATE `__writer_content_checkpoint` SET `gz` = UNHEX(%s) WHERE `doc_id` = %s",
            (older_body_gz, doc_id),
        )
        frappe.db.commit()

        opened = self.opened(node)

        self.assertEqual((opened.header["base"], opened.revs, opened.text), (2, [3], "one two three"))

    def test_the_body_move_marks_a_checked_checkpoint_that_fails_its_sha_unchecked(self):
        from suite.writer.patches import move_bodies_into_rows

        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc = self.doc_row(node)
        frappe.db.sql(
            """INSERT INTO `__writer_content_checkpoint`
            (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `crdt_version`, `report`, `created`)
            VALUES (%s, 2, UNHEX(%s), UNHEX(%s), 2, UNHEX(%s), 1, %s, '{}', NOW(6))""",
            (
                doc.id,
                bytes(doc.head_chain).hex(),
                (b"\x01" * 32).hex(),
                gzip.compress(b"\x00\x00").hex(),
                compaction.CRDT_VERSION,
            ),
        )
        frappe.db.commit()

        self.assertEqual(move_bodies_into_rows.move_body(doc.id), "bad_checkpoint")

        self.assertEqual(self.checkpoints_of(node), [(2, b"\x00\x00", 0)])
        self.assertEqual(self.doc_row(node).body_rev, 0)
        opened = self.opened(node)
        self.assertEqual((opened.header["base"], opened.revs, opened.text), (0, [1, 2], "one two"))
