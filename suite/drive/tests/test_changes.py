from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core import changes


class TestDriveChangedContract(UnitTestCase):
    def test_the_event_is_payload_free_and_after_commit(self):
        with patch.object(changes.frappe, "publish_realtime") as publish:
            changes.emit_for_users(("b@example.com", "a@example.com", "a@example.com"))
        self.assertEqual(publish.call_count, 2)
        for sent in publish.call_args_list:
            self.assertEqual(sent.args, ("drive:changed",))
            self.assertEqual(set(sent.kwargs), {"user", "after_commit"})
            self.assertTrue(sent.kwargs["after_commit"])

    def test_node_owner_and_direct_group_and_general_holders_get_user_rooms(self):
        node = frappe._dict(
            name="n1",
            root="r1",
            path="/r1/",
            kind="file",
            owner="owner@example.com",
        )

        def get_all(doctype, **kwargs):
            if doctype == "Drive Grant":
                return ["direct@example.com", "$GROUP:editors", "$GENERAL", "$LINK:secret"]
            if doctype == "User Group Member":
                return ["group@example.com"]
            if doctype == "User":
                return ["general@example.com", "Guest"]
            self.fail(f"Unexpected doctype {doctype}")

        with patch.object(changes.frappe.db, "get_value", return_value=node):
            with patch.object(changes.frappe, "get_all", side_effect=get_all):
                with patch.object(changes.frappe, "publish_realtime") as publish:
                    changes.emit_for_node(node.name)

        self.assertEqual(
            {call.kwargs["user"] for call in publish.call_args_list},
            {
                "direct@example.com",
                "general@example.com",
                "group@example.com",
                "owner@example.com",
            },
        )


class TestDriveChangedTransaction(IntegrationTestCase):
    def test_a_rollback_emits_nothing_and_a_commit_flushes_once(self):
        frappe.db.rollback()
        with patch("frappe.realtime.emit_via_redis") as emitted:
            changes.emit_for_users(("Administrator",))
            emitted.assert_not_called()
            frappe.db.rollback()
            emitted.assert_not_called()

            changes.emit_for_users(("Administrator",))
            emitted.assert_not_called()
            frappe.db.commit()

        emitted.assert_called_once()
        self.assertEqual(emitted.call_args.args[0], "drive:changed")
        self.assertEqual(emitted.call_args.args[1], {})
