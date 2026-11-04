import uuid
from unittest.mock import patch

import frappe
import pycrdt

from suite.content import checkpoints
from suite.content.http import routes
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    CollabCase,
    typed_updates,
)


class TestWriterCollabClaims(CollabCase):
    def test_an_offline_tab_claims_its_own_client_id_and_then_pushes(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        sid = uuid.uuid4().hex
        client_id = 2**30 + 7

        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        self.assertEqual(self.claim(node, sid, client_id, lineage), (200, {"claim": "ok"}))
        offline = self.typed_update(client_id, 1, "offline")
        status, _ = self.push(node, sid, client_id, 1, offline)
        self.assertEqual(status, 200)
        _, rows = self.open_document(node)
        self.assertEqual([payload for _, payload in rows], [offline])

    def test_a_claim_on_a_taken_id_or_another_lineage_binds_nothing(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]
        client_id = 2**30 + 9
        _, claimed = self.claim(node, uuid.uuid4().hex, client_id, lineage)
        self.assertEqual(claimed, {"claim": "ok"})
        sessions = self.table_count("session")

        clash = self.claim(node, uuid.uuid4().hex, client_id, lineage)
        other_lineage = self.claim(node, uuid.uuid4().hex, client_id + 1, "0" * 32)

        self.assertEqual((clash, other_lineage), ((200, {"claim": "clash"}), (200, {"claim": "lineage"})))
        self.assertEqual(self.table_count("session"), sessions)

    def test_a_tab_never_gets_the_id_of_a_writer_its_copy_started_from(self):
        self.set_mode("on")
        node = self.new_document()
        issued = 7
        claimed = 2**30 + 7
        [issued_start] = typed_updates(issued, ["start"])
        [claimed_start] = typed_updates(claimed, ["start"])
        start = pycrdt.merge_updates(issued_start, claimed_start)
        doc_id = routes.content.find(writer_content.APP, node).id
        checkpoints.replace_start(writer_content.APP, doc_id, start, 1)
        frappe.db.commit()
        header, _ = self.open_document(node)
        lineage = header["lineage"]

        with patch("secrets.randbelow", side_effect=[issued - 1, 41]):
            _, client_id = self.start_session(node)
            self.assertEqual(client_id, 42)

        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed, lineage), (200, {"claim": "clash"}))
        self.assertEqual(self.claim(node, uuid.uuid4().hex, claimed + 1, lineage), (200, {"claim": "ok"}))

    def test_a_claim_outside_the_device_range_is_refused(self):
        self.set_mode("on")
        node = self.new_document()
        header, _ = self.open_document(node)
        lineage = header["lineage"]

        for client_id in (5, 2**31, "x"):
            self.assertEqual(
                self.claim(node, uuid.uuid4().hex, client_id, lineage), (400, {"collab": "malformed"})
            )
