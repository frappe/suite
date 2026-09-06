# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt
"""`check_collab_access` on a sheet Drive owns (ticket 19, §6.7).

Everything here is the Drive-native side of the endpoint. The legacy side —
cookie auth, Guest refused, Frappe's own read/write split — stays in
`suite.sheets.tests.test_collab`, and the two together are the whole endpoint.

No database. `suite.sheets.collab.drive` is replaced with a stub that answers a
role ladder, so each test states one caller's role at the node and asserts
exactly what the collab server is told. That is the contract: the ladder decides
the capability, the answer states the recheck cadence, and a Guest's identity is
the server's to choose.

The five-minute loop that consumes these answers is tested in
`suite/sheets/collab-server/test/access-recheck.test.js` with injected time.
"""

from __future__ import annotations

import unittest
from unittest import mock

from suite.sheets import collab

NODE = "NODE-1"
SHEET = "SH-1"

_ALICE = {"full_name": "Alice Adams", "initials": "AA", "user_image": "/files/alice.png"}

# The ladder, as `suite.drive` publishes it.
NONE, READ, COMMENT, UPLOAD, EDIT, MANAGE = 0, 10, 20, 30, 40, 50


class _DriveError(Exception):
    """Stands in for `suite.drive.DriveError` without importing the package."""


class _DriveForbidden(_DriveError):
    pass


class _DriveNotFound(_DriveError):
    pass


class _DriveLinkExpired(_DriveError):
    pass


class _DriveLocked(_DriveError):
    pass


def _drive_at(role: int, refusal=_DriveNotFound):
    """A `suite.drive` stub whose caller holds `role` at every node.

    `refusal` is the error Drive raises when the caller is below READ, which is
    what tells a revoked grant from an expired link on the wire.
    """
    stub = mock.MagicMock()
    stub.READ, stub.COMMENT, stub.UPLOAD, stub.EDIT, stub.MANAGE = READ, COMMENT, UPLOAD, EDIT, MANAGE
    stub.DriveError = _DriveError

    def check(node, need):
        if role >= need:
            return None
        raise (refusal if need <= READ else _DriveForbidden)("refused")

    stub.check.side_effect = check
    return stub


def _patched_frappe(node: str | None = NODE, user: str = "alice@example.com"):
    """Replace `suite.sheets.collab.frappe` — these tests never touch a database.

    `db.get_value` answers the sheet's node column, which is the one read that
    chooses which side of the split the endpoint answers on.
    """
    patcher = mock.patch("suite.sheets.collab.frappe")
    frappe = patcher.start()
    frappe.session.user = user
    frappe.db.get_value.return_value = node
    frappe.AuthenticationError = type("AuthenticationError", (Exception,), {})
    frappe.throw.side_effect = lambda msg, exc=Exception: (_ for _ in ()).throw(exc(msg))
    return frappe, patcher


class _AccessCase(unittest.TestCase):
    """One linked sheet, one caller, and a stubbed Drive."""

    def answer(self, role: int, *, user: str = "alice@example.com", refusal=_DriveNotFound) -> dict:
        self.drive = _drive_at(role, refusal)
        frappe, patcher = _patched_frappe(user=user)
        self.addCleanup(patcher.stop)
        with (
            mock.patch.object(collab, "drive", self.drive),
            mock.patch.object(collab, "_user_identity") as identity,
        ):
            identity.return_value = {
                "full_name": "Alice Adams",
                "initials": "AA",
                "user_image": "/files/alice.png",
            }
            return collab.check_collab_access(SHEET)


class TheRoleLadder(_AccessCase):
    """EDIT writes, READ or COMMENT reads, anything lower is refused (§6.7)."""

    def test_edit_may_write(self):
        answer = self.answer(EDIT)
        self.assertTrue(answer["canRead"])
        self.assertTrue(answer["canWrite"])

    def test_manage_may_write(self):
        self.assertTrue(self.answer(MANAGE)["canWrite"])

    def test_read_connects_but_may_not_write(self):
        answer = self.answer(READ)
        self.assertTrue(answer["canRead"])
        self.assertFalse(answer["canWrite"])

    def test_comment_connects_but_may_not_write(self):
        answer = self.answer(COMMENT)
        self.assertTrue(answer["canRead"])
        self.assertFalse(answer["canWrite"])

    def test_upload_connects_read_only_because_it_does_not_write_a_body(self):
        """UPLOAD sits between COMMENT and EDIT and places nodes, not cells."""
        answer = self.answer(UPLOAD)
        self.assertTrue(answer["canRead"])
        self.assertFalse(answer["canWrite"])

    def test_below_read_is_refused(self):
        answer = self.answer(NONE)
        self.assertFalse(answer["canRead"])
        self.assertFalse(answer["canWrite"])

    def test_a_refusal_carries_no_identity_at_all(self):
        answer = self.answer(NONE)
        self.assertNotIn("user", answer)
        self.assertNotIn("fullName", answer)

    def test_the_write_question_is_asked_against_edit_and_nothing_lower(self):
        self.answer(EDIT)
        self.assertEqual(
            [call.args for call in self.drive.check.call_args_list],
            [(NODE, READ), (NODE, EDIT)],
        )

    def test_a_refused_caller_is_never_asked_about_writing(self):
        self.answer(NONE)
        self.assertEqual([call.args for call in self.drive.check.call_args_list], [(NODE, READ)])


class WhyItWasRefused(_AccessCase):
    """A revoked grant, an expired link, and a locked link are told apart."""

    def test_a_revoked_grant_reads_as_not_found_because_drive_masks_it(self):
        self.assertEqual(self.answer(NONE)["reason"], "_DriveNotFound")

    def test_an_expired_link_says_so(self):
        self.assertEqual(self.answer(NONE, refusal=_DriveLinkExpired)["reason"], "_DriveLinkExpired")

    def test_a_link_that_needs_a_password_says_so(self):
        self.assertEqual(self.answer(NONE, refusal=_DriveLocked)["reason"], "_DriveLocked")


class TheRecheckContract(_AccessCase):
    """Access is not decided once (§6.7)."""

    def test_it_is_five_minutes(self):
        self.assertEqual(collab.RECHECK_SECONDS, 300)

    def test_a_grant_states_the_cadence(self):
        self.assertEqual(self.answer(EDIT)["recheckSeconds"], collab.RECHECK_SECONDS)

    def test_a_refusal_states_it_too(self):
        self.assertEqual(self.answer(NONE)["recheckSeconds"], collab.RECHECK_SECONDS)


class GuestIdentity(_AccessCase):
    """A link proves a capability, never an identity."""

    def test_a_guest_holding_a_link_may_connect(self):
        answer = self.answer(READ, user="Guest")
        self.assertTrue(answer["canRead"])
        self.assertFalse(answer["canWrite"])

    def test_a_guest_holding_an_edit_link_may_write(self):
        self.assertTrue(self.answer(EDIT, user="Guest")["canWrite"])

    def test_a_guest_is_named_by_the_server_and_nothing_else(self):
        answer = self.answer(READ, user="Guest")
        self.assertTrue(answer["isGuest"])
        self.assertEqual(answer["user"], "Guest")
        self.assertEqual(answer["fullName"], collab.GUEST_LABEL)
        self.assertEqual(answer["initials"], "G")
        self.assertEqual(answer["userImage"], "")

    def test_a_guest_never_reaches_the_user_table(self):
        """There is nothing to look up: no `User` row, and nothing they may say."""
        _frappe, patcher = _patched_frappe(user="Guest")
        self.addCleanup(patcher.stop)
        with (
            mock.patch.object(collab, "drive", _drive_at(READ)),
            mock.patch.object(collab, "_user_identity") as identity,
        ):
            collab.check_collab_access(SHEET)
        identity.assert_not_called()

    def test_a_signed_in_caller_keeps_their_real_identity(self):
        answer = self.answer(EDIT)
        self.assertFalse(answer["isGuest"])
        self.assertEqual(answer["user"], "alice@example.com")
        self.assertEqual(answer["fullName"], "Alice Adams")
        self.assertEqual(answer["initials"], "AA")
        self.assertEqual(answer["userImage"], "/files/alice.png")


class TheTwoSides(unittest.TestCase):
    """The node column is what chooses the answer, and nothing else."""

    def test_a_linked_sheet_never_asks_frappe_has_permission(self):
        """`DocShare` cannot open a sheet Drive owns (§1)."""
        frappe, patcher = _patched_frappe()
        self.addCleanup(patcher.stop)
        with (
            mock.patch.object(collab, "drive", _drive_at(EDIT)),
            mock.patch.object(collab, "_user_identity", return_value=_ALICE),
        ):
            collab.check_collab_access(SHEET)
        frappe.has_permission.assert_not_called()

    def test_a_legacy_sheet_never_asks_drive(self):
        frappe, patcher = _patched_frappe(node=None)
        self.addCleanup(patcher.stop)
        frappe.has_permission.return_value = True
        drive = mock.MagicMock()
        drive.DriveError = _DriveError
        with (
            mock.patch.object(collab, "drive", drive),
            mock.patch.object(collab, "_user_identity", return_value=_ALICE),
        ):
            answer = collab.check_collab_access(SHEET)
        drive.check.assert_not_called()
        self.assertTrue(answer["canRead"])

    def test_a_legacy_sheet_still_refuses_guest(self):
        """A legacy row has no link grant to hold, so there is nothing to check."""
        frappe, patcher = _patched_frappe(node=None, user="Guest")
        self.addCleanup(patcher.stop)
        with self.assertRaises(frappe.AuthenticationError):
            collab.check_collab_access(SHEET)


if __name__ == "__main__":
    unittest.main()
