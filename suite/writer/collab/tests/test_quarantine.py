import hashlib
import json
import uuid
from unittest import mock
from unittest.mock import patch

import frappe
import pycrdt

from suite.suite_core.content import backfill, quarantine
from suite.suite_core.content.log import chain_next
from suite.suite_core.content.tests.test_compaction import crafted, number
from suite.writer import collab as writer_collab
from suite.writer.collab import routes
from suite.writer.collab.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.collab.tests.test_collab import answer, call, push_body, read_frame, read_open


class Tab:
    """A tab with its own session that types into the document's first text."""

    def __init__(self, case: TestQuarantine, node: str):
        self.case, self.node = case, node
        self.sid = uuid.uuid4().hex
        self.cid = answer(
            call(routes.collab_sessions_post, node, body=json.dumps({"sid": self.sid}).encode())
        )["client_id"]
        self.header, checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        self.doc = pycrdt.Doc(client_id=self.cid)
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                self.doc.apply_update(payload)
        self.seq = 0
        self.sent = []

    @property
    def text(self) -> pycrdt.XmlText:
        fragment = self.doc.get("default", type=pycrdt.XmlFragment)
        return fragment.children[0] if len(fragment.children) else fragment.children.append(pycrdt.XmlText())

    def write(self, edit) -> object:
        """Push what `edit(text)` changes, with only its own deletes, as a browser does; answers the response."""
        updates = []
        subscription = self.doc.observe(lambda event: updates.append(event.update))
        with self.doc.transaction():
            edit(self.text)
        self.doc.unobserve(subscription)
        [update] = updates
        self.seq += 1
        self.sent.append(update)
        body = push_body(self.header["lineage"], self.sid, self.cid, self.seq, 0, update)
        return call(routes.collab_updates_post, self.node, body=body)

    def typed(self, at: int, words: str) -> int:
        """Push `words` typed at `at`; answers the rev."""
        response = self.write(lambda text: text.insert(at, words))
        self.case.assertEqual(response.status_code, 200, response.get_data())
        return answer(response)["rev"]

    def catch_up(self):
        for _rev, payload in routes.content.read(routes.ADAPTER, self.case.doc_row(self.node).id)["rows"]:
            self.doc.apply_update(payload)


class TestQuarantine(CheckpointCase):
    def quarantine(self, node: str, revs: set[int], reason: str = "test") -> list[int]:
        return quarantine.quarantine(
            routes.ADAPTER, self.doc_row(node).id, revs, reason, writer_collab.document_owner
        )

    def stored_text(self, node: str) -> str:
        read = routes.content.read(routes.ADAPTER, self.doc_row(node).id)
        doc = pycrdt.Doc()
        for payload in [read["checkpoint"], *(payload for _rev, payload in read["rows"])]:
            if payload:
                doc.apply_update(payload)
        return "".join(str(child) for child in doc.get("default", type=pycrdt.XmlFragment).children)

    def recovered(self, node: str) -> list[tuple]:
        return [
            (int(rev), owner, reason, bytes(payload))
            for rev, owner, reason, payload in frappe.db.sql(
                """SELECT `context_rev`, `owner`, `reason`, `payload` FROM `__writer_content_recovery`
                WHERE `doc_id` = %s ORDER BY `context_rev`""",
                self.doc_row(node).id,
            )
        ]

    def states(self, node: str) -> list[str]:
        return [
            state
            for (state,) in frappe.db.sql(
                "SELECT `state` FROM `__writer_content_update` WHERE `doc_id` = %s ORDER BY `rev`",
                self.doc_row(node).id,
            )
        ]

    def closed(self, node: str, tab: Tab) -> bool:
        return bool(
            frappe.db.sql(
                "SELECT `closed` FROM `__writer_content_session` WHERE `doc_id` = %s AND `sid` = %s",
                (self.doc_row(node).id, tab.sid),
            )[0][0]
        )

    def test_a_quarantined_row_takes_its_writers_later_rows_and_keeps_the_others(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        b.typed(0, "beta ")
        kept = self.doc_row(node).tail_bound
        a.typed(5, " gamma")
        a.typed(11, " delta")

        self.assertEqual(self.quarantine(node, {3}, "cut_surrogate"), [3, 4])

        read = routes.content.read(routes.ADAPTER, self.doc_row(node).id)
        self.assertEqual(([rev for rev, _ in read["rows"]], read["quarantined"]), ([1, 2], [3, 4]))
        self.assertEqual(self.stored_text(node), "beta alpha")
        self.assertEqual(
            self.recovered(node),
            [(3, WRITER, "cut_surrogate", a.sent[1]), (4, WRITER, "cut_surrogate", a.sent[2])],
        )
        self.assertEqual((self.closed(node, a), self.closed(node, b)), (True, False))
        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, doc.head_rev), (1, 4))
        self.assertEqual((doc.tail_bytes, doc.tail_bound), (len(a.sent[0]) + len(b.sent[0]), kept))

        self.compact(node)
        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, self.text_of(state)), (4, "beta alpha"))

    def test_a_quarantine_tells_the_documents_live_room_its_new_epoch(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " beta")
        room = a.header["rooms"]["keys"][0]

        with patch("frappe.publish_realtime") as publish:
            self.quarantine(node, {9})
            self.quarantine(node, {2})

        self.assertEqual(
            [call for call in publish.call_args_list if call.args[0].startswith("suite_collab")],
            [
                mock.call(
                    "suite_collab_ctl",
                    {"lineage": a.header["lineage"], "kind": "quarantine", "q_epoch": 1},
                    room=room,
                )
            ],
        )

    def test_rows_typed_into_quarantined_text_go_with_it(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        b = Tab(self, node)
        b.typed(11, " beta")
        b.typed(0, "zero ")
        c = Tab(self, node)
        # Between "al" and "pha", both written in the first row
        c.typed(7, "X")

        self.assertEqual(self.quarantine(node, {2}), [2, 3, 4])

        self.assertEqual(self.stored_text(node), "alXpha")
        self.assertEqual((self.closed(node, b), self.closed(node, c)), (True, False))
        self.compact(node)
        self.assertEqual(self.text_of(self.checkpoints_of(node)[0][1]), "alXpha")

    def test_a_row_that_deletes_quarantined_text_goes_with_it(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        b = Tab(self, node)
        b.write(lambda text: text.__delitem__(slice(5, 11)))
        b.typed(0, "beta ")
        c = Tab(self, node)
        c.typed(7, "!")

        self.assertEqual(self.quarantine(node, {2}), [2, 3, 4])

        self.assertEqual((self.closed(node, b), self.closed(node, c)), (True, False))
        self.assertEqual(self.stored_text(node), "al!pha")
        self.compact(node)
        self.assertEqual(self.text_of(self.checkpoints_of(node)[0][1]), "al!pha")

    def test_a_push_that_needs_quarantined_text_is_refused(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        b = Tab(self, node)
        self.quarantine(node, {2})

        response = b.write(lambda text: text.insert(11, " beta"))

        self.assertEqual((response.status_code, answer(response)["collab"]), (409, "missing_dep"))
        self.assertEqual(Tab(self, node).typed(0, "beta "), 3)
        self.assertEqual(self.stored_text(node), "beta alpha")

    def test_an_unreadable_row_goes_with_its_writers_later_rows(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        b.typed(0, "beta ")
        self.store_raw(node, a, b"\x01\x01garbage")
        a.text.insert(5, " gamma")
        self.store_raw(node, a, a.doc.get_update(pycrdt.Doc().get_state()))

        self.assertEqual(self.quarantine(node, {3}, "malformed_row"), [3, 4])

        self.assertEqual(self.stored_text(node), "beta alpha")
        self.assertEqual([row[0] for row in self.recovered(node)], [3, 4])

    def store_raw(self, node: str, tab: Tab, payload: bytes):
        """Store `payload` as `tab`'s next row past every check, the way rows from before a check stay."""
        doc = self.doc_row(node)
        rev = doc.head_rev + 1
        tab.seq += 1
        sha = hashlib.sha256(payload).digest()
        chain = chain_next(bytes(doc.head_chain), rev, sha)
        frappe.db.sql(
            """INSERT INTO `__writer_content_update` (`doc_id`, `rev`, `sid`, `seq_from`, `seq_to`, `client_id`,
            `payload`, `sha256`, `seq_shas`, `chain`, `created`)
            VALUES (%s, %s, %s, %s, %s, %s, UNHEX(%s), UNHEX(%s), UNHEX(%s), UNHEX(%s), NOW())""",
            (
                doc.id,
                rev,
                tab.sid,
                tab.seq,
                tab.seq,
                tab.cid,
                payload.hex(),
                sha.hex(),
                sha.hex(),
                chain.hex(),
            ),
        )
        frappe.db.sql(
            "UPDATE `__writer_content_doc` SET `head_rev` = %s, `head_chain` = UNHEX(%s) WHERE `id` = %s",
            (rev, chain.hex(), doc.id),
        )
        frappe.db.commit()

    def test_a_row_in_the_checkpoint_is_left_alone(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        self.compact(node)

        with self.assertRaises(ValueError):
            self.quarantine(node, {1})

        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, self.recovered(node), self.closed(node, a)), (0, [], False))

    def pull(self, node: str, since: str = "0", q_epoch: str | None = None):
        return call(lambda node: routes.collab_updates_get(node, since=since, q_epoch=q_epoch), node)

    def test_a_tab_reads_a_quarantined_rev_as_an_empty_row(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        b.typed(0, "beta ")
        a.typed(5, " gamma")
        self.quarantine(node, {3})

        header, _checkpoint, rows = read_open(call(routes.collab_get, node).get_data())
        self.assertEqual((header["q_epoch"], rows), (1, [(1, a.sent[0]), (2, b.sent[0]), (3, b"")]))
        header, rows = read_frame(self.pull(node, q_epoch="1").get_data())
        self.assertEqual(
            (header["state"], header["q_epoch"], [rev for rev, _ in rows]), ("live", 1, [1, 2, 3])
        )
        self.assertEqual(rows[2], (3, b""))

    def test_a_tab_from_before_a_quarantine_is_told_to_rebuild(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        self.assertEqual(Tab(self, node).header["q_epoch"], 0)
        self.quarantine(node, {2})

        header, rows = read_frame(self.pull(node, q_epoch="0").get_data())
        self.assertEqual((header["state"], header["q_epoch"], rows), ("rebuild", 1, []))
        # A tab that sends no epoch is served rows as before
        self.assertEqual(read_frame(self.pull(node).get_data())[0]["state"], "live")
        response = self.pull(node, q_epoch="one")
        self.assertEqual((response.status_code, answer(response)["collab"]), (400, "malformed"))

    def test_a_writer_that_lost_a_row_is_refused_even_for_a_push_already_stored(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        b = Tab(self, node)
        self.quarantine(node, {2})

        # The tab never heard the answer to its second push and sends it again
        body = push_body(a.header["lineage"], a.sid, a.cid, 2, 0, a.sent[1])
        retried = call(routes.collab_updates_post, node, body=body)
        self.assertEqual((retried.status_code, answer(retried)["collab"]), (409, "client_closed"))
        typed = a.write(lambda text: text.insert(0, "zero "))
        self.assertEqual((typed.status_code, answer(typed)["collab"]), (409, "client_closed"))
        self.assertEqual(b.typed(0, "beta "), 3)

    def test_a_row_whose_session_is_gone_is_kept_for_the_document_owner(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " beta")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", a.sid)
        frappe.db.commit()
        frappe.set_user("Administrator")
        logged = frappe.db.count(
            "Error Log", {"method": "Collab recovery copies kept for the document owner"}
        )

        self.assertEqual(self.quarantine(node, {1}), [1, 2])

        self.assertEqual(
            self.recovered(node), [(1, WRITER, "test", a.sent[0]), (2, WRITER, "test", a.sent[1])]
        )
        self.assertEqual((self.states(node), self.stored_text(node)), (["quarantined", "quarantined"], ""))
        self.assertEqual(
            frappe.db.count("Error Log", {"method": "Collab recovery copies kept for the document owner"}),
            logged + 1,
        )

    def test_a_row_with_no_session_and_no_document_owner_is_not_quarantined(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", a.sid)
        frappe.db.commit()

        with self.assertRaises(RuntimeError):
            quarantine.quarantine(routes.ADAPTER, self.doc_row(node).id, {1}, "test", lambda node: None)

        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, self.recovered(node), self.stored_text(node)), (0, [], "alpha"))

    def test_the_same_bytes_twice_from_one_writer_keep_one_recovery_copy(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        self.store_raw(node, a, b"\x01\x01garbage")
        self.store_raw(node, a, b"\x01\x01garbage")

        self.assertEqual(self.quarantine(node, {2}, "malformed_row"), [2, 3])

        self.assertEqual(self.recovered(node), [(2, WRITER, "malformed_row", b"\x01\x01garbage")])

    def test_a_compaction_quarantines_a_row_that_splits_an_emoji(self):
        node = self.new_document()
        a = Tab(self, node)
        # The text node is clock 0, "a" clock 1, the emoji clocks 2 and 3, "b" clock 4
        a.typed(0, "a😀b")
        b = Tab(self, node)
        split = crafted(insert=(b.cid, 0, (a.cid, 2), (a.cid, 3), "x"))
        self.store_raw(node, b, split)
        c = Tab(self, node)
        c.typed(0, "!")

        self.compact(node)

        self.assertEqual(self.states(node), ["ok", "quarantined", "ok"])
        self.assertEqual(self.recovered(node), [(2, WRITER, "cut_surrogate", split)])
        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, self.text_of(state)), (3, "!a😀b"))

    def test_a_compaction_quarantines_an_unreadable_row_and_compacts_the_rest(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        self.store_raw(node, b, b"\x01\x01garbage")
        a.typed(5, " gamma")

        self.compact(node)

        self.assertEqual(self.states(node), ["ok", "quarantined", "ok"])
        self.assertEqual(self.text_of(self.checkpoints_of(node)[0][1]), "alpha gamma")

    def test_a_compaction_quarantines_each_stored_row_the_push_gate_now_refuses(self):
        def text(value: str) -> bytes:
            return number(len(value.encode())) + value.encode()

        def row(cid: int, *structs: bytes, clock: int = 0) -> bytes:
            return (
                number(1) + number(len(structs)) + number(cid) + number(clock) + b"".join(structs) + number(0)
            )

        def under(root: str, kind: int, content: bytes) -> bytes:
            return bytes([kind]) + number(1) + text(root) + content

        for name, payload, reason in (
            ("empty", lambda cid: b"\x00\x00", "refused_row"),
            ("missing change", lambda cid: crafted(insert=(cid, 0, (cid + 1, 0), None, "x")), "missing_dep"),
            ("JSON", lambda cid: row(cid, under("default", 2, number(1) + text('"1"'))), "refused_row"),
            ("binary", lambda cid: row(cid, under("default", 3, number(3) + b"\x01\x02\x03")), "refused_row"),
            (
                "subdocument",
                lambda cid: row(cid, under("default", 9, text("g") + bytes([118, 0]))),
                "refused_row",
            ),
            (
                "skip",
                lambda cid: row(cid, bytes([10]) + number(2), under("default", 4, text("b"))),
                "refused_row",
            ),
            ("unknown root", lambda cid: row(cid, under("elsewhere", 4, text("z"))), "unknown_root"),
            ("clock gap", lambda cid: row(cid, under("default", 4, text("b")), clock=1), "clock_gap"),
        ):
            with self.subTest(name):
                node = self.new_document()
                a = Tab(self, node)
                a.typed(0, "alpha")
                b, c = Tab(self, node), Tab(self, node)
                self.store_raw(node, b, payload(b.cid))
                c.typed(5, " gamma")

                self.compact(node)

                self.assertEqual(self.states(node), ["ok", "quarantined", "ok"])
                self.assertEqual(self.recovered(node), [(2, WRITER, reason, payload(b.cid))])
                self.assertEqual(self.text_of(self.checkpoints_of(node)[0][1]), "alpha gamma")

    def test_clocks_are_read_from_a_log_once_its_unreadable_row_is_quarantined(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        b.typed(0, "beta ")
        self.store_raw(node, a, b"\x01\x01garbage")
        doc_id = self.doc_row(node).id
        frappe.db.sql("UPDATE `__writer_content_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        routes.content.backfill_clocks(routes.ADAPTER, writer_collab.document_owner)

        self.assertEqual(
            (self.states(node), self.doc_row(node).start_clocks), (["ok", "ok", "quarantined"], "{}")
        )
        self.assertEqual(b.typed(10, " gamma"), 4)
        self.assertEqual(self.stored_text(node), "beta alpha gamma")

    def test_a_log_whose_unreadable_row_has_no_owner_is_left_for_later_and_the_rest_are_read(self):
        orphan, other = self.new_document(), self.new_document()
        a = Tab(self, orphan)
        a.typed(0, "alpha")
        self.store_raw(orphan, a, b"\x01\x01garbage")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", a.sid)
        Tab(self, other).typed(0, "beta")
        ids = (self.doc_row(orphan).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (ids,))
        frappe.db.commit()
        logged = f"Collab clocks not read for writer log {ids[0]}"

        routes.content.backfill_clocks(routes.ADAPTER, lambda node: None)

        self.assertEqual((self.states(orphan), self.doc_row(orphan).start_clocks), (["ok", "ok"], None))
        self.assertEqual(frappe.db.count("Error Log", {"method": logged}), 1)
        self.assertIsNotNone(self.doc_row(other).start_clocks)

    def test_a_log_purged_while_its_unreadable_row_is_quarantined_is_skipped_and_the_rest_are_read(self):
        purged, other = self.new_document(), self.new_document()
        a = Tab(self, purged)
        a.typed(0, "alpha")
        self.store_raw(purged, a, b"\x01\x01garbage")
        Tab(self, other).typed(0, "beta")
        ids = (self.doc_row(purged).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (ids,))
        frappe.db.commit()
        self.addCleanup(writer_collab.delete_purged, ids[0])
        real = quarantine.quarantine

        def purged_after(adapter, doc_id, *args):
            moved = real(adapter, doc_id, *args)
            frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
            return moved

        with patch.object(quarantine, "quarantine", purged_after):
            routes.content.backfill_clocks(routes.ADAPTER, writer_collab.document_owner)

        clocks = dict(
            frappe.db.sql("SELECT `id`, `start_clocks` FROM `__writer_content_doc` WHERE `id` IN %s", (ids,))
        )
        self.assertEqual((clocks[ids[0]], clocks[ids[1]] is not None), (None, True))
        self.assertEqual(
            frappe.db.count("Error Log", {"method": f"Collab clocks not read for writer log {ids[0]}"}), 0
        )

    def test_a_log_purged_before_its_clocks_are_read_is_skipped_and_the_rest_are_read(self):
        purged, other = self.new_document(), self.new_document()
        Tab(self, purged).typed(0, "alpha")
        Tab(self, other).typed(0, "beta")
        ids = (self.doc_row(purged).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (ids,))
        frappe.db.commit()
        self.addCleanup(writer_collab.delete_purged, ids[0])
        read = backfill.read

        def purged_first(adapter: str, doc_id: str):
            if doc_id == ids[0]:
                frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
            return read(adapter, doc_id)

        with patch.object(backfill, "read", purged_first):
            routes.content.backfill_clocks(routes.ADAPTER, writer_collab.document_owner)

        clocks = dict(
            frappe.db.sql("SELECT `id`, `start_clocks` FROM `__writer_content_doc` WHERE `id` IN %s", (ids,))
        )
        self.assertEqual((clocks[ids[0]], clocks[ids[1]] is not None), (None, True))
        self.assertEqual(
            frappe.db.count("Error Log", {"method": f"Collab clocks not read for writer log {ids[0]}"}), 0
        )
