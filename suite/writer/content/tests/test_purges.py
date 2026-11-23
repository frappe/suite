import json
import uuid
from unittest.mock import patch

import frappe
import pycrdt
from frappe.utils.logging import connection_for

from suite import content
from suite.content import copies, jobs, log, logged, scheduling
from suite.content.http import routes
from suite.drive._core.nodes import _trash, purge
from suite.drive._core.principals import Principals
from suite.writer import content as writer_content
from suite.writer.content.tests.drive_callback_case import DriveCallbackCase
from suite.writer.content.tests.support import WRITER, answer, call_route, push_body, read_open


class TestWriterPurges(DriveCallbackCase):
    def purge_through_drive(self, node: str) -> str:
        doc_id = self.doc_row(node).id
        owner = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        with patch.object(scheduling, "enqueue") as enqueue:
            _trash(owner, node)
            purge(owner, node)
            frappe.db.commit()

        enqueue.assert_called_once()
        self.assertEqual(enqueue.call_args.kwargs["enqueue_after_commit"], True)
        return doc_id

    def row_counts(self, doc_id: str) -> dict:
        counts: dict[str, int] = {}
        for kind in ("doc", "update", "checkpoint", "session", "stage", "projection", "copy"):
            doc_column = "id" if kind == "doc" else "doc_id"
            [[count]] = frappe.db.sql(
                f"SELECT COUNT(*) FROM `__writer_content_{kind}` WHERE `{doc_column}` = %s",
                doc_id,
            )
            counts[kind] = count

        return counts

    def test_a_purge_marks_the_log_and_its_job_deletes_every_row_in_batches(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        self.compact(node)
        self.type_into(node, [" four"])
        frappe.db.sql(
            """INSERT INTO `__writer_content_stage` (`doc_id`, `stage_id`, `idx`, `purpose`, `sid`, `total_len`,
            `sha_total`, `bytes`, `created`) VALUES (%s, %s, 0, 'save', %s, 1, UNHEX(%s), 'x', NOW())""",
            (self.doc_row(node).id, "a" * 32, "b" * 32, "00" * 32),
        )
        doc = self.doc_row(node)
        copy = "<p>one two three four</p>"
        installed = copies.install(
            writer_content.APP, doc.id, 4, doc.lineage, doc.q_epoch, copy, writer_content.EDITOR.readable_copy
        )
        self.assertEqual(installed, "installed")

        doc_id = self.purge_through_drive(node)

        self.assertEqual(frappe.db.get_value("Drive Node", node, "name"), None, "Drive purged the node")
        [[mode]] = frappe.db.sql("SELECT `mode` FROM `__writer_content_doc` WHERE `id` = %s", doc_id)
        self.assertEqual(mode, "purged")
        with patch.object(log, "PURGE_BATCH", 2):
            jobs.delete_purged(writer_content.APP, doc_id)

        self.assertEqual(set(self.row_counts(doc_id).values()), {0})

    def test_the_sweeper_finishes_a_purge_whose_job_never_ran(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.purge_through_drive(node)

        with patch.object(scheduling, "enqueue") as enqueue:
            jobs.sweep()

        purge_job = (
            ("suite.content.jobs.delete_purged", f"suite-collab-purge-writer-{doc_id}"),
            {"app": "writer", "doc_id": doc_id},
        )
        enqueued = [(queued.args, queued.kwargs) for queued in enqueue.call_args_list]
        self.assertIn(purge_job, enqueued)
        jobs.delete_purged(writer_content.APP, doc_id)
        self.assertEqual(self.row_counts(doc_id)["update"], 0)

    def test_a_compaction_never_stores_a_checkpoint_for_a_purged_log(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()

        jobs.compact(writer_content.APP, doc_id)

        self.assertEqual(self.row_counts(doc_id)["checkpoint"], 0)
        jobs.delete_purged(writer_content.APP, doc_id)

    def test_a_compaction_during_a_purge_raises_no_alert(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        doc_id = self.purge_through_drive(node)
        # The purge job has deleted the first rows and not yet the rest
        frappe.db.sql("DELETE FROM `__writer_content_update` WHERE `doc_id` = %s AND `rev` = 1", doc_id)
        frappe.db.commit()
        alerts = connection_for("Error Log").count("Error Log", {"method": "Collab compaction: chain_break"})

        jobs.compact(writer_content.APP, doc_id)

        self.assertEqual(
            connection_for("Error Log").count("Error Log", {"method": "Collab compaction: chain_break"}),
            alerts,
        )
        jobs.delete_purged(writer_content.APP, doc_id)

    def test_a_purged_log_reads_as_missing_on_every_route(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        sid = uuid.uuid4().hex
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()
        self.addCleanup(jobs.delete_purged, writer_content.APP, doc_id)

        frame = read_open(call_route(routes.document_get, node).get_data())
        self.assertEqual((frame.header["state"], frame.rows), ("unconverted", []))
        for handler, body in (
            (routes.updates_get, b""),
            (routes.sessions_post, json.dumps({"sid": sid}).encode()),
            (routes.updates_post, push_body("x", sid, 1, 1, 0, b"\x00")),
        ):
            self.assertEqual(answer(call_route(handler, node, body=body)), {"collab": "unconverted"})

        self.assertEqual(self.row_counts(doc_id)["update"], 1)
        self.assertEqual(self.row_counts(doc_id)["session"], 1)

    def test_a_push_that_meets_a_purge_is_refused_and_writes_nothing(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = answer(call_route(routes.sessions_post, node, body=session_body))
        client_id = session["client_id"]
        row = self.doc_row(node)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
        frappe.db.commit()
        self.addCleanup(jobs.delete_purged, writer_content.APP, doc_id)
        doc = pycrdt.Doc(client_id=client_id)
        doc.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText("two"))
        body = push_body(row.lineage, sid, client_id, 1, 1, doc.get_update())
        header, payload = content.parse_push(body)

        with self.assertRaises(content.Refusal) as refused:
            content.push(writer_content.APP, doc_id, row.head_rev, header, payload, WRITER)

        self.assertEqual((refused.exception.status, refused.exception.body), (404, {"collab": "not_found"}))
        self.assertEqual(self.row_counts(doc_id)["update"], 1)

    def purging_on_find(self):
        real_find = log.find

        def find_then_purge(app: str, node: str):
            doc = real_find(app, node)
            if doc:
                frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc.id)
                self.addCleanup(jobs.delete_purged, writer_content.APP, doc.id)

            return doc

        return patch.object(log, "find", find_then_purge)

    def test_a_log_purged_between_finding_and_reading_it_reads_as_missing(self):
        def open_state(node: str) -> str:
            header = read_open(call_route(routes.document_get, node).get_data()).header
            return header["state"]

        reads = (
            ("open", open_state, "unconverted"),
            ("live state", lambda node: logged.live_state(writer_content.APP, node), None),
            ("live checkpoint", lambda node: logged.live_checkpoint(writer_content.APP, node), None),
            (
                "remap",
                lambda node: logged.remap_log(writer_content.APP, node, lambda value: value),
                None,
            ),
        )
        for name, read, expected in reads:
            node = self.new_document()
            self.type_into(node, ["one"])
            with self.subTest(read=name), self.purging_on_find():
                self.assertEqual(read(node), expected)
