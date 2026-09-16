# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase, UnitTestCase

from suite.drive.doctype.drive_permission.drive_permission import DrivePermission
from suite.tests.utils import ensure_user

# On IntegrationTestCase, the doctype test records and all
# link-field test record dependencies are recursively loaded
# Use these module variables to add/remove to/from that list
EXTRA_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]
IGNORE_TEST_RECORD_DEPENDENCIES = []  # eg. ["User"]

QUEUE_FULL = "Too many queued background jobs (550)."


def saturated_short_queue():
    """Refuse every enqueue that reaches the depth check, as a full queue does.

    Patching `_check_queue_size` rather than `frappe.enqueue` keeps the
    refusal where production puts it. Callers that pass `now=True` — Frappe's
    own `create_contact` on `User.on_update` — short-circuit before the check
    and still run, so a test may create a user under this block.
    """
    return patch(
        "frappe.utils.background_jobs._check_queue_size",
        side_effect=frappe.QueueOverloaded(QUEUE_FULL),
    )


class UnitTestDrivePermission(UnitTestCase):
    """
    Unit tests for DrivePermission.
    Use this class for testing individual functions and methods.
    """

    @patch("suite.drive.doctype.drive_permission.drive_permission.frappe.enqueue")
    def test_after_insert_enqueues_share_notification(self, enqueue):
        permission = DrivePermission(
            {
                "doctype": "Drive Permission",
                "name": "permission-1",
                "entity": "file-1",
                "user": "user@example.com",
            }
        )

        permission.after_insert()

        enqueue.assert_called_once()
        self.assertNotIn("now", enqueue.call_args.kwargs)
        self.assertTrue(enqueue.call_args.kwargs["enqueue_after_commit"])

    @patch("suite.drive.doctype.drive_permission.drive_permission.frappe.log_error")
    @patch("suite.drive.doctype.drive_permission.drive_permission.frappe.enqueue")
    def test_a_refused_queue_is_logged_and_not_raised(self, enqueue, log_error):
        """A saturated short queue must not reach the caller.

        `frappe.enqueue` measures the depth inline, so `QueueOverloaded` lands
        inside the insert of this row and would roll the grant back. The grant
        is durable and already in effect; only the notice is lost.
        """
        permission = DrivePermission(
            {
                "doctype": "Drive Permission",
                "name": "permission-1",
                "entity": "file-1",
                "user": "user@example.com",
            }
        )
        enqueue.side_effect = frappe.QueueOverloaded(QUEUE_FULL)

        permission.after_insert()

        enqueue.assert_called_once()
        log_error.assert_called_once()
        self.assertIn("share notification", log_error.call_args.args[0])


class IntegrationTestDrivePermission(IntegrationTestCase):
    """
    Integration tests for DrivePermission.
    Use this class for testing interactions between multiple components.
    """

    def test_a_refused_queue_still_writes_an_ordinary_share(self):
        """The share survives a full short queue; only the notice is lost."""
        owner = "queue-full-owner@example.com"
        grantee = "queue-full-grantee@example.com"
        ensure_user(owner)
        ensure_user(grantee)
        folder = frappe.db.get_value("Drive Settings", owner, "user_folder")

        with (
            saturated_short_queue(),
            patch("suite.drive.doctype.drive_permission.drive_permission.frappe.log_error") as log_error,
        ):
            permission = frappe.get_doc(
                {
                    "doctype": "Drive Permission",
                    "entity": folder,
                    "user": grantee,
                    "read": 1,
                }
            ).insert(ignore_permissions=True)

        self.assertTrue(frappe.db.exists("Drive Permission", permission.name))
        log_error.assert_called_once()

    def test_a_refused_queue_still_creates_the_user_and_their_home_folder(self):
        """User provisioning must not depend on the job queue.

        `ensure_user` and every real signup reach `install.after_user_insert`,
        which grants the new user their own home folder. That grant's
        `after_insert` enqueues the share notice, so a strict enqueue made a
        full queue refuse every new user on the site.
        """
        email = "queue-full-newcomer@example.com"
        with (
            saturated_short_queue(),
            patch("suite.drive.doctype.drive_permission.drive_permission.frappe.log_error"),
        ):
            ensure_user(email)

        self.assertTrue(frappe.db.exists("User", email))
        folder = frappe.db.get_value("Drive Settings", email, "user_folder")
        self.assertTrue(folder)
        self.assertTrue(frappe.db.exists("Drive Permission", {"entity": folder, "user": email}))
