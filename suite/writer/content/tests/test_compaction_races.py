import json
import threading
import time
import uuid
from unittest.mock import patch

import frappe
import pycrdt

from suite.content import compaction, jobs, log
from suite.content.http import routes
from suite.content.snapshot import isolation_level
from suite.writer import content as writer_content
from suite.writer import drive as writer_drive
from suite.writer.content.tests.compaction_case import CompactionCase
from suite.writer.content.tests.support import WRITER, answer, body_for, call_route, read_open


class TestCompactionRaces(CompactionCase):
    def test_a_push_while_the_body_is_written_answers_busy_and_lands_after(self):
        node = self.new_document()
        self.type_into(node, ["one "])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        snapshot, compacted = self.compacted(node)
        sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": sid}).encode()
        session = call_route(routes.sessions_post, node, body=session_body)
        client_id = answer(session)["client_id"]

        opened_bytes = call_route(routes.document_get, node).get_data()
        frame = read_open(opened_bytes)
        doc = pycrdt.Doc(client_id=client_id)
        for payload in [frame.checkpoint, *(payload for _rev, payload in frame.rows)]:
            if payload:
                doc.apply_update(payload)

        seen = doc.get_state()
        fragment = doc.get("default", type=pycrdt.XmlFragment)
        fragment.children[0].insert(4, "two")
        update = doc.get_update(seen)
        body = body_for(node, frame.header["lineage"], sid, client_id, 1, update)
        answered: list[int] = []

        def push_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            frappe.set_user(WRITER)
            try:
                response = call_route(routes.updates_post, node, body=body)
                answered.append(response.status_code)
            finally:
                frappe.destroy()

        real_sql = frappe.db.sql

        def push_while_writing(query, *args, **kwargs):
            if "UPDATE `tabWriter Document`" in str(query) and not answered:
                thread = threading.Thread(target=push_elsewhere)
                thread.start()
                thread.join()

            return real_sql(query, *args, **kwargs)

        with patch.object(frappe.db, "sql", push_while_writing):
            self.compaction_job(doc_id).install(snapshot, compacted)

        self.assertEqual(answered, [423])
        self.assertEqual(self.text_of(self.body_of(node)), "one ")
        self.assertEqual(call_route(routes.updates_post, node, body=body).status_code, 200)
        self.assertEqual(self.opened(node).text, "one two")

    def test_a_purge_before_the_body_is_written_leaves_the_row_as_it_was(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        snapshot, compacted = self.compacted(node)
        log.mark_purged("writer", node)
        frappe.db.commit()

        with self.assertRaises(compaction.CompactionFailed) as failed:
            self.compaction_job(doc_id).install(snapshot, compacted)

        frappe.db.rollback()

        self.assertEqual(failed.exception.reason, "purged")
        self.assertEqual((self.body_of(node), self.checkpoints_of(node)), (b"\x00\x00", []))

    def test_a_purge_while_the_body_is_written_waits_and_neither_deadlocks(self):
        node = self.new_document()
        self.type_into(node, ["one"])
        doc_id = self.doc_row(node).id
        site = frappe.local.site
        name = frappe.db.get_value("Writer Document", {"node": node})
        snapshot, compacted = self.compacted(node)
        errors: list[Exception] = []
        marking = threading.Event()

        def purge_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            real_sql = frappe.db.sql

            def signalled(query, *args, **kwargs):
                if "SET `mode` = 'purged'" in str(query):
                    marking.set()

                return real_sql(query, *args, **kwargs)

            try:
                with patch.object(frappe.db, "sql", signalled):
                    writer_drive.SPEC.on_purge(name)

                frappe.db.commit()
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        real_sql = frappe.db.sql
        purge = threading.Thread(target=purge_elsewhere)

        def purge_while_writing(query, *args, **kwargs):
            locks_control_row = "FROM `__writer_content_doc`" in str(query) and "FOR UPDATE" in str(query)
            try:
                return real_sql(query, *args, **kwargs)
            except Exception as error:
                errors.append(error)
                raise
            finally:
                if locks_control_row and not purge.ident:
                    purge.start()
                    marking.wait(10)
                    time.sleep(0.5)

        with patch.object(frappe.db, "sql", purge_while_writing):
            self.compaction_job(doc_id).install(snapshot, compacted)

        purge.join()
        frappe.db.rollback()
        self.addCleanup(jobs.delete_purged, writer_content.APP, doc_id)

        self.assertEqual(errors, [])
        self.assertFalse(frappe.db.exists("Writer Document", name))
        self.assertEqual(self.doc_row(node).mode, "purged")

    def test_an_open_during_a_compaction_install_stays_continuous(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two "])
        self.compact(node)
        self.type_into(node, ["three"])
        typed_text = "one two three"
        doc_id = self.doc_row(node).id
        site = frappe.local.site

        def compact_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                jobs.compact(writer_content.APP, doc_id)
            finally:
                frappe.destroy()

        real_sql = frappe.db.sql
        installed: list[bool] = []

        def install_first(query, *args, **kwargs):
            # The install lands after the open read the control row and before it reads the body
            if "FROM `tabWriter Document`" in str(query) and not installed:
                installed.append(True)
                thread = threading.Thread(target=compact_elsewhere)
                thread.start()
                thread.join()

            return real_sql(query, *args, **kwargs)

        # The database default may already be REPEATABLE READ; the open must not rely on it
        frappe.db.sql("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
        self.addCleanup(frappe.db.sql, "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        frappe.db.commit()
        with patch.object(frappe.db, "sql", install_first):
            opened = self.opened(node)

        self.assertEqual(isolation_level(), "READ-COMMITTED")

        self.assertEqual(installed, [True])
        self.assertEqual((opened.header["base"], opened.revs, opened.text), (2, [3], typed_text))
        self.assertEqual(self.doc_row(node).body_rev, 3)
        opened = self.opened(node)
        self.assertEqual((opened.header["base"], opened.revs, opened.text), (3, [], typed_text))
