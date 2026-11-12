import threading

import frappe
import pycrdt

from suite import content
from suite.content.http import routes
from suite.content.stage import PIECE_MAX
from suite.content.tables import table
from suite.content.updates import parse
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    CollabCase,
    answer,
    call_route,
    push_body,
    typed_updates,
)


class TestWriterCollabResends(CollabCase):
    def test_a_resent_push_commits_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        first = self.push(node, sid, client_id, 1)
        status, body = self.push(node, sid, client_id, 1)

        self.assertEqual(first[0], 200)
        self.assertEqual((status, body["dup"], body["acked"]), (200, True, 1))
        self.assertEqual((body["rev"], body["chain"]), (first[1]["rev"], first[1]["chain"]))
        self.assertEqual(body["head"], first[1]["head"])
        self.assert_one_order(node, 1)

    def test_a_resend_answers_the_head_another_session_moved(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        other_sid, other_client_id = self.start_session(node)
        first = self.push(node, sid, client_id, 1)
        other = self.push(node, other_sid, other_client_id, 1)
        self.assertEqual((first[0], other[0], first[1]["rev"], other[1]["rev"]), (200, 200, 1, 2))

        status, body = self.push(node, sid, client_id, 1)

        self.assertEqual((status, body["dup"], body["rev"]), (200, True, 1))
        self.assertEqual(body["head"], other[1]["rev"])

    def test_a_resend_answers_while_the_doc_is_locked(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        first = self.push(node, sid, client_id, 1)
        header, _ = self.open_document(node)
        body = push_body(header["lineage"], sid, client_id, 1, 0, self.typed_update(client_id, 1, "1"))
        doc_id = content.find(writer_content.APP, node).id
        doc_table = table(writer_content.APP, "doc")
        site = frappe.local.site
        locked = threading.Event()
        release = threading.Event()
        errors: list[Exception] = []

        def hold_doc_elsewhere():
            frappe.init(site=site)
            frappe.connect()
            try:
                frappe.db.sql(f"SELECT `id` FROM `{doc_table}` WHERE `id` = %s FOR UPDATE", doc_id)
                locked.set()
                release.wait(30)
                frappe.db.rollback()
            except Exception as error:
                errors.append(error)
            finally:
                frappe.destroy()

        [[wait]] = frappe.db.sql("SELECT @@SESSION.innodb_lock_wait_timeout")
        frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 2")
        self.addCleanup(frappe.db.sql, "SET SESSION innodb_lock_wait_timeout = %s", int(wait))
        holder = threading.Thread(target=hold_doc_elsewhere)
        holder.start()
        self.assertTrue(locked.wait(30))
        try:
            resent = call_route(routes.updates_post, node, body=body)
        finally:
            release.set()
            holder.join(30)

        resend = answer(resent)
        self.assertEqual((first[0], errors, holder.is_alive()), (200, [], False))
        self.assertEqual((resent.status_code, resend["dup"], resend["acked"]), (200, True, 1))

    def test_a_resend_grown_by_more_typing_stores_only_the_new_typing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        first, second = typed_updates(client_id, ["first", " second"])
        both = pycrdt.merge_updates(first, second)

        self.push(node, sid, client_id, 1, first)
        status, body = self.push(node, sid, client_id, 1, both, entries=[first, second])
        again = self.push(node, sid, client_id, 1, both, entries=[first, second])

        self.assertEqual((status, "dup" in body, body["rev"], body["acked"]), (200, False, 2, 2))
        self.assertEqual((again[0], again[1]["dup"], again[1]["rev"], again[1]["acked"]), (200, True, 2, 2))
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_resend_grown_by_typing_that_continues_one_struct_stores_the_rest_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        tab = pycrdt.Doc(client_id=client_id)
        text = tab.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
        text.insert(0, "first")
        first = tab.get_update()
        committed = tab.get_state()
        text.insert(5, " second")
        second = tab.get_update(committed)
        both = tab.get_update()
        next_clock = max(struct.clock + struct.length for struct in parse(first).structs)
        self.assertTrue(
            any(struct.clock < next_clock < struct.clock + struct.length for struct in parse(both).structs)
        )

        self.push(node, sid, client_id, 1, first)
        status, body = self.push(node, sid, client_id, 1, both, entries=[first, second])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_resend_grown_by_a_deletion_only_stores_the_deletion(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        tab = pycrdt.Doc(client_id=client_id)
        text = tab.get("default", type=pycrdt.XmlFragment).children.append(pycrdt.XmlText())
        text.insert(0, "first second")
        first = tab.get_update()
        committed = tab.get_state()
        del text[5:12]
        second = tab.get_update(committed)
        both = tab.get_update()

        self.push(node, sid, client_id, 1, first)
        status, body = self.push(node, sid, client_id, 1, both, entries=[first, second])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        _, rows = self.open_document(node)
        _, deletion = rows[1]
        self.assertEqual(parse(deletion).structs, [])
        self.assertEqual(self.stored_text(node), "first")

    def test_a_refused_grown_resend_stores_nothing_and_its_retry_stores_the_rest(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)
        lineage = header["lineage"]

        first, second = typed_updates(client_id, ["first", " second"])
        both = pycrdt.merge_updates(first, second)
        self.push(node, sid, client_id, 1, first)
        ahead = push_body(lineage, sid, client_id, 1, 5, both, entries=[first, second])
        refused = call_route(routes.updates_post, node, body=ahead)

        self.assertEqual((refused.status_code, answer(refused)), (409, {"collab": "diverged"}))
        _, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], [first])

        status, body = self.push(node, sid, client_id, 1, both, entries=[first, second])

        self.assertEqual((status, body["rev"], body["acked"]), (200, 2, 2))
        self.assertEqual(self.stored_text(node), "first second")

    def test_a_staged_resend_grown_by_a_big_paste_stores_the_paste_once(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        header, _ = self.open_document(node)

        paste = "p" * PIECE_MAX
        typed, pasted = typed_updates(client_id, ["first ", paste])
        both = pycrdt.merge_updates(typed, pasted)
        self.assertGreater(len(both), PIECE_MAX)
        self.push(node, sid, client_id, 1, typed)
        stage_id = self.stage(node, sid, both, to=2)
        staged = push_body(
            header["lineage"], sid, client_id, 1, 1, b"", entries=[typed, pasted], stage_id=stage_id
        )
        response = call_route(routes.updates_post, node, body=staged)

        self.assertEqual(
            (response.status_code, answer(response)["rev"], answer(response)["acked"]), (200, 2, 2)
        )
        self.assert_one_order(node, 2)
        self.assertEqual(self.stored_text(node), "first " + paste)
        self.assertEqual(self.staged(node), 0)

    def test_a_resend_grown_by_more_typing_with_different_committed_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        committed = self.typed_update(client_id, 1, "a")
        self.push(node, sid, client_id, 1, committed)
        rewritten, grown = typed_updates(client_id, ["c", "d"])
        status, body = self.push(
            node, sid, client_id, 1, pycrdt.merge_updates(rewritten, grown), entries=[rewritten, grown]
        )

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        _, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], [committed])

    def test_a_resend_with_different_bytes_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        committed = self.typed_update(client_id, 1, "a")
        self.push(node, sid, client_id, 1, committed)
        different = self.typed_update(client_id, 1, "c")
        status, body = self.push(node, sid, client_id, 1, different)

        self.assertEqual((status, body), (409, {"collab": "seq_conflict"}))
        _, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], [committed])
