import hashlib
import json
import uuid

import frappe
import pycrdt

from suite.suite_core.collab import quarantine
from suite.suite_core.collab.log import chain_next
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
        """Push what `edit(text)` changes; answers the response."""
        before = self.doc.get_state()
        edit(self.text)
        update = self.doc.get_update(before)
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
        for _rev, payload in routes.collab.read(routes.ADAPTER, self.case.doc_row(self.node).id)["rows"]:
            self.doc.apply_update(payload)


class TestQuarantine(CheckpointCase):
    def quarantine(self, node: str, revs: set[int], reason: str = "test") -> list[int]:
        return quarantine.quarantine(routes.ADAPTER, self.doc_row(node).id, revs, reason)

    def stored_text(self, node: str) -> str:
        read = routes.collab.read(routes.ADAPTER, self.doc_row(node).id)
        doc = pycrdt.Doc()
        for payload in [read["checkpoint"], *(payload for _rev, payload in read["rows"])]:
            if payload:
                doc.apply_update(payload)
        return "".join(str(child) for child in doc.get("default", type=pycrdt.XmlFragment).children)

    def recovered(self, node: str) -> list[tuple]:
        return [
            (int(rev), owner, reason, bytes(payload))
            for rev, owner, reason, payload in frappe.db.sql(
                """SELECT `context_rev`, `owner`, `reason`, `payload` FROM `__writer_collab_recovery`
                WHERE `doc_id` = %s ORDER BY `context_rev`""",
                self.doc_row(node).id,
            )
        ]

    def closed(self, node: str, tab: Tab) -> bool:
        return bool(
            frappe.db.sql(
                "SELECT `closed` FROM `__writer_collab_session` WHERE `doc_id` = %s AND `sid` = %s",
                (self.doc_row(node).id, tab.sid),
            )[0][0]
        )

    def test_a_quarantined_row_takes_its_writers_later_rows_and_keeps_the_others(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        b = Tab(self, node)
        b.typed(0, "beta ")
        a.typed(5, " gamma")
        a.typed(11, " delta")

        self.assertEqual(self.quarantine(node, {3}, "cut_surrogate"), [3, 4])

        read = routes.collab.read(routes.ADAPTER, self.doc_row(node).id)
        self.assertEqual(([rev for rev, _ in read["rows"]], read["quarantined"]), ([1, 2], [3, 4]))
        self.assertEqual(self.stored_text(node), "beta alpha")
        self.assertEqual(
            self.recovered(node),
            [(3, WRITER, "cut_surrogate", a.sent[1]), (4, WRITER, "cut_surrogate", a.sent[2])],
        )
        self.assertEqual((self.closed(node, a), self.closed(node, b)), (True, False))
        doc = self.doc_row(node)
        self.assertEqual((doc.q_epoch, doc.head_rev), (1, 4))
        self.assertEqual(doc.tail_bytes, len(a.sent[0]) + len(b.sent[0]))

        self.compact(node)
        [(through, state, _integrated)] = self.checkpoints_of(node)
        self.assertEqual((through, self.text_of(state)), (4, "beta alpha"))

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

    def test_a_row_that_deletes_quarantined_text_stays_and_the_document_compacts(self):
        node = self.new_document()
        a = Tab(self, node)
        a.typed(0, "alpha")
        a.typed(5, " gamma")
        b = Tab(self, node)
        b.write(lambda text: text.__delitem__(slice(5, 11)))
        b.typed(0, "beta ")

        self.assertEqual(self.quarantine(node, {2}), [2])

        self.assertEqual(self.stored_text(node), "beta alpha")
        self.compact(node)
        self.assertEqual(self.text_of(self.checkpoints_of(node)[0][1]), "beta alpha")

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
            """INSERT INTO `__writer_collab_update` (`doc_id`, `rev`, `sid`, `seq_from`, `seq_to`, `client_id`,
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
            "UPDATE `__writer_collab_doc` SET `head_rev` = %s, `head_chain` = UNHEX(%s) WHERE `id` = %s",
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
