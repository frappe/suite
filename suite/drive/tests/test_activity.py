import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.access import grant
from suite.drive._core.activity import (
    clear_recents,
    favourites,
    history,
    mark_read,
    notifications,
    notify_users,
    recents,
    record,
    set_favourite,
    unread_count,
    visit,
)
from suite.drive._core.errors import DriveNotFound
from suite.drive._core.nodes import create_folder, purge
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.drive._core.roots import create_root
from suite.tests.utils import ensure_user

OWNER = "drive-record-owner@example.com"
OTHER = "drive-record-other@example.com"
OUTSIDER = "drive-record-outsider@example.com"


class TestActivityAndPersonalRecords(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for user in (OWNER, OTHER, OUTSIDER):
            ensure_user(user)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.owner = Principals(OWNER, (OWNER,), ())
        self.other = Principals(OTHER, (OTHER,), ())
        self.outsider = Principals(OUTSIDER, (OUTSIDER,), ())
        self.root = create_root(kind="Personal", title="Record root", user=OWNER)
        self.node = create_folder(self.owner, self.root.name, "Records")
        grant(self.node, OTHER, READ, self.admin)

    def tearDown(self):
        frappe.set_user("Administrator")
        nodes = tuple(
            frappe.db.sql(
                "SELECT name FROM `tabDrive Node` WHERE name = %s OR root = %s",
                (self.root.name, self.root.name),
                pluck=True,
            )
        )
        activity = tuple(frappe.get_all("Drive Activity", filters={"node": ["in", nodes]}, pluck="name"))
        if activity:
            frappe.db.delete("Drive Notification", {"activity": ["in", activity]})
        for doctype in ("Drive Recent", "Drive Favourite", "Drive Activity", "Drive Grant"):
            frappe.db.delete(doctype, {"node": ["in", nodes]})
        frappe.db.delete("Drive Node", {"name": ["in", nodes]})
        frappe.db.delete("Drive Root", {"name": self.root.name})
        frappe.db.commit()
        super().tearDown()

    def test_visit_upserts_recent_without_activity_and_clear_preserves_favourite(self):
        activity_before = frappe.db.count("Drive Activity", {"node": self.node})
        first = visit(self.owner, self.node)
        second = visit(self.owner, self.node)
        set_favourite(self.owner, self.node)

        self.assertEqual(first, second)
        self.assertEqual(frappe.db.count("Drive Recent", {"user": OWNER, "node": self.node}), 1)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.node}), activity_before)
        self.assertEqual(recents(self.owner)[0].node.name, self.node)
        self.assertEqual(favourites(self.owner)[0].node.name, self.node)

        clear_recents(self.owner)
        self.assertFalse(frappe.db.exists("Drive Recent", {"user": OWNER, "node": self.node}))
        self.assertTrue(frappe.db.exists("Drive Favourite", {"user": OWNER, "node": self.node}))

    def test_personal_rows_and_mark_read_are_isolated_by_caller(self):
        visit(self.owner, self.node)
        visit(self.other, self.node)
        set_favourite(self.owner, self.node)
        set_favourite(self.other, self.node)
        clear_recents(self.owner)
        self.assertTrue(frappe.db.exists("Drive Recent", {"user": OTHER, "node": self.node}))
        self.assertTrue(frappe.db.exists("Drive Favourite", {"user": OWNER, "node": self.node}))

        activity = record(self.admin, self.node, "edit", detail={"version": 1})
        other_before = unread_count(self.other)
        notify_users(activity, (OWNER, OTHER))
        owner_notification = frappe.db.get_value(
            "Drive Notification", {"activity": activity, "to_user": OWNER}, "name"
        )
        self.assertEqual(unread_count(self.owner), 1)
        self.assertEqual(unread_count(self.other), other_before + 1)
        self.assertEqual(mark_read(self.other, owner_notification), 0)
        self.assertFalse(frappe.db.get_value("Drive Notification", owner_notification, "read"))
        self.assertEqual(mark_read(self.owner, owner_notification), 1)
        self.assertTrue(frappe.db.get_value("Drive Notification", owner_notification, "read"))

    def test_history_and_notifications_hide_currently_unreadable_nodes(self):
        activity = record(self.admin, self.node, "edit", detail={"blob": "sha"})
        notify_users(activity, (OWNER, OUTSIDER))
        self.assertEqual(history(self.owner, self.node)[0].detail["blob"], "sha")
        with self.assertRaises(DriveNotFound):
            history(self.outsider, self.node)
        self.assertEqual(len(notifications(self.owner)), 1)
        self.assertEqual(notifications(self.outsider), [])
        self.assertEqual(unread_count(self.outsider), 0)

    def test_grant_write_creates_one_activity_pointer_for_target_user(self):
        before = frappe.db.count("Drive Notification", {"to_user": OUTSIDER})
        grant(self.node, OUTSIDER, READ, self.admin)
        rows = frappe.get_all(
            "Drive Notification",
            filters={"to_user": OUTSIDER},
            fields=["activity"],
        )
        self.assertEqual(len(rows), before + 1)
        activity = frappe.db.get_value(
            "Drive Activity", rows[-1].activity, ["node", "action", "detail"], as_dict=True
        )
        self.assertEqual((activity.node, activity.action), (self.node, "share_add"))
        detail = frappe.parse_json(activity.detail) if isinstance(activity.detail, str) else activity.detail
        self.assertEqual(detail["principal"], OUTSIDER)

    def test_purge_removes_notifications_before_activity_and_personal_rows(self):
        visit(self.owner, self.node)
        set_favourite(self.owner, self.node)
        activity = record(self.admin, self.node, "edit")
        notify_users(activity, (OWNER,))

        self.assertEqual(purge(self.admin, self.node), 1)
        self.assertFalse(frappe.db.exists("Drive Notification", {"activity": activity}))
        self.assertFalse(frappe.db.exists("Drive Activity", {"node": self.node}))
        self.assertFalse(frappe.db.exists("Drive Recent", {"node": self.node}))
        self.assertFalse(frappe.db.exists("Drive Favourite", {"node": self.node}))
