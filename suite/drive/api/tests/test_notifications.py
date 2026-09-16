"""The legacy `api/notifications` surface, against the inbox it now answers about.

§11.7 forwards `get_notifications`, `get_unread_count`, and `mark_as_read` into
`_core.activity`, where a `Drive Notification` is a pointer at a `Drive
Activity` row (§9.5). The suite this replaces built one row by hand with
`to_user`, `from_user`, `message`, and no pointer, so the workflow dropped it
and `mark_as_read` had nothing to mark.

Two inboxes are covered here, because two exist:

- **Pointer rows**, written by `_core.activity.notify_users`. `access.grant`
  writes one, and that is the fixture the share cases use.
- **Pointerless rows**, written by `api.notifications.create_notification`.
  Every row a site held before Build is one, and the path is still live: the
  legacy Writer comment mention goes through it, and so does the folder share
  every new `User` gets. §14 drops them at Build and starts the inbox empty,
  but Build has not run and the writers still run, so the legacy names answer
  for them until Cleanup deletes the shim and the writers together.
"""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive._core.access import grant, revoke
from suite.drive._core.nodes import create_folder
from suite.drive._core.roles import READ
from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.api.notifications import (
    create_notification,
    get_notifications,
    get_unread_count,
    mark_as_read,
    send_share_email,
)
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import drop_node_rows, drop_record_rows, nodes_in_root
from suite.drive.utils import create_drive_file, get_user_folder
from suite.tests.utils import ensure_user

RECIPIENT = "drive-notifications-recipient@example.com"
OTHER_USER = "drive-notifications-other@example.com"


class TestShareEmail(UnitTestCase):
    @patch("suite.drive.api.notifications.drive_logo_inline_images", return_value=[])
    @patch("suite.drive.api.notifications.frappe.sendmail")
    def test_send_share_email_queues_email(self, sendmail, _inline_images):
        send_share_email("user@example.com", "A file was shared", "/drive/file-1", "file")

        sendmail.assert_called_once()
        self.assertNotIn("now", sendmail.call_args.kwargs)


class NotificationCase(IntegrationTestCase):
    """One folder in the sender's own Personal root, and a clean inbox around it.

    `IntegrationTestCase` rolls back at class cleanup, not per test, so each
    case drops the nodes, the activity, and the notification rows it added.
    The pointerless rows are keyed by nothing but `to_user`, so they are
    tracked by id.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(RECIPIENT)
        ensure_user(OTHER_USER)

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self.home = personal_root_for(OTHER_USER) or provision_personal_root(OTHER_USER)
        provision_personal_root(RECIPIENT)
        self.sender = principals_for(OTHER_USER)
        self.recipient = principals_for(RECIPIENT)
        self.nodes_before = nodes_in_root(self.home)
        self.legacy_rows: list[str] = []
        self.folder = create_folder(self.sender, self.home, f"notif-{frappe.generate_hash(6)}")

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in self.legacy_rows:
            frappe.db.delete("Drive Notification", {"name": name})
        created = nodes_in_root(self.home) - self.nodes_before
        drop_record_rows(created)
        drop_node_rows(created)
        super().tearDown()

    def share(self, user: str = RECIPIENT, node: str | None = None) -> str:
        """Share a node and answer the pointer row the share wrote.

        `access.grant` records `share_add` and calls `notify_users`, which is
        the only writer of a pointer row on the share path.
        """
        grant(node or self.folder, user, READ, self.sender)
        activity = frappe.get_all(
            "Drive Activity",
            filters={"node": node or self.folder, "action": "share_add"},
            pluck="name",
            order_by="creation desc",
            limit=1,
        )
        return frappe.db.get_value("Drive Notification", {"activity": activity[0], "to_user": user}, "name")

    def legacy_file(self, owner: str = RECIPIENT):
        """One `File` row of the kind the pointerless writers still notify about.

        `Drive Notification.notif_doctype_name` is a Dynamic Link, so a
        pointerless row cannot name a file that is not there. `get_user_folder`
        is the legacy provisioning path, which is one of the writers.
        """
        with self.set_user(owner):
            home = get_user_folder(owner).name
            file = create_drive_file(
                f"{frappe.generate_hash(8)}.txt",
                home,
                "Text",
                f"/files/{frappe.generate_hash(8)}.txt",
                "text/plain",
                12,
            )
        self.addCleanup(frappe.delete_doc, "File", file.name, force=1, ignore_permissions=True)
        return file

    def pointerless(self, to_user: str = RECIPIENT, **fields) -> str:
        """One row in the shape `create_notification` writes: no activity pointer."""
        file = fields.pop("file", None) or self.legacy_file(to_user)
        row = frappe.get_doc(
            {
                "doctype": "Drive Notification",
                "to_user": to_user,
                "from_user": OTHER_USER,
                "type": "Share",
                "entity_type": "File",
                "notif_doctype": "File",
                "notif_doctype_name": file.name,
                "message": f'Someone shared a file with you: "{file.file_name}"',
                "read": 0,
                **fields,
            }
        ).insert(ignore_permissions=True)
        self.legacy_rows.append(row.name)
        return row.name

    def inbox(self, user: str, only_unread: bool = False) -> list[dict]:
        with self.set_user(user):
            return get_notifications(only_unread=only_unread)

    def read_flag(self, name: str):
        return frappe.db.get_value("Drive Notification", name, "read")


class TestLegacyNotificationsAPI(NotificationCase):
    def test_a_share_reaches_the_recipient_as_a_flat_row(self):
        notification = self.share()
        rows = [row for row in self.inbox(RECIPIENT) if row["name"] == notification]

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["to_user"], RECIPIENT)
        self.assertEqual(row["from_user"], OTHER_USER)
        self.assertEqual(row["type"], "Share")
        # `Notifications.vue` pushes `drive-` + `entity_type` and passes
        # `notif_doctype_name` as the route's `entityName`.
        self.assertEqual(row["entity_type"], "Folder")
        self.assertEqual(row["notif_doctype"], "Drive Node")
        self.assertEqual(row["notif_doctype_name"], self.folder)
        self.assertEqual(row["read"], 0)
        # The row's only text on the page. §9.5 stores no message, so the
        # sentence is rebuilt from the action, the title, and the sender.
        self.assertIn("shared a folder with you", row["message"])

    def test_every_row_carries_the_columns_the_old_query_selected(self):
        self.share()
        expected = {
            "name",
            "to_user",
            "from_user",
            "read",
            "type",
            "message",
            "entity_type",
            "notif_doctype",
            "notif_doctype_name",
            "creation",
            "full_name",
            "user_image",
        }
        for row in self.inbox(RECIPIENT):
            self.assertEqual(set(row), expected)

    def test_only_unread_leaves_out_a_row_the_caller_cleared(self):
        notification = self.share()
        with self.set_user(RECIPIENT):
            mark_as_read(name=notification)

        unread = [row["name"] for row in self.inbox(RECIPIENT, only_unread=True)]
        every = [row["name"] for row in self.inbox(RECIPIENT)]
        self.assertNotIn(notification, unread)
        self.assertIn(notification, every)

    def test_a_row_addressed_to_somebody_else_is_never_listed(self):
        notification = self.share()
        self.assertNotIn(notification, [row["name"] for row in self.inbox(OTHER_USER)])

    def test_a_row_about_a_node_the_caller_lost_is_dropped(self):
        """The one place the forwarder is deliberately tighter than the old query.

        Legacy selected the row whatever happened to the file afterwards.
        `_visible_notifications` re-checks Read, so a revoked share stops
        naming a node the caller can no longer open.
        """
        notification = self.share()
        self.assertIn(notification, [row["name"] for row in self.inbox(RECIPIENT)])

        revoke(self.folder, RECIPIENT, self.sender)
        self.assertNotIn(notification, [row["name"] for row in self.inbox(RECIPIENT)])
        with self.set_user(RECIPIENT):
            self.assertEqual(get_unread_count(), 0)

    def test_the_badge_is_a_scalar_of_the_callers_own_unread_rows(self):
        second = create_folder(self.sender, self.home, f"notif-{frappe.generate_hash(6)}")
        self.share()
        self.share(node=second)

        with self.set_user(RECIPIENT):
            count = get_unread_count()
        self.assertIsInstance(count, int)
        self.assertEqual(count, 2)


class TestMarkAsRead(NotificationCase):
    def test_recipient_can_mark_own_notification_as_read(self):
        notification = self.share()
        with self.set_user(RECIPIENT):
            self.assertIsNone(mark_as_read(name=notification))

        self.assertTrue(self.read_flag(notification))

    def test_other_user_cannot_mark_notification_as_read(self):
        notification = self.share()
        with self.set_user(OTHER_USER):
            mark_as_read(name=notification)

        self.assertFalse(self.read_flag(notification))

    def test_mark_all_only_touches_own_notifications(self):
        notification = self.share()
        with self.set_user(OTHER_USER):
            mark_as_read(all=True)

        self.assertFalse(self.read_flag(notification))

    def test_mark_all_clears_every_row_the_caller_holds(self):
        second = create_folder(self.sender, self.home, f"notif-{frappe.generate_hash(6)}")
        first = self.share()
        other = self.share(node=second)

        with self.set_user(RECIPIENT):
            mark_as_read(all=True)
            self.assertEqual(get_unread_count(), 0)
        self.assertTrue(self.read_flag(first))
        self.assertTrue(self.read_flag(other))

    def test_naming_nothing_stays_a_no_op(self):
        """The old body wrote a filter that matched nothing and said nothing."""
        notification = self.share()
        with self.set_user(RECIPIENT):
            self.assertIsNone(mark_as_read())

        self.assertFalse(self.read_flag(notification))


class TestLegacyPointerlessInbox(NotificationCase):
    """The rows §9.5's pointer cannot express, still answered by the legacy names.

    `_visible_notifications` reads `row.activity` and drops a row without one,
    so forwarding alone hid every one of these: a blank page, a zero badge, and
    a `mark_as_read` that wrote nothing.
    """

    def test_a_pointerless_row_is_listed_with_the_words_it_was_written_with(self):
        file = self.legacy_file()
        name = self.pointerless(file=file)
        rows = [row for row in self.inbox(RECIPIENT) if row["name"] == name]

        self.assertEqual(len(rows), 1)
        row = rows[0]
        # Nothing is rebuilt: this sentence was rendered by the old writer, not
        # by §9.5's action vocabulary.
        self.assertEqual(row["message"], f'Someone shared a file with you: "{file.file_name}"')
        self.assertEqual(row["type"], "Share")
        self.assertEqual(row["entity_type"], "File")
        self.assertEqual(row["notif_doctype"], "File")
        self.assertEqual(row["notif_doctype_name"], file.name)
        self.assertEqual(row["from_user"], OTHER_USER)
        self.assertEqual(row["read"], 0)

    def test_a_pointerless_row_is_counted_by_the_badge(self):
        self.pointerless()
        self.pointerless()
        with self.set_user(RECIPIENT):
            self.assertEqual(get_unread_count(), 2)

    def test_a_recipient_can_clear_a_pointerless_row(self):
        name = self.pointerless()
        with self.set_user(RECIPIENT):
            self.assertIsNone(mark_as_read(name=name))
            self.assertEqual(get_unread_count(), 0)

        self.assertTrue(self.read_flag(name))
        self.assertNotIn(name, [row["name"] for row in self.inbox(RECIPIENT, only_unread=True)])

    def test_marking_everything_clears_a_pointerless_row_too(self):
        """The badge only reaches zero if `all` reaches both inboxes."""
        pointer = self.share()
        name = self.pointerless()
        with self.set_user(RECIPIENT):
            mark_as_read(all=True)
            self.assertEqual(get_unread_count(), 0)

        self.assertTrue(self.read_flag(pointer))
        self.assertTrue(self.read_flag(name))

    def test_another_user_cannot_clear_a_pointerless_row(self):
        name = self.pointerless()
        with self.set_user(OTHER_USER):
            mark_as_read(name=name)
            mark_as_read(all=True)

        self.assertFalse(self.read_flag(name))

    def test_the_two_inboxes_arrive_as_one_list_newest_first(self):
        """The old query ordered the whole table by `creation desc`.

        Two lists one after the other would put every pointerless row below
        every pointer row, whatever the dates on them say.
        """
        pointer = self.share()
        older = self.pointerless()
        frappe.db.set_value("Drive Notification", older, "creation", "2020-01-01 00:00:00")
        newer = self.pointerless()
        frappe.db.set_value("Drive Notification", newer, "creation", "2099-01-01 00:00:00")

        listed = [row["name"] for row in self.inbox(RECIPIENT) if row["name"] in (pointer, older, newer)]
        self.assertEqual(listed, [newer, pointer, older])

    def test_the_writer_comment_path_writes_a_row_the_legacy_names_still_answer(self):
        """`create_notification` is the live writer, not a shape invented here.

        `writer_document.notify_comments` calls it for every mention in a
        legacy document's comments, and `Drive Permission.after_insert` calls
        it through `notify_share` for the folder every new `User` is given.
        Neither writes an activity pointer.
        """
        file = self.legacy_file()
        self.assertTrue(
            create_notification(
                OTHER_USER,
                RECIPIENT,
                "Mention",
                file,
                f"You were mentioned in a comment in: {file.file_name}",
            )
        )
        name = frappe.db.get_value(
            "Drive Notification", {"to_user": RECIPIENT, "notif_doctype_name": file.name}, "name"
        )
        self.legacy_rows.append(name)

        rows = [row for row in self.inbox(RECIPIENT) if row["name"] == name]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message"], f"You were mentioned in a comment in: {file.file_name}")
        with self.set_user(RECIPIENT):
            self.assertEqual(get_unread_count(), 1)
            mark_as_read(name=name)
            self.assertEqual(get_unread_count(), 0)
        self.assertTrue(self.read_flag(name))
