import hashlib
import json
import uuid
from unittest import mock
from unittest.mock import patch

import frappe
import pycrdt

from suite.composition import content as routes
from suite.suite_core.content import backfill, documents, quarantine
from suite.suite_core.content.log import chain_next
from suite.suite_core.content.tests.test_compaction import crafted, encoded_varuint
from suite.writer import content as writer_content
from suite.writer.content.tests.test_checkpoints import WRITER, CheckpointCase
from suite.writer.content.tests.test_collab import answer, call_route, push_body, read_frame, read_open


class Tab:
    """A tab with its own session that types into the document's first text."""

    def __init__(self, case: TestQuarantine, node: str):
        self.case = case
        self.node = node
        self.sid = uuid.uuid4().hex
        session_body = json.dumps({"sid": self.sid}).encode()
        session = answer(call_route(routes.sessions_post, node, body=session_body))
        self.client_id = session["client_id"]
        opened = call_route(routes.document_get, node).get_data()
        self.header, checkpoint, rows = read_open(opened)

        self.ydoc = pycrdt.Doc(client_id=self.client_id)
        for payload in [checkpoint, *(payload for _rev, payload in rows)]:
            if payload:
                self.ydoc.apply_update(payload)

        self.seq = 0
        self.sent = []

    @property
    def text(self) -> pycrdt.XmlText:
        fragment = self.ydoc.get("default", type=pycrdt.XmlFragment)
        if len(fragment.children):
            return fragment.children[0]

        return fragment.children.append(pycrdt.XmlText())

    def push_edit(self, edit) -> object:
        """Push what `edit(text)` changes, with only its own deletes, as a browser does; answers the response."""
        updates = []
        subscription = self.ydoc.observe(lambda event: updates.append(event.update))
        with self.ydoc.transaction():
            edit(self.text)
        self.ydoc.unobserve(subscription)

        [update] = updates
        self.seq += 1
        self.sent.append(update)
        body = push_body(self.header["lineage"], self.sid, self.client_id, self.seq, 0, update)
        return call_route(routes.updates_post, self.node, body=body)

    def type_at(self, at: int, words: str) -> int:
        """Push `words` typed at `at`; answers the rev."""
        response = self.push_edit(lambda text: text.insert(at, words))
        self.case.assertEqual(response.status_code, 200, response.get_data())
        return answer(response)["rev"]

    def catch_up(self):
        snapshot = routes.content.read(writer_content.ADAPTER, self.case.doc_row(self.node).id)
        for _rev, payload in snapshot["rows"]:
            self.ydoc.apply_update(payload)


class TestQuarantine(CheckpointCase):
    def quarantine(self, node: str, revs: set[int], reason: str = "test") -> list[int]:
        return quarantine.quarantine(
            writer_content.ADAPTER, self.doc_row(node).id, revs, reason, writer_content.document_owner
        )

    def stored_text(self, node: str) -> str:
        read = routes.content.read(writer_content.ADAPTER, self.doc_row(node).id)
        doc = pycrdt.Doc()
        for payload in [read["checkpoint"], *(payload for _rev, payload in read["rows"])]:
            if payload:
                doc.apply_update(payload)

        fragment = doc.get("default", type=pycrdt.XmlFragment)
        return "".join(str(child) for child in fragment.children)

    def recovery_copies(self, node: str) -> list[tuple]:
        rows = frappe.db.sql(
            """SELECT `context_rev`, `owner`, `reason`, `payload` FROM `__writer_content_recovery`
                WHERE `doc_id` = %s ORDER BY `context_rev`""",
            self.doc_row(node).id,
        )
        return [(int(rev), owner, reason, bytes(payload)) for rev, owner, reason, payload in rows]

    def row_states(self, node: str) -> list[str]:
        rows = frappe.db.sql(
            "SELECT `state` FROM `__writer_content_update` WHERE `doc_id` = %s ORDER BY `rev`",
            self.doc_row(node).id,
        )
        return [state for (state,) in rows]

    def session_closed(self, node: str, tab: Tab) -> bool:
        rows = frappe.db.sql(
            "SELECT `closed` FROM `__writer_content_session` WHERE `doc_id` = %s AND `sid` = %s",
            (self.doc_row(node).id, tab.sid),
        )
        return bool(rows[0][0])

    def test_a_quarantined_row_takes_its_writers_later_rows_and_keeps_the_others(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        second_tab = Tab(self, node)
        second_tab.type_at(0, "beta ")
        kept = self.doc_row(node).tail_bound
        first_tab.type_at(5, " gamma")
        first_tab.type_at(11, " delta")

        self.assertEqual(self.quarantine(node, {3}, "cut_surrogate"), [3, 4])

        read = routes.content.read(writer_content.ADAPTER, self.doc_row(node).id)
        self.assertEqual(([rev for rev, _ in read["rows"]], read["quarantined"]), ([1, 2], [3, 4]))
        self.assertEqual(self.stored_text(node), "beta alpha")
        self.assertEqual(
            self.recovery_copies(node),
            [
                (3, WRITER, "cut_surrogate", first_tab.sent[1]),
                (4, WRITER, "cut_surrogate", first_tab.sent[2]),
            ],
        )
        self.assertEqual(
            (self.session_closed(node, first_tab), self.session_closed(node, second_tab)), (True, False)
        )
        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, doc.head_rev), (1, 4))
        self.assertEqual(
            (doc.tail_bytes, doc.tail_bound), (len(first_tab.sent[0]) + len(second_tab.sent[0]), kept)
        )

        self.compact(node)
        self.assertEqual((self.doc_row(node).body_rev, self.text_of(self.body_of(node))), (4, "beta alpha"))

    def test_a_quarantine_tells_the_documents_live_room_its_new_epoch(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " beta")
        room = first_tab.header["rooms"]["keys"][0]

        with patch("frappe.publish_realtime") as publish:
            self.quarantine(node, {9})
            self.quarantine(node, {2})

        collab_calls = [
            published for published in publish.call_args_list if published.args[0].startswith("suite_collab")
        ]
        epoch_message = {
            "lineage": first_tab.header["lineage"],
            "kind": "quarantine",
            "q_epoch": 1,
        }
        expected = [mock.call("suite_collab_ctl", epoch_message, room=room)]
        self.assertEqual(collab_calls, expected)

    def test_rows_typed_into_quarantined_text_go_with_it(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " gamma")
        second_tab = Tab(self, node)
        second_tab.type_at(11, " beta")
        second_tab.type_at(0, "zero ")
        third_tab = Tab(self, node)
        # Between "al" and "pha", both written in the first row
        third_tab.type_at(7, "X")

        self.assertEqual(self.quarantine(node, {2}), [2, 3, 4])

        self.assertEqual(self.stored_text(node), "alXpha")
        self.assertEqual(
            (self.session_closed(node, second_tab), self.session_closed(node, third_tab)), (True, False)
        )
        self.compact(node)
        self.assertEqual(self.text_of(self.body_of(node)), "alXpha")

    def test_a_row_that_deletes_quarantined_text_goes_with_it(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " gamma")
        second_tab = Tab(self, node)
        second_tab.push_edit(lambda text: text.__delitem__(slice(5, 11)))
        second_tab.type_at(0, "beta ")
        third_tab = Tab(self, node)
        third_tab.type_at(7, "!")

        self.assertEqual(self.quarantine(node, {2}), [2, 3, 4])

        self.assertEqual(
            (self.session_closed(node, second_tab), self.session_closed(node, third_tab)), (True, False)
        )
        self.assertEqual(self.stored_text(node), "al!pha")
        self.compact(node)
        self.assertEqual(self.text_of(self.body_of(node)), "al!pha")

    def test_a_push_that_needs_quarantined_text_is_refused(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " gamma")
        second_tab = Tab(self, node)
        self.quarantine(node, {2})

        response = second_tab.push_edit(lambda text: text.insert(11, " beta"))

        self.assertEqual((response.status_code, answer(response)["collab"]), (409, "missing_dep"))
        self.assertEqual(Tab(self, node).type_at(0, "beta "), 3)
        self.assertEqual(self.stored_text(node), "beta alpha")

    def test_an_unreadable_row_goes_with_its_writers_later_rows(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        second_tab = Tab(self, node)
        second_tab.type_at(0, "beta ")
        self.store_raw(node, first_tab, b"\x01\x01garbage")
        first_tab.text.insert(5, " gamma")
        self.store_raw(node, first_tab, first_tab.ydoc.get_update(pycrdt.Doc().get_state()))

        self.assertEqual(self.quarantine(node, {3}, "malformed_row"), [3, 4])

        self.assertEqual(self.stored_text(node), "beta alpha")
        self.assertEqual([row[0] for row in self.recovery_copies(node)], [3, 4])

    def store_raw(self, node: str, tab: Tab, payload: bytes):
        """Store `payload` as `tab`'s next row past every check, the way rows from before a check stay."""
        doc = self.doc_row(node)
        rev = doc.head_rev + 1
        tab.seq += 1
        sha256 = hashlib.sha256(payload).digest()
        chain = chain_next(bytes(doc.head_chain), rev, sha256)
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
                tab.client_id,
                payload.hex(),
                sha256.hex(),
                sha256.hex(),
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
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        self.compact(node)

        with self.assertRaises(ValueError):
            self.quarantine(node, {1})

        doc = self.doc_row(node)
        self.assertEqual(
            (doc.q_epoch, self.recovery_copies(node), self.session_closed(node, first_tab)), (0, [], False)
        )

    def pull_rows(self, node: str, since: str = "0", q_epoch: str | None = None):
        return call_route(lambda node: routes.updates_get(node, since=since, q_epoch=q_epoch), node)

    def test_a_tab_reads_a_quarantined_rev_as_an_empty_row(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        second_tab = Tab(self, node)
        second_tab.type_at(0, "beta ")
        first_tab.type_at(5, " gamma")
        self.quarantine(node, {3})

        opened = call_route(routes.document_get, node).get_data()
        header, _checkpoint, rows = read_open(opened)
        self.assertEqual(
            (header["q_epoch"], rows), (1, [(1, first_tab.sent[0]), (2, second_tab.sent[0]), (3, b"")])
        )
        pulled = self.pull_rows(node, q_epoch="1").get_data()
        header, rows = read_frame(pulled)
        self.assertEqual(
            (header["state"], header["q_epoch"], [rev for rev, _ in rows]), ("live", 1, [1, 2, 3])
        )
        self.assertEqual(rows[2], (3, b""))

    def test_a_tab_from_before_a_quarantine_is_told_to_rebuild(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " gamma")
        self.assertEqual(Tab(self, node).header["q_epoch"], 0)
        self.quarantine(node, {2})

        pulled = self.pull_rows(node, q_epoch="0").get_data()
        header, rows = read_frame(pulled)
        self.assertEqual((header["state"], header["q_epoch"], rows), ("rebuild", 1, []))
        # A tab that sends no epoch is served rows as before
        pulled_without_epoch = self.pull_rows(node).get_data()
        header_without_epoch, _rows = read_frame(pulled_without_epoch)
        self.assertEqual(header_without_epoch["state"], "live")
        response = self.pull_rows(node, q_epoch="one")
        self.assertEqual((response.status_code, answer(response)["collab"]), (400, "malformed"))

    def test_a_writer_that_lost_a_row_is_refused_even_for_a_push_already_stored(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " gamma")
        second_tab = Tab(self, node)
        self.quarantine(node, {2})

        # The tab never heard the answer to its second push and sends it again
        body = push_body(
            first_tab.header["lineage"], first_tab.sid, first_tab.client_id, 2, 0, first_tab.sent[1]
        )
        retried = call_route(routes.updates_post, node, body=body)
        self.assertEqual((retried.status_code, answer(retried)["collab"]), (409, "client_closed"))
        typed_response = first_tab.push_edit(lambda text: text.insert(0, "zero "))
        self.assertEqual(
            (typed_response.status_code, answer(typed_response)["collab"]), (409, "client_closed")
        )
        self.assertEqual(second_tab.type_at(0, "beta "), 3)

    def test_a_row_whose_session_is_gone_is_kept_for_the_document_owner(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        first_tab.type_at(5, " beta")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", first_tab.sid)
        frappe.db.commit()
        frappe.set_user("Administrator")
        logged = frappe.db.count(
            "Error Log", {"method": "Collab recovery copies kept for the document owner"}
        )

        self.assertEqual(self.quarantine(node, {1}), [1, 2])

        self.assertEqual(
            self.recovery_copies(node),
            [(1, WRITER, "test", first_tab.sent[0]), (2, WRITER, "test", first_tab.sent[1])],
        )
        self.assertEqual(
            (self.row_states(node), self.stored_text(node)), (["quarantined", "quarantined"], "")
        )
        self.assertEqual(
            frappe.db.count("Error Log", {"method": "Collab recovery copies kept for the document owner"}),
            logged + 1,
        )

    def test_a_row_with_no_session_and_no_document_owner_is_not_quarantined(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", first_tab.sid)
        frappe.db.commit()

        with self.assertRaises(RuntimeError):
            quarantine.quarantine(
                writer_content.ADAPTER, self.doc_row(node).id, {1}, "test", lambda node: None
            )

        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, self.recovery_copies(node), self.stored_text(node)), (0, [], "alpha"))

    def test_the_same_bytes_twice_from_one_writer_keep_one_recovery_copy(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        self.store_raw(node, first_tab, b"\x01\x01garbage")
        self.store_raw(node, first_tab, b"\x01\x01garbage")

        self.assertEqual(self.quarantine(node, {2}, "malformed_row"), [2, 3])

        self.assertEqual(self.recovery_copies(node), [(2, WRITER, "malformed_row", b"\x01\x01garbage")])

    def test_a_compaction_quarantines_a_row_that_splits_an_emoji(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        # The text node is clock 0, "a" clock 1, the emoji clocks 2 and 3, "b" clock 4
        first_tab.type_at(0, "a😀b")
        second_tab = Tab(self, node)
        split = crafted(
            insert=(second_tab.client_id, 0, (first_tab.client_id, 2), (first_tab.client_id, 3), "x")
        )
        self.store_raw(node, second_tab, split)
        third_tab = Tab(self, node)
        third_tab.type_at(0, "!")

        self.compact(node)

        self.assertEqual(self.row_states(node), ["ok", "quarantined", "ok"])
        self.assertEqual(self.recovery_copies(node), [(2, WRITER, "cut_surrogate", split)])
        self.assertEqual((self.doc_row(node).body_rev, self.text_of(self.body_of(node))), (3, "!a😀b"))

    def test_a_compaction_quarantines_an_unreadable_row_and_compacts_the_rest(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        second_tab = Tab(self, node)
        self.store_raw(node, second_tab, b"\x01\x01garbage")
        first_tab.type_at(5, " gamma")

        self.compact(node)

        self.assertEqual(self.row_states(node), ["ok", "quarantined", "ok"])
        self.assertEqual(self.text_of(self.body_of(node)), "alpha gamma")

    def test_a_compaction_quarantines_each_stored_row_the_push_gate_now_refuses(self):
        def encoded_text(value: str) -> bytes:
            return encoded_varuint(len(value.encode())) + value.encode()

        def crafted_row(client_id: int, *structs: bytes, clock: int = 0) -> bytes:
            return (
                encoded_varuint(1)
                + encoded_varuint(len(structs))
                + encoded_varuint(client_id)
                + encoded_varuint(clock)
                + b"".join(structs)
                + encoded_varuint(0)
            )

        def root_struct(root: str, kind: int, content: bytes) -> bytes:
            return bytes([kind]) + encoded_varuint(1) + encoded_text(root) + content

        refused_rows = (
            ("empty", lambda client_id: b"\x00\x00", "refused_row"),
            (
                "missing change",
                lambda client_id: crafted(insert=(client_id, 0, (client_id + 1, 0), None, "x")),
                "missing_dep",
            ),
            (
                "JSON",
                lambda client_id: crafted_row(
                    client_id, root_struct("default", 2, encoded_varuint(1) + encoded_text('"1"'))
                ),
                "refused_row",
            ),
            (
                "binary",
                lambda client_id: crafted_row(
                    client_id, root_struct("default", 3, encoded_varuint(3) + b"\x01\x02\x03")
                ),
                "refused_row",
            ),
            (
                "subdocument",
                lambda client_id: crafted_row(
                    client_id, root_struct("default", 9, encoded_text("g") + bytes([118, 0]))
                ),
                "refused_row",
            ),
            (
                "skip",
                lambda client_id: crafted_row(
                    client_id, bytes([10]) + encoded_varuint(2), root_struct("default", 4, encoded_text("b"))
                ),
                "refused_row",
            ),
            (
                "unknown root",
                lambda client_id: crafted_row(client_id, root_struct("elsewhere", 4, encoded_text("z"))),
                "unknown_root",
            ),
            (
                "clock gap",
                lambda client_id: crafted_row(
                    client_id, root_struct("default", 4, encoded_text("b")), clock=1
                ),
                "clock_gap",
            ),
        )
        for name, payload, reason in refused_rows:
            with self.subTest(name):
                node = self.new_document()
                first_tab = Tab(self, node)
                first_tab.type_at(0, "alpha")
                second_tab = Tab(self, node)
                third_tab = Tab(self, node)
                self.store_raw(node, second_tab, payload(second_tab.client_id))
                third_tab.type_at(5, " gamma")

                self.compact(node)

                self.assertEqual(self.row_states(node), ["ok", "quarantined", "ok"])
                self.assertEqual(
                    self.recovery_copies(node), [(2, WRITER, reason, payload(second_tab.client_id))]
                )
                self.assertEqual(self.text_of(self.body_of(node)), "alpha gamma")

    def test_clocks_are_read_from_a_log_once_its_unreadable_row_is_quarantined(self):
        node = self.new_document()
        first_tab = Tab(self, node)
        first_tab.type_at(0, "alpha")
        second_tab = Tab(self, node)
        second_tab.type_at(0, "beta ")
        self.store_raw(node, first_tab, b"\x01\x01garbage")
        doc_id = self.doc_row(node).id
        frappe.db.sql("UPDATE `__writer_content_session` SET `next_clock` = NULL WHERE `doc_id` = %s", doc_id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` = %s", doc_id)
        frappe.db.commit()

        routes.content.backfill_clocks(writer_content.ADAPTER, writer_content.document_owner)

        self.assertEqual(
            (self.row_states(node), self.doc_row(node).start_clocks), (["ok", "ok", "quarantined"], "{}")
        )
        self.assertEqual(second_tab.type_at(10, " gamma"), 4)
        self.assertEqual(self.stored_text(node), "beta alpha gamma")

    def test_a_log_whose_unreadable_row_has_no_owner_is_left_for_later_and_the_rest_are_read(self):
        orphan = self.new_document()
        other = self.new_document()
        first_tab = Tab(self, orphan)
        first_tab.type_at(0, "alpha")
        self.store_raw(orphan, first_tab, b"\x01\x01garbage")
        frappe.db.sql("DELETE FROM `__writer_content_session` WHERE `sid` = %s", first_tab.sid)
        Tab(self, other).type_at(0, "beta")
        doc_ids = (self.doc_row(orphan).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (doc_ids,))
        frappe.db.commit()
        logged = f"Collab clocks not read for writer log {doc_ids[0]}"

        routes.content.backfill_clocks(writer_content.ADAPTER, lambda node: None)

        self.assertEqual((self.row_states(orphan), self.doc_row(orphan).start_clocks), (["ok", "ok"], None))
        self.assertEqual(frappe.db.count("Error Log", {"method": logged}), 1)
        self.assertIsNotNone(self.doc_row(other).start_clocks)

    def test_a_log_purged_while_its_unreadable_row_is_quarantined_is_skipped_and_the_rest_are_read(self):
        purged = self.new_document()
        other = self.new_document()
        first_tab = Tab(self, purged)
        first_tab.type_at(0, "alpha")
        self.store_raw(purged, first_tab, b"\x01\x01garbage")
        Tab(self, other).type_at(0, "beta")
        doc_ids = (self.doc_row(purged).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (doc_ids,))
        frappe.db.commit()
        self.addCleanup(documents.delete_purged, writer_content.ADAPTER, doc_ids[0])
        real_quarantine = quarantine.quarantine

        def quarantine_then_purge(adapter, doc_id, *args):
            moved = real_quarantine(adapter, doc_id, *args)
            frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
            return moved

        with patch.object(quarantine, "quarantine", quarantine_then_purge):
            routes.content.backfill_clocks(writer_content.ADAPTER, writer_content.document_owner)

        clock_rows = frappe.db.sql(
            "SELECT `id`, `start_clocks` FROM `__writer_content_doc` WHERE `id` IN %s", (doc_ids,)
        )
        clocks = dict(clock_rows)
        self.assertEqual((clocks[doc_ids[0]], clocks[doc_ids[1]] is not None), (None, True))
        self.assertEqual(
            frappe.db.count("Error Log", {"method": f"Collab clocks not read for writer log {doc_ids[0]}"}), 0
        )

    def test_a_log_purged_before_its_clocks_are_read_is_skipped_and_the_rest_are_read(self):
        purged = self.new_document()
        other = self.new_document()
        Tab(self, purged).type_at(0, "alpha")
        Tab(self, other).type_at(0, "beta")
        doc_ids = (self.doc_row(purged).id, self.doc_row(other).id)
        frappe.db.sql("UPDATE `__writer_content_doc` SET `start_clocks` = NULL WHERE `id` IN %s", (doc_ids,))
        frappe.db.commit()
        self.addCleanup(documents.delete_purged, writer_content.ADAPTER, doc_ids[0])
        real_read = backfill.read

        def purged_first(adapter: str, doc_id: str):
            if doc_id == doc_ids[0]:
                frappe.db.sql("UPDATE `__writer_content_doc` SET `mode` = 'purged' WHERE `id` = %s", doc_id)
            return real_read(adapter, doc_id)

        with patch.object(backfill, "read", purged_first):
            routes.content.backfill_clocks(writer_content.ADAPTER, writer_content.document_owner)

        clock_rows = frappe.db.sql(
            "SELECT `id`, `start_clocks` FROM `__writer_content_doc` WHERE `id` IN %s", (doc_ids,)
        )
        clocks = dict(clock_rows)
        self.assertEqual((clocks[doc_ids[0]], clocks[doc_ids[1]] is not None), (None, True))
        self.assertEqual(
            frappe.db.count("Error Log", {"method": f"Collab clocks not read for writer log {doc_ids[0]}"}), 0
        )
