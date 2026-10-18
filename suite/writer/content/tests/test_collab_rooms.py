import base64
import uuid
from unittest.mock import Mock, patch

import frappe

from suite import drive
from suite.composition import content as routes
from suite.drive._core.access import grant
from suite.drive._core.principals import Principals
from suite.suite_core.content import live
from suite.writer import content as writer_content
from suite.writer.content.tests.support import (
    READER,
    WRITER,
    CollabCase,
    call_route,
    read_frame,
)


class TestWriterCollabRooms(CollabCase):
    def test_open_and_pull_name_this_epochs_room_and_the_next_and_no_other_documents(self):
        self.set_mode("on")
        node, other = self.new_document(), self.new_document()
        grant(node, READER, drive.READ, Principals(WRITER, (WRITER, "$GENERAL"), ("$PUBLIC",)))
        frappe.db.commit()

        late_in_epoch_1000 = Mock(time=Mock(return_value=150 * 1000 + 149))
        in_epoch_1001 = Mock(time=Mock(return_value=150 * 1001))

        frappe.set_user(READER)
        with patch.object(live, "time", late_in_epoch_1000):
            opened = self.open_document(node)[0]["rooms"]
            pull = call_route(routes.updates_get, node)
            pulled = read_frame(pull.get_data())[0]["rooms"]
        frappe.set_user(WRITER)
        with patch.object(live, "time", in_epoch_1001):
            later = self.open_document(node)[0]["rooms"]
            elsewhere = self.open_document(other)[0]["rooms"]

        self.assertEqual(opened, pulled)
        self.assertEqual((opened["epoch"], opened["epoch_seconds"]), (1000, 150))
        self.assertEqual(later["keys"][0], opened["keys"][1])
        self.assertEqual(len({*opened["keys"], *later["keys"], *elsewhere["keys"]}), 5)
        for key in opened["keys"]:
            self.assertRegex(key, r"^sc:[A-Za-z0-9_-]{32}$")

    def test_a_document_copied_to_a_new_lineage_gets_new_rooms(self):
        self.set_mode("on")
        node = self.new_document()
        self.open_document(node)
        doc = routes.content.find(writer_content.ADAPTER, node)
        before = routes.content.rooms(writer_content.ADAPTER, doc.id, doc.lineage)

        after = routes.content.rooms(writer_content.ADAPTER, doc.id, uuid.uuid4().hex)

        self.assertFalse({*before["keys"]} & {*after["keys"]})

    def test_a_committed_push_publishes_its_row_to_this_epochs_room(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)
        rooms = self.open_document(node)[0]["rooms"]
        small, large = self.typed_update(client_id, 1, "small"), self.typed_update(client_id, 2, "x" * 40_000)

        with patch("frappe.publish_realtime") as publish:
            self.push(node, sid, client_id, 1, small)
            self.push(node, sid, client_id, 1, small)
            self.push(node, sid, client_id, 2, large)
            self.push(node, sid, client_id, 5)

        lineage = self.open_document(node)[0]["lineage"]
        published = [
            (event.args, event.kwargs)
            for event in publish.call_args_list
            if event.args[0] == "suite_collab_row"
        ]
        small_row = {
            "lineage": lineage,
            "rev": 1,
            "schema": 1,
            "u": base64.b64encode(small).decode(),
        }
        large_row = {
            "lineage": lineage,
            "rev": 2,
            "schema": 1,
            "u": None,
        }
        this_epochs_room = {"room": rooms["keys"][0]}
        self.assertEqual(
            published,
            [
                (("suite_collab_row", small_row), this_epochs_room),
                (("suite_collab_row", large_row), this_epochs_room),
            ],
        )

    def test_a_push_is_saved_and_answered_when_realtime_cannot_be_reached(self):
        self.set_mode("on")
        node = self.new_document()
        sid, client_id = self.start_session(node)

        with patch("frappe.publish_realtime", side_effect=TimeoutError):
            status, body = self.push(node, sid, client_id, 1)

        self.assertEqual((status, body["rev"]), (200, 1))
        self.assert_one_order(node, 1)

    def test_the_realtime_service_may_let_sockets_into_rooms_only_while_collaboration_is_on(self):
        frappe.set_user("Guest")
        answers = {}
        for mode in ("off", "on"):
            self.set_mode(mode)
            answers[mode] = live.joinable()

        self.assertEqual(answers, {"off": False, "on": True})

    def test_the_switch_takes_one_row_for_each_app_that_keeps_its_documents_in_the_layer(self):
        frappe.set_user("Administrator")
        settings = frappe.get_single("Suite Collab Settings")
        settings.set("apps", [{"adapter": "spreadsheet", "mode": "on"}])
        with self.assertRaisesRegex(frappe.ValidationError, "No app named spreadsheet"):
            settings.save()

        settings = frappe.get_single("Suite Collab Settings")
        settings.set("apps", [{"adapter": "writer", "mode": "on"}, {"adapter": "writer", "mode": "off"}])
        with self.assertRaisesRegex(frappe.ValidationError, "writer has more than one row"):
            settings.save()
