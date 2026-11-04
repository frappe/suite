import json
import os
from dataclasses import replace

import frappe
import pycrdt
from frappe.utils.background_jobs import create_job_id, get_job

from suite.content import checkpoints, compaction, jobs
from suite.content.http import routes
from suite.writer import content as writer_content
from suite.writer.content.tests.compaction_case import CompactionCase
from suite.writer.content.tests.support import call_route, read_open


class TestWriterCheckpoints(CompactionCase):
    def packet_limit_or_skip(self) -> int:
        [[raw_packet_limit]] = frappe.db.sql("SELECT @@max_allowed_packet")
        packet_limit = int(raw_packet_limit)
        if packet_limit > 64 * 2**20:
            self.skipTest(f"max_allowed_packet is {packet_limit} bytes, over 64 MiB")

        return packet_limit

    def test_the_self_test_fixture_uses_the_part_map_writer_writes(self):
        from suite.content import selftest

        self.assertEqual(selftest.PART_MAP, writer_content.PART_MAP)

    def test_a_compaction_writes_every_row_into_the_writer_row(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        versions = frappe.db.count("Drive Node Version", {"node": node})

        self.compact(node)

        doc = self.doc_row(node)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")
        self.assertEqual(self.checkpoints_of(node), [])
        self.assertEqual((doc.body_rev, doc.tail_rows, doc.tail_bytes), (3, 0, 0))
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.row_count(node), 3)
        self.assertEqual(frappe.db.get_value("Writer Document", {"node": node}, "html"), "")
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), versions)

    def test_a_second_compaction_replaces_the_first_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])

        self.compact(node)

        self.assertEqual(self.doc_row(node).body_rev, 3)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")

    def test_a_compaction_keeps_the_highest_schema_its_rows_reached(self):
        node = self.new_document()
        self.type_into(node, ["one", " two"])
        # As if a newer editor wrote rev 2
        self.set_doc(node, schema_steps=json.dumps([[0, 1], [2, 2]]))

        self.compact(node)

        self.assertEqual(self.text_of(self.body_of(node)), "one two")
        self.assertEqual(json.loads(self.doc_row(node).schema_steps), [[0, 1], [2, 2]])
        opened = read_open(call_route(routes.document_get, node).get_data()).header
        self.assertEqual(opened["schema"], 2)

    def test_the_writer_row_is_modified_as_of_the_newest_edit_it_holds(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        set_edited = "UPDATE `__writer_content_update` SET `created` = %s WHERE `doc_id` = %s"
        frappe.db.sql(set_edited, ("2999-01-02 03:04:05", self.doc_row(node).id))
        frappe.db.commit()

        self.compact(node)

        modified = frappe.db.get_value("Writer Document", {"node": node}, "modified")
        self.assertEqual(str(modified), "2999-01-02 03:04:05")

        self.type_into(node, [" two"])
        frappe.db.sql(set_edited + " AND `rev` = 2", ("2000-01-01", self.doc_row(node).id))
        frappe.db.commit()
        self.compact(node)
        modified_after = frappe.db.get_value("Writer Document", {"node": node}, "modified")
        self.assertEqual(str(modified_after), str(modified))

    def test_an_older_compaction_never_replaces_a_newer_body(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        doc_id = self.doc_row(node).id
        older_snapshot = routes.content.read("writer", doc_id)
        self.type_into(node, ["three"])
        self.compact(node)
        modified = frappe.db.get_value("Writer Document", {"node": node}, "modified")

        rows = older_snapshot.payloads()
        compacted = compaction.compact(older_snapshot.checkpoint, rows, writer_content.PART_MAP)
        self.compaction_job(doc_id).install(older_snapshot, compacted)

        self.assertEqual(self.doc_row(node).body_rev, 3)
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")
        self.assertEqual(frappe.db.get_value("Writer Document", {"node": node}, "modified"), modified)

    def test_a_compaction_of_another_lineage_changes_nothing(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        doc_id = self.doc_row(node).id
        snapshot = routes.content.read("writer", doc_id)
        rows = snapshot.payloads()
        compacted = compaction.compact(None, rows, writer_content.PART_MAP)
        other_lineage = replace(snapshot, lineage="0" * 32)

        self.compaction_job(doc_id).install(other_lineage, compacted)

        doc = self.doc_row(node)
        self.assertEqual((doc.body_rev, self.body_of(node)), (0, b"\x00\x00"))
        self.assertEqual((doc.compaction_failures, doc.next_compaction_at), (0, None))
        self.assertEqual(self.opened(node).text, "one two")

    def test_a_fallback_larger_than_half_the_packet_limit_is_stored(self):
        packet_limit = self.packet_limit_or_skip()
        node = self.new_document()
        self.type_into(node, ["one"])
        state = os.urandom(packet_limit // 2 + 2**20)
        compacted = compaction.Compacted(state=state, integrated=False, report={})
        doc_id = self.doc_row(node).id
        snapshot = routes.content.read("writer", doc_id)

        self.compaction_job(doc_id).keep_fallback(snapshot, compacted)

        self.assertEqual(self.checkpoints_of(node), [(1, state, 0)])

    def test_a_start_state_larger_than_half_the_packet_limit_is_stored(self):
        packet_limit = self.packet_limit_or_skip()
        node = self.new_document()
        start_doc = pycrdt.Doc()
        blob_bytes = os.urandom(packet_limit // 2 + 2**20)
        start_doc["blob"] = pycrdt.Map({"bytes": blob_bytes})
        state = start_doc.get_update()

        checkpoints.replace_start("writer", self.doc_row(node).id, state, 1)

        self.assertEqual((self.body_of(node), self.checkpoints_of(node)), (state, []))

    def test_a_state_too_large_to_store_whole_is_refused(self):
        packet_limit = self.packet_limit_or_skip()
        node = self.new_document()
        self.type_into(node, ["one"])
        [[sql_mode]] = frappe.db.sql("SELECT @@SESSION.sql_mode")
        frappe.db.sql("SET SESSION sql_mode = ''")
        self.addCleanup(frappe.db.sql, "SET SESSION sql_mode = %s", sql_mode)
        state = os.urandom(packet_limit + 2**20)
        compacted = compaction.Compacted(state=state, integrated=False, report={})
        doc_id = self.doc_row(node).id
        snapshot = routes.content.read("writer", doc_id)

        with self.assertRaises(compaction.CompactionFailed) as failed:
            self.compaction_job(doc_id).keep_fallback(snapshot, compacted)

        frappe.db.rollback()

        self.assertEqual(failed.exception.reason, "too_large")
        self.assertEqual(self.checkpoints_of(node), [])

    def test_a_fallback_is_replaced_by_an_integrated_result(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two"])
        snapshot, fallback = self.compacted(node, integrated=False)
        self.compaction_job(self.doc_row(node).id).keep_fallback(snapshot, fallback)
        stored = [(rev, integrated) for rev, _state, integrated in self.checkpoints_of(node)]
        self.assertEqual(stored, [(2, 0)])
        self.set_doc(node, next_compaction_at=None)
        self.type_into(node, [" three"])

        self.compact(node)

        self.assertEqual((self.doc_row(node).body_rev, self.checkpoints_of(node)), (3, []))
        self.assertEqual(self.text_of(self.body_of(node)), "one two three")

    def test_a_due_document_queues_its_compaction_without_a_live_job(self):
        node = self.new_document()
        filler = os.urandom(300 * 1024).hex()
        self.type_into(node, [filler[: len(filler) // 2], filler[len(filler) // 2 :]])

        self.opened(node)

        doc_id = self.doc_row(node).id
        job_id = create_job_id(f"suite-collab-compact-{writer_content.APP}-{doc_id}")
        self.assertIn((jobs.COMPACT, doc_id), self.requested)
        self.assertIsNone(get_job(job_id))
