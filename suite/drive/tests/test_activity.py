from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.drive._core.access import grant, revoke
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
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import copy, create_folder, purge, update, views
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, MANAGE, NONE, READ
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_personal_root
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
            # A new user is given a Personal root; each test makes its own.
            drop_personal_root(user)

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
        self.assertEqual(recents(self.owner)["rows"][0].node.name, self.node)
        self.assertEqual(favourites(self.owner)["rows"][0].node.name, self.node)

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

    def test_node_reads_carry_only_the_callers_own_favourite(self):
        from suite.drive.http import routes

        starred = create_folder(self.owner, self.node, "Starred child")
        plain = create_folder(self.owner, self.node, "Plain child")
        set_favourite(self.owner, starred)

        def flags(rows):
            return {row["name"]: row["favourite"] for row in rows if row["name"] in (starred, plain)}

        frappe.set_user(OWNER)
        self.assertIs(routes.node_get(node=starred)["favourite"], True)
        self.assertIs(routes.node_get(node=plain)["favourite"], False)
        self.assertEqual(flags(routes.node_children(node=self.node)["rows"]), {starred: True, plain: False})
        self.assertEqual(flags(routes.view_list(view="favourites")["rows"]), {starred: True})

        # The other reader sees the same nodes, unstarred: a favourite is one person's own.
        frappe.set_user(OTHER)
        self.assertIs(routes.node_get(node=starred)["favourite"], False)
        self.assertEqual(flags(routes.node_children(node=self.node)["rows"]), {starred: False, plain: False})

        frappe.set_user(OWNER)
        routes.node_delete_favourite(node=starred)
        self.assertIs(routes.node_get(node=starred)["favourite"], False)
        self.assertEqual(flags(routes.view_list(view="favourites")["rows"]), {})

    def test_history_and_notifications_hide_currently_unreadable_nodes(self):
        activity = record(self.admin, self.node, "edit", detail={"blob": "sha"})
        notify_users(activity, (OWNER, OUTSIDER))
        self.assertEqual(history(self.owner, self.node)["rows"][0].detail["blob"], "sha")
        with self.assertRaises(DriveNotFound):
            history(self.outsider, self.node)
        self.assertEqual(len(notifications(self.owner)["rows"]), 1)
        self.assertEqual(notifications(self.outsider)["rows"], [])
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

    def test_repeating_a_notification_for_the_same_pair_adds_no_second_row(self):
        activity = record(self.admin, self.node, "edit", detail={"version": 1})
        self.assertEqual(notify_users(activity, (OWNER, OTHER)), 2)
        first = frappe.db.get_value("Drive Notification", {"activity": activity, "to_user": OWNER}, "name")
        self.assertEqual(mark_read(self.owner, first), 1)

        # A repeat within one call and a repeat across calls both add nothing.
        self.assertEqual(notify_users(activity, (OWNER, OWNER, OTHER)), 0)

        rows = frappe.get_all(
            "Drive Notification",
            filters={"activity": activity},
            fields=["name", "to_user", "read"],
        )
        self.assertEqual(sorted(row.to_user for row in rows), sorted((OWNER, OTHER)))
        owner_row = next(row for row in rows if row.to_user == OWNER)
        # The repeat kept the same pointer, so it cannot return a notification
        # the reader already cleared to the inbox.
        self.assertEqual(owner_row.name, first)
        self.assertTrue(owner_row.read)
        inbox = [row.name for row in notifications(self.owner)["rows"] if row.activity.name == activity]
        self.assertEqual(inbox, [first])

        # The row is unique per activity, not per person: a later activity on
        # the same node still notifies the same user.
        later = record(self.admin, self.node, "edit", detail={"version": 2})
        self.assertEqual(notify_users(later, (OWNER,)), 1)
        self.assertEqual(frappe.db.count("Drive Notification", {"activity": later}), 1)

    def test_a_missed_uniqueness_check_still_cannot_duplicate_a_notification(self):
        activity = record(self.admin, self.node, "edit")
        self.assertEqual(notify_users(activity, (OWNER,)), 1)
        existing = frappe.db.get_value("Drive Notification", {"activity": activity, "to_user": OWNER}, "name")
        real_exists = frappe.local.db.exists

        def blind_to_notifications(doctype, *args, **kwargs):
            # One connection cannot stage a real race, so blind the check the
            # way a concurrent writer does: it inserts the pair after this
            # caller looked and before this caller inserts. The
            # `notif_activity_user` index is then the only guard left.
            if doctype == "Drive Notification":
                return None
            return real_exists(doctype, *args, **kwargs)

        with patch.object(frappe.local.db, "exists", side_effect=blind_to_notifications):
            self.assertEqual(notify_users(activity, (OWNER,)), 0)

        self.assertEqual(
            frappe.get_all("Drive Notification", filters={"activity": activity}, pluck="name"),
            [existing],
        )
        self.assertEqual(
            [row.name for row in notifications(self.owner)["rows"] if row.activity.name == activity],
            [existing],
        )

    def test_purge_removes_notifications_before_activity_and_personal_rows(self):
        visit(self.owner, self.node)
        set_favourite(self.owner, self.node)
        activity = record(self.admin, self.node, "edit")
        notify_users(activity, (OWNER,))
        update(self.admin, self.node, state="Trashed")

        self.assertEqual(purge(self.admin, self.node), 1)
        self.assertFalse(frappe.db.exists("Drive Notification", {"activity": activity}))
        self.assertFalse(frappe.db.exists("Drive Activity", {"node": self.node}))
        self.assertFalse(frappe.db.exists("Drive Recent", {"node": self.node}))
        self.assertFalse(frappe.db.exists("Drive Favourite", {"node": self.node}))

    def test_losing_read_access_still_lets_the_owner_clear_their_own_mark(self):
        # Do not depend on the setUp grant surviving an earlier test: state the
        # Read authority this test needs, then take it away.
        grant(self.node, OTHER, READ, self.admin)
        set_favourite(self.other, self.node)
        self.assertEqual(len(favourites(self.other)["rows"]), 1)

        revoke(self.node, OTHER, self.admin)
        # The mark is now invisible, because the node is unreadable.
        self.assertEqual(favourites(self.other)["rows"], [])
        self.assertTrue(frappe.db.exists("Drive Favourite", {"user": OTHER, "node": self.node}))

        # Clearing a private mark is not a read of the node, so it still works.
        set_favourite(self.other, self.node, False)
        self.assertFalse(frappe.db.exists("Drive Favourite", {"user": OTHER, "node": self.node}))

        # Adding one back does still need Read, and an unreadable node is hidden.
        with self.assertRaises(DriveNotFound):
            set_favourite(self.other, self.node)

    def test_recents_filter_by_type_inside_the_query(self):
        # The owner's history, oldest first. The two newest visits are not
        # sheets, so an unfiltered two-row window holds no sheet at all.
        opened = [
            self.document("Sheet one", "Sheet"),
            self.document("Sheet two", "Sheet"),
            self.document("Sheet three", "Sheet"),
            self.document("Deck one", "Presentation"),
            self.document("Letter", "Writer Document"),
            self.node,
            self.document("Deck two", "Presentation"),
        ]
        for minute, node in enumerate(opened):
            self.opened(node, minute)
        newest_first = list(reversed(opened))
        sheets = [newest_first[4], newest_first[5], newest_first[6]]

        def names(page):
            return [row.node.name for row in page["rows"]]

        self.assertEqual(names(recents(self.owner, limit=2)), newest_first[:2])

        first = recents(self.owner, listing_types=("spreadsheet",), limit=2)
        self.assertEqual(names(first), sheets[:2])
        self.assertIsNotNone(first["next_cursor"])
        second = recents(self.owner, listing_types=("spreadsheet",), cursor=first["next_cursor"], limit=2)
        self.assertEqual(names(second), sheets[2:])
        self.assertIsNone(second["next_cursor"])

        self.assertEqual(
            names(recents(self.owner, listing_types=("presentation",))),
            [newest_first[0], newest_first[3]],
        )
        letters = recents(self.owner, listing_types=("document",))
        self.assertEqual(names(letters), [newest_first[2]])
        self.assertEqual(letters["rows"][0].opened_at, frappe.utils.get_datetime(self.stamp(4)))

        with self.assertRaises(frappe.ValidationError):
            recents(self.owner, listing_types=("spreadsheets",))
        self.assertEqual(names(recents(self.owner)), newest_first)

        # The view door carries the filter through to the same query.
        view = views(self.owner, "recents", listing_types=("spreadsheet",), limit=2)
        self.assertEqual([row.name for row in view["rows"]], sheets[:2])
        self.assertEqual(view["rows"][0].opened_at, frappe.utils.get_datetime(self.stamp(2)))

    def test_recents_pages_tied_visits_once_each_with_or_without_the_filter(self):
        tied = [self.document(f"Sheet {index}", "Sheet") for index in range(3)]
        for node in tied:
            self.opened(node, 7)
        self.opened(self.node, 1)
        for listing_types, expected in ((("spreadsheet",), set(tied)), ((), {*tied, self.node})):
            with self.subTest(listing_types=listing_types):
                seen, cursor = [], None
                while True:
                    page = recents(self.owner, listing_types=listing_types, cursor=cursor, limit=2)
                    seen += [row.node.name for row in page["rows"]]
                    cursor = page["next_cursor"]
                    if cursor is None:
                        break
                self.assertEqual(len(seen), len(expected))
                self.assertEqual(set(seen), expected)

    def test_recents_read_past_unreadable_rows_to_fill_a_page(self):
        # OTHER's history, newest first: readable, unreadable, readable, readable.
        readable = [self.document(f"Readable {index}", "Sheet") for index in range(3)]
        hidden = self.document("Hidden", "Sheet")
        for node in readable:
            grant(node, OTHER, READ, self.admin)
        frappe.db.delete("Drive Recent", {"user": OTHER})
        for minute, node in enumerate((readable[2], readable[1], hidden, readable[0])):
            self.opened(node, minute, user=OTHER)
        for listing_types in (("spreadsheet",), ()):
            with self.subTest(listing_types=listing_types):
                first = recents(self.other, listing_types=listing_types, limit=2)
                self.assertEqual([row.node.name for row in first["rows"]], readable[:2])
                second = recents(self.other, listing_types=listing_types, cursor=first["next_cursor"], limit=2)
                self.assertEqual([row.node.name for row in second["rows"]], readable[2:])
                self.assertIsNone(second["next_cursor"])

    def test_recents_stop_after_a_bounded_number_of_windows(self):
        from suite.drive._core.activity import MAX_RECENT_WINDOWS

        frappe.db.delete("Drive Recent", {"user": OTHER})
        readable = self.document("Readable", "Sheet")
        grant(readable, OTHER, READ, self.admin)
        self.opened(readable, 0, user=OTHER)
        for minute in range(1, MAX_RECENT_WINDOWS + 2):
            self.opened(self.document(f"Hidden {minute}", "Sheet"), minute, user=OTHER)

        first = recents(self.other, listing_types=("spreadsheet",), limit=1)
        self.assertEqual(first["rows"], [])
        self.assertIsNotNone(first["next_cursor"])
        second = recents(self.other, listing_types=("spreadsheet",), cursor=first["next_cursor"], limit=1)
        self.assertEqual([row.node.name for row in second["rows"]], [readable])

    def test_a_trashed_node_and_its_contents_refuse_writes_but_can_lose_access(self):
        # §4.2 and §8.8: a trashed node is read-only until it is restored. Its
        # contents are trashed with it, so they refuse the same writes.
        inside = create_folder(self.owner, self.node, "Inside")
        elsewhere = create_folder(self.owner, self.root.name, "Elsewhere")
        set_favourite(self.owner, self.node)
        grant(self.node, OTHER, EDIT, self.owner)
        update(self.owner, self.node, state="Trashed")

        for trashed in (self.node, inside):
            writes = {
                "rename": lambda: update(self.owner, trashed, title="Renamed"),
                "move": lambda: update(self.owner, trashed, parent=elsewhere),
                "copy": lambda: copy(self.owner, trashed, elsewhere),
                "share": lambda: grant(trashed, OUTSIDER, READ, self.owner),
                "star": lambda: set_favourite(self.owner, trashed),
            }
            for name, write in writes.items():
                with self.subTest(node=trashed, write=name), self.assertRaises(DriveForbidden):
                    write()
        self.assertFalse(frappe.db.exists("Drive Grant", {"principal": OUTSIDER}))
        self.assertFalse(frappe.db.exists("Drive Favourite", {"node": inside}))

        # A grant may not raise a role, or rewrite it unchanged.
        for role in (MANAGE, EDIT):
            with self.subTest(role=role), self.assertRaises(DriveForbidden):
                grant(self.node, OTHER, role, self.owner)
        self.assertEqual(self.role_of(OTHER), EDIT)

        # Taking access away, or the owner's own star, is still allowed:
        # lowering a role, denying, revoking, and unstarring.
        grant(self.node, OTHER, READ, self.owner)
        self.assertEqual(self.role_of(OTHER), READ)
        grant(self.node, OUTSIDER, NONE, self.owner)
        self.assertEqual(self.role_of(OUTSIDER), NONE)
        revoke(self.node, OTHER, self.owner)
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.node, "principal": OTHER}))
        set_favourite(self.owner, self.node, False)
        self.assertFalse(frappe.db.exists("Drive Favourite", {"node": self.node}))

    def role_of(self, principal: str) -> int:
        return frappe.db.get_value("Drive Grant", {"node": self.node, "principal": principal}, "role")

    def test_recents_leave_out_trashed_nodes(self):
        kept = self.document("Kept", "Sheet")
        trashed = self.document("Trashed", "Sheet")
        self.opened(kept, 0)
        self.opened(trashed, 1)
        frappe.db.set_value("Drive Node", trashed, "state", "Trashed", update_modified=False)
        for listing_types in (("spreadsheet",), ()):
            with self.subTest(listing_types=listing_types):
                page = recents(self.owner, listing_types=listing_types)
                names = [row.node.name for row in page["rows"]]
                self.assertIn(kept, names)
                self.assertNotIn(trashed, names)

    def document(self, title: str, content_doctype: str) -> str:
        """Insert a document node directly; `create_document` needs an active content type."""
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": title,
                    "parent": self.root.name,
                    "root": self.root.name,
                    "path": "",
                    "kind": "document",
                    "content_doctype": content_doctype,
                    "content_docname": f"recents-{frappe.generate_hash(length=8)}",
                    "state": "Active",
                    "size": 0,
                    "is_template": 0,
                }
            )
            .insert(ignore_permissions=True, ignore_links=True)
            .name
        )

    def opened(self, node: str, minute: int, user: str = OWNER) -> None:
        frappe.get_doc(
            {"doctype": "Drive Recent", "user": user, "node": node, "opened_at": self.stamp(minute)}
        ).insert(ignore_permissions=True)

    @staticmethod
    def stamp(minute: int) -> str:
        return f"2026-09-15 12:{minute:02d}:00"
