# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.tests import UnitTestCase

from suite.calendar.sharing import RIGHTS, ROLES, holds_any_right, may_share, rights_for_role, role_for_rights


class TestSharingRoles(UnitTestCase):
    """The two roles the app offers, against what they are supposed to grant.

    Stated as what a reader may do, not as the mapping read back out of the module: a role that
    quietly gained a write would still round-trip.
    """

    def test_view_shows_the_events(self):
        rights = rights_for_role("view")
        self.assertTrue(rights["mayReadFreeBusy"])
        self.assertTrue(rights["mayReadItems"])

    def test_no_role_grants_a_write_or_the_right_to_share_on(self):
        for role in ROLES:
            rights = rights_for_role(role)
            for right in ("mayWriteAll", "mayWriteOwn", "mayUpdatePrivate", "mayRSVP", "mayDelete"):
                self.assertFalse(rights[right], msg=f"{role} grants {right}")
            self.assertFalse(rights["mayShare"], msg=f"{role} lets the reader share it on")

    def test_a_role_states_every_right(self):
        # A right left out of a shareWith entry is not a right left alone, so each role names all.
        self.assertEqual(set(rights_for_role("view")), set(RIGHTS))

    def test_an_unknown_role_is_refused(self):
        self.assertRaises(ValueError, rights_for_role, "editor")
        self.assertRaises(ValueError, rights_for_role, "free-busy")

    def test_a_role_is_read_back_as_itself(self):
        for role in ROLES:
            self.assertEqual(role_for_rights(rights_for_role(role)), role)

    def test_a_server_that_omits_the_rights_it_withholds_reads_the_same(self):
        self.assertEqual(role_for_rights({"mayReadFreeBusy": True, "mayReadItems": True}), "view")

    def test_rights_no_role_describes_are_custom(self):
        # Granted by another CalDAV client or an administrator: shown, and never rewritten.
        self.assertIsNone(role_for_rights({"mayReadItems": True, "mayWriteAll": True}))
        # Free/busy alone: a right JMAP has and this app does not offer, since a reader granted
        # it is shown nothing here. Kept as it was found, like any other.
        self.assertIsNone(role_for_rights({"mayReadFreeBusy": True}))
        # Read the events but not the free-busy: expressible, and not the one answer here.
        self.assertIsNone(role_for_rights({"mayReadItems": True}))
        self.assertIsNone(role_for_rights({}))
        self.assertIsNone(role_for_rights(None))

    def test_a_sharee_granted_nothing_is_not_shared_with(self):
        # An entry another client left behind with every right off: not Custom, just nothing.
        self.assertFalse(holds_any_right({}))
        self.assertFalse(holds_any_right({right: False for right in RIGHTS}))
        self.assertFalse(holds_any_right(None))
        self.assertTrue(holds_any_right({"mayReadFreeBusy": True}))

    def test_who_may_share_is_read_under_either_name(self):
        # Stalwart says mayShare; the JMAP calendars draft says mayAdmin.
        self.assertTrue(may_share({"mayShare": True}))
        self.assertTrue(may_share({"mayAdmin": True}))
        self.assertFalse(may_share({"mayShare": False, "mayAdmin": False}))
        self.assertFalse(may_share({"mayWriteAll": True}))
        self.assertFalse(may_share(None))
