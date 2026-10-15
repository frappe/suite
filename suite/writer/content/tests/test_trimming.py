import base64
import gzip
import hashlib
import json
from unittest.mock import patch

import frappe

from suite import drive
from suite.composition import content as routes
from suite.drive._core.principals import Principals
from suite.drive._core.versions import read_version
from suite.suite_core.content import compaction, kernel, trimming
from suite.writer import content as writer_content
from suite.writer.content.tests.support import WRITER, CheckpointCase, call_route, read_frame, read_open


class TestWriterTrimming(CheckpointCase):
    def setUp(self):
        super().setUp()
        in_a_job = patch.object(frappe.local, "job", frappe._dict(job_name="test_trimming"), create=True)
        in_a_job.start()
        self.addCleanup(in_a_job.stop)

    def pull(self, node: str, since: int) -> tuple[str, list[int]]:
        pulled = call_route(lambda node: routes.updates_get(node, since=str(since)), node).get_data()
        header, rows = read_frame(pulled)
        return header["state"], [rev for rev, _payload in rows]

    def trim(self, node: str):
        trimming.trim(
            writer_content.ADAPTER, self.doc_row(node).id, writer_content.ROOTS, writer_content.KERNEL
        )

    def rows_of(self, node: str) -> list[tuple[int, bytes]]:
        stored = frappe.db.sql(
            "SELECT `rev`, `payload` FROM `__writer_content_update` WHERE `doc_id` = %s ORDER BY `rev`",
            self.doc_row(node).id,
        )
        return [(int(rev), bytes(payload)) for rev, payload in stored]

    def revs_of(self, node: str) -> list[int]:
        return [rev for rev, _payload in self.rows_of(node)]

    def age_rows(self, node: str, hours: int = 25):
        frappe.db.sql(
            """UPDATE `__writer_content_update` SET `created` = `created` - INTERVAL %s HOUR
            WHERE `doc_id` = %s""",
            (hours, self.doc_row(node).id),
        )
        frappe.db.commit()

    def opened_text(self, node: str) -> str:
        _header, checkpoint, rows = read_open(call_route(routes.document_get, node).get_data())
        parts = [part for part in [checkpoint, *(payload for _rev, payload in rows)] if part]
        return self.text_of(compaction.load_doc(parts).get_update())

    def compacted_document(self, words: list[str]) -> str:
        node = self.new_document()
        self.type_into(node, words)
        self.compact(node)
        self.assertEqual(self.doc_row(node).body_rev, len(words))
        return node

    def alerted(self, reason: str) -> dict:
        logged = {"method": f"Collab trimming: {reason}"}
        self.addCleanup(frappe.db.delete, "Error Log", logged)
        return logged

    def test_rows_the_body_holds_go_once_a_day_old_and_the_body_rev_row_stays(self):
        node = self.compacted_document(["one ", "two ", "three ", "four"])
        self.age_rows(node)

        self.trim(node)

        self.assertEqual((self.revs_of(node), self.doc_row(node).trimmed_rev), ([4], 3))
        self.assertEqual(self.opened_text(node), "one two three four")
        self.assertEqual(self.pull(node, 0), ("rebuild", []))
        self.type_into(node, [" five"])
        self.assertEqual(self.opened_text(node), "one two three four five")

    def test_rows_under_a_day_old_stay(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node, hours=23)

        self.trim(node)

        self.assertEqual((self.revs_of(node), self.doc_row(node).trimmed_rev), ([1, 2, 3], 0))

    def test_rows_past_the_newest_window_bytes_go_however_new(self):
        node = self.compacted_document(["one ", "two ", "three ", "four ", "five"])
        newest_two = sum(len(payload) for _rev, payload in self.rows_of(node)[-2:])
        self.set_doc(node, state_bytes=0)

        with patch.object(trimming, "WINDOW_BYTES", newest_two):
            self.trim(node)

        self.assertEqual(self.revs_of(node), [4, 5])

    def test_twice_the_state_widens_the_byte_window(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.set_doc(node, state_bytes=sum(len(payload) for _rev, payload in self.rows_of(node)))

        with patch.object(trimming, "WINDOW_BYTES", 1):
            self.trim(node)

        self.assertEqual(self.revs_of(node), [1, 2, 3])

    def test_rows_after_the_body_stay(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.type_into(node, [" four", " five"])
        self.age_rows(node)

        self.trim(node)

        self.assertEqual(self.revs_of(node), [3, 4, 5])
        self.assertEqual(self.opened_text(node), "one two three four five")

    def test_quarantined_rows_stay(self):
        node = self.compacted_document(["one ", "two ", "three"])
        frappe.db.sql(
            """UPDATE `__writer_content_update` SET `state` = 'quarantined', `payload` = ''
            WHERE `doc_id` = %s AND `rev` = 2""",
            self.doc_row(node).id,
        )
        self.age_rows(node)

        self.trim(node)

        self.assertEqual(self.revs_of(node), [2, 3])

    def test_a_document_trims_in_chunks(self):
        node = self.compacted_document(["a", "b", "c", "d", "e", "f"])
        self.age_rows(node)

        with patch.object(trimming, "CHUNK_ROWS", 2), patch.object(trimming, "check") as check:
            self.trim(node)

        self.assertEqual([call.args[0].through for call in check.call_args_list], [2, 4, 5])
        self.assertEqual((self.revs_of(node), self.doc_row(node).trimmed_rev), ([6], 5))

    def test_a_body_that_moves_on_between_chunks_stops_the_trimming(self):
        node = self.compacted_document(["a", "b", "c", "d", "e", "f"])
        self.age_rows(node)
        deleted = trimming.delete

        def compacted_meanwhile(*args):
            done = deleted(*args)
            self.set_doc(node, body_rev=7)
            return done

        with (
            patch.object(trimming, "CHUNK_ROWS", 2),
            patch.object(trimming, "delete", side_effect=compacted_meanwhile),
        ):
            self.trim(node)

        self.assertEqual((self.revs_of(node), self.doc_row(node).trimmed_rev), ([3, 4, 5, 6], 2))

    def test_a_body_that_does_not_hold_the_rows_keeps_every_row_and_alerts(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)
        logged = self.alerted("not_held")

        with patch.object(compaction, "same_content", return_value=False):
            self.trim(node)

        self.assertEqual((self.revs_of(node), self.doc_row(node).trimmed_rev), ([1, 2, 3], 0))
        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def shorten_body(self, node: str):
        (_rev, first_row), *_later = self.rows_of(node)
        short_body = compaction.load_doc([first_row]).get_update()
        frappe.db.set_value(
            "Writer Document", {"node": node}, "content", base64.b64encode(short_body).decode()
        )
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `body_sha` = UNHEX(%s) WHERE `node` = %s",
            (hashlib.sha256(short_body).hexdigest(), node),
        )
        frappe.db.commit()

    def test_a_body_missing_a_row_keeps_every_row(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)
        self.shorten_body(node)
        logged = self.alerted("not_held")

        self.trim(node)

        self.assertEqual(self.revs_of(node), [1, 2, 3])
        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def test_a_fallback_past_the_body_is_never_the_base(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.type_into(node, [" four"])
        full = compaction.load_doc([payload for _rev, payload in self.rows_of(node)]).get_update()
        doc = self.doc_row(node)
        frappe.db.sql(
            """INSERT INTO `__writer_content_checkpoint`
            (`doc_id`, `through_rev`, `chain`, `sha256`, `nbytes`, `gz`, `integrated`, `kernel_schema`, `report`, `created`)
            VALUES (%s, 4, UNHEX(%s), UNHEX(%s), %s, UNHEX(%s), 0, %s, '{}', NOW(6))""",
            (
                doc.id,
                bytes(doc.head_chain).hex(),
                hashlib.sha256(full).hexdigest(),
                len(full),
                gzip.compress(full).hex(),
                compaction.KERNEL,
            ),
        )
        self.age_rows(node)
        self.shorten_body(node)
        logged = self.alerted("not_held")

        self.trim(node)

        self.assertEqual(self.revs_of(node), [1, 2, 3, 4])
        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def test_suspect_and_purged_documents_keep_every_row(self):
        for values in ({"suspect": "client"}, {"mode": "purged"}):
            with self.subTest(**values):
                node = self.compacted_document(["one ", "two ", "three"])
                self.age_rows(node)
                self.set_doc(node, **values)

                self.trim(node)

                self.assertEqual(self.revs_of(node), [1, 2, 3])

    def test_a_body_that_fails_its_stamp_keeps_every_row(self):
        for reason, values in (("body_sha", {"body_sha": b"x" * 32}), ("chain", {"body_chain": b"x" * 32})):
            with self.subTest(reason=reason):
                node = self.compacted_document(["one ", "two ", "three"])
                self.age_rows(node)
                self.set_doc(node, **values)
                logged = self.alerted(reason)

                self.trim(node)

                self.assertEqual(self.revs_of(node), [1, 2, 3])
                self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def assert_kept_when_the_kernel_answers(self, answer, reason: str):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)
        logged = self.alerted(reason)

        with patch.object(kernel, "covers", side_effect=[answer]):
            self.trim(node)

        self.assertEqual(self.revs_of(node), [1, 2, 3])
        self.assertEqual(frappe.db.count("Error Log", logged), 1)

    def test_a_kernel_that_disagrees_keeps_every_row(self):
        self.assert_kept_when_the_kernel_answers(False, "kernel_not_held")

    def test_a_kernel_that_fails_keeps_every_row(self):
        self.assert_kept_when_the_kernel_answers(kernel.KernelFailed("exit 1"), "kernel_failed")

    def test_without_node_pycrdt_alone_decides(self):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)

        with patch.object(kernel, "usable_node", return_value=None):
            self.trim(node)

        self.assertEqual(self.revs_of(node), [3])

    def test_with_node_the_kernel_checks_the_rows_that_go(self):
        if not kernel.usable_node() or not writer_content.KERNEL.is_file():
            self.skipTest("needs Node and the built kernel bundle")

        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)
        going = [payload for _rev, payload in self.rows_of(node)[:2]]

        with patch.object(kernel, "covers", wraps=kernel.covers) as covers:
            self.trim(node)

        covers.assert_called_once_with(writer_content.KERNEL, self.body_of(node), going)
        self.assertEqual(self.revs_of(node), [3])

    def assert_nothing_deleted_when_changed_during_the_check(self, **values):
        node = self.compacted_document(["one ", "two ", "three"])
        self.age_rows(node)
        checked = trimming.check

        def changed_meanwhile(*args):
            checked(*args)
            self.set_doc(node, **values)

        with patch.object(trimming, "check", side_effect=changed_meanwhile):
            self.trim(node)

        self.assertEqual(self.revs_of(node), [1, 2, 3])

    def test_a_body_replaced_during_the_check_deletes_nothing(self):
        self.assert_nothing_deleted_when_changed_during_the_check(body_sha=b"x" * 32)

    def test_a_document_marked_suspect_during_the_check_deletes_nothing(self):
        self.assert_nothing_deleted_when_changed_during_the_check(suspect="client")

    def test_a_trim_point_moved_during_the_check_deletes_nothing(self):
        self.assert_nothing_deleted_when_changed_during_the_check(trimmed_rev=1)

    def test_every_version_still_restores_after_trimming(self):
        node = self.new_document()
        self.type_into(node, ["one "])
        self.compact(node)
        first = drive.take_version(node, kind="named", label="one")
        self.type_into(node, ["two ", "three"])
        self.compact(node)
        second = drive.take_version(node, kind="named", label="two")
        frappe.db.commit()
        self.age_rows(node)

        self.trim(node)

        self.assertEqual(self.revs_of(node), [3])
        principals = Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",))
        texts: list[str] = []
        for seq in (first, second):
            with read_version(principals, node, seq) as stream:
                payload = json.loads(stream.read())

            texts.append(self.text_of(gzip.decompress(base64.b64decode(payload["state"]))))

        self.assertEqual(texts, ["one ", "one two three"])

    def test_a_killed_run_resumes_after_the_last_document_it_finished(self):
        cursor = trimming.cursor_key(writer_content.ADAPTER)
        frappe.cache.delete_value(cursor)
        self.addCleanup(frappe.cache.delete_value, cursor)
        first, second = sorted(self.doc_row(self.compacted_document(["one ", "two"])).id for _ in range(2))

        def killed_at_second(adapter, doc_id, *args):
            if doc_id == second:
                raise SystemExit

            return True

        with patch.object(trimming, "trim", side_effect=killed_at_second), self.assertRaises(SystemExit):
            trimming.run(writer_content.ADAPTER, writer_content.ROOTS, writer_content.KERNEL)

        self.assertTrue(first <= frappe.cache.get_value(cursor) < second)

        with patch.object(trimming, "trim") as trim:
            trimming.run(writer_content.ADAPTER, writer_content.ROOTS, writer_content.KERNEL)

        resumed = [call.args[1] for call in trim.call_args_list]
        self.assertEqual(resumed[0], second)
        self.assertNotIn(first, resumed)
        self.assertIsNone(frappe.cache.get_value(cursor))

    def test_a_document_stops_after_the_chunk_that_runs_past_the_deadline(self):
        node = self.compacted_document(["a", "b", "c", "d", "e", "f"])
        self.age_rows(node)

        with patch.object(trimming, "CHUNK_ROWS", 2):
            finished = trimming.trim(
                writer_content.ADAPTER, self.doc_row(node).id, writer_content.ROOTS, writer_content.KERNEL, 0
            )

        self.assertEqual(
            (finished, self.revs_of(node), self.doc_row(node).trimmed_rev), (False, [3, 4, 5, 6], 2)
        )

    def test_a_run_out_of_time_inside_a_document_resumes_at_that_document(self):
        cursor = trimming.cursor_key(writer_content.ADAPTER)
        frappe.cache.delete_value(cursor)
        self.addCleanup(frappe.cache.delete_value, cursor)
        first, second = sorted(self.doc_row(self.compacted_document(["one ", "two"])).id for _ in range(2))

        with patch.object(trimming, "trim", side_effect=lambda adapter, doc_id, *args: doc_id != second):
            trimming.run(writer_content.ADAPTER, writer_content.ROOTS, writer_content.KERNEL)

        self.assertTrue(first <= frappe.cache.get_value(cursor) < second)

    def test_a_tab_behind_the_trimmed_rows_is_told_to_rebuild(self):
        node = self.new_document()
        self.type_into(node, ["one ", "two ", "three"])
        self.set_doc(node, trimmed_rev=2)

        self.assertEqual(self.pull(node, 1), ("rebuild", []))
        self.assertEqual(self.pull(node, 2), ("live", [3]))
