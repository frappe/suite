import frappe
import pycrdt

from suite.content import backfill, checkpoints
from suite.content.http import routes
from suite.content.updates import encoded_string, encoded_uint
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    CollabCase,
    typed_updates,
)


class TestWriterCollabClocks(CollabCase):
    def test_a_push_that_does_not_continue_its_writers_clocks_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        first, second, third = typed_updates(client_id, ["a", "b", "c"])

        # The text node takes clock 0, so "a" is clock 1 and "b" starts at 2
        self.assertEqual(
            self.push(node, sid, client_id, 1, second), (409, {"collab": "clock_gap", "clock": 0})
        )
        status, _ = self.push(node, sid, client_id, 1, first)
        self.assertEqual(status, 200)
        self.assertEqual(
            self.push(node, sid, client_id, 2, third), (409, {"collab": "clock_gap", "clock": 2})
        )
        self.assertEqual(
            self.push(node, sid, client_id, 2, first), (409, {"collab": "clock_gap", "clock": 2})
        )

        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, first)])
        statuses: list[int] = []
        for seq, each in ((2, second), (3, third)):
            status, _ = self.push(node, sid, client_id, seq, each)
            statuses.append(status)

        self.assertEqual(statuses, [200, 200])

    def test_a_push_that_needs_another_writers_unsent_typing_waits_for_it(self):
        self.set_mode("on")
        node = self.new_document()
        first_sid, first_client_id = self.start_session(node)
        second_sid, second_client_id = self.start_session(node)
        [abc] = typed_updates(first_client_id, ["abc"])
        tab = pycrdt.Doc(client_id=second_client_id)
        tab.apply_update(abc)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        text.insert(3, "x")
        after_c = tab.get_update(before)

        # "x" sits after "c", the first writer's clock 3
        self.assertEqual(
            self.push(node, second_sid, second_client_id, 1, after_c),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 3}),
        )
        _, rows = self.open_document(node)
        self.assertEqual(rows, [])
        status, _ = self.push(node, first_sid, first_client_id, 1, abc)
        self.assertEqual(status, 200)
        status, _ = self.push(node, second_sid, second_client_id, 1, after_c)
        self.assertEqual(status, 200)
        _, rows = self.open_document(node)
        self.assertEqual(rows, [(1, abc), (2, after_c)])

    def test_a_push_whose_text_follows_itself_or_later_text_is_refused_and_stores_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        def after(clock: int, text: str) -> bytes:
            return bytes([0x84]) + encoded_uint(client_id) + encoded_uint(clock) + encoded_string(text)

        in_root = bytes([4, 1]) + encoded_string("default") + encoded_string("b")
        rows = {
            # "a" at clock 0 placed after clock 0, itself
            "itself": bytes([1, 1]) + encoded_uint(client_id) + bytes([0]) + after(0, "a") + bytes([0]),
            # "a" at clock 0 placed after "b" at clock 1, later in the same row
            "later text": bytes([1, 2])
            + encoded_uint(client_id)
            + bytes([0])
            + after(1, "a")
            + in_root
            + bytes([0]),
        }
        for (case, payload), clock in zip(rows.items(), (0, 1), strict=True):
            with self.subTest(case):
                stuck = pycrdt.Doc()
                stuck.apply_update(payload)
                self.assertEqual(stuck.get_state(), pycrdt.Doc().get_state())
                self.assertEqual(
                    self.push(node, sid, client_id, 1, payload),
                    (409, {"collab": "missing_dep", "client": client_id, "clock": clock}),
                )

        _, stored_rows = self.open_document(node)
        self.assertEqual(stored_rows, [])
        status, _ = self.push(node, sid, client_id, 1)
        self.assertEqual(status, 200)

    def test_a_delete_may_reach_the_last_committed_clock_and_no_further(self):
        self.set_mode("on")
        node = self.new_document()
        sessions = [self.start_session(node) for _ in range(3)]
        (first_sid, first_client_id), (seen_sid, seen_client_id), (ahead_sid, ahead_client_id) = sessions
        abc, appended = typed_updates(first_client_id, ["abc", "d"])
        status, _ = self.push(node, first_sid, first_client_id, 1, abc)
        self.assertEqual(status, 200)

        def deleting(client_id, rows, start, end):
            tab = pycrdt.Doc(client_id=client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            del text[start:end]

            return tab.get_update(before)

        # Committed clocks end at 3 ("c"); "d" is clock 4
        last = deleting(seen_client_id, [abc], 2, 3)
        past = deleting(ahead_client_id, [abc, appended], 3, 4)

        status, _ = self.push(node, seen_sid, seen_client_id, 1, last)
        self.assertEqual(status, 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, past),
            (409, {"collab": "missing_dep", "client": first_client_id, "clock": 4}),
        )
        status, _ = self.push(node, first_sid, first_client_id, 2, appended)
        self.assertEqual(status, 200)
        status, _ = self.push(node, ahead_sid, ahead_client_id, 1, past)
        self.assertEqual(status, 200)

    def test_a_copy_is_edited_where_its_start_was_written_and_nowhere_past_it(self):
        self.set_mode("on")
        node = self.new_document()
        original, later = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.APP, node).id
        checkpoints.replace_start(writer_content.APP, doc_id, original, 1)
        frappe.db.commit()
        sid, client_id = self.start_session(node)
        ahead_sid, ahead_client_id = self.start_session(node)

        def appending(tab_client_id, rows):
            tab = pycrdt.Doc(client_id=tab_client_id)
            for row in rows:
                tab.apply_update(row)

            before = tab.get_state()
            text = tab.get("default", type=pycrdt.XmlFragment).children[0]
            text.insert(len(str(text)), "?")

            return tab.get_update(before)

        # "start" is clocks 1 to 5 of the writer the copy began from; "!" is clock 6
        appended_to_start = appending(client_id, [original])
        appended_past_start = appending(ahead_client_id, [original, later])
        status, _ = self.push(node, sid, client_id, 1, appended_to_start)
        self.assertEqual(status, 200)
        self.assertEqual(
            self.push(node, ahead_sid, ahead_client_id, 1, appended_past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )

    def test_logs_made_before_clocks_were_kept_read_them_from_their_rows(self):
        self.set_mode("on")
        node = self.new_document()
        start, after_start = typed_updates(7, ["start", "!"])
        doc_id = routes.content.find(writer_content.APP, node).id
        checkpoints.replace_start(writer_content.APP, doc_id, start, 1)
        frappe.db.commit()
        sid, client_id = self.start_session(node)
        first, second, third = typed_updates(client_id, ["a", "b", "c"])
        statuses: list[int] = []
        for seq, each in ((1, first), (2, second)):
            status, _ = self.push(node, sid, client_id, seq, each)
            statuses.append(status)

        self.assertEqual(statuses, [200, 200])
        frappe.db.sql("UPDATE `__writer_content_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        backfill.backfill_clocks(writer_content.APP)

        self.assertEqual(
            self.push(node, sid, client_id, 3, first), (409, {"collab": "clock_gap", "clock": 3})
        )
        status, _ = self.push(node, sid, client_id, 3, third)
        self.assertEqual(status, 200)
        other_sid, other_client_id = self.start_session(node)
        tab = pycrdt.Doc(client_id=other_client_id)
        tab.apply_update(start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        within_start = tab.get_update(before)
        status, _ = self.push(node, other_sid, other_client_id, 1, within_start)
        self.assertEqual(status, 200)

        tab.apply_update(after_start)
        before = tab.get_state()
        text = tab.get("default", type=pycrdt.XmlFragment).children[0]
        del text[4:5]
        past_start = tab.get_update(before)
        self.assertEqual(
            self.push(node, other_sid, other_client_id, 2, past_start),
            (409, {"collab": "missing_dep", "client": 7, "clock": 6}),
        )
