"""Seed and reset the Northwind demo on a real site, without a mail server."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import content
from suite.composition.demo import drive as demo
from suite.composition.demo.cast import PEOPLE, email_of
from suite.drive import MANAGE, READ
from suite.drive._core.access import effective_role
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import drop_root
from suite.suite_core import storage
from suite.writer.content import APP

EMAILS = [person.email for person in PEOPLE]
BRANDING = {"workspace_name": "Before Northwind", "workspace_logo": "/files/before-northwind.png"}


def branding() -> dict:
    return {field: frappe.db.get_single_value("Suite Settings", field) for field in BRANDING}


def active_shared_root() -> str | None:
    return frappe.db.get_value("Drive Root", {"kind": "Shared", "state": "Active"})


def node_titled(title: str) -> frappe._dict:
    return frappe.db.get_value(
        "Drive Node",
        {"title": title, "owner": ["in", EMAILS]},
        ["name", "root", "path", "kind"],
        as_dict=True,
    )


def restore_branding(previous: dict) -> None:
    frappe.db.set_single_value("Suite Settings", previous)
    frappe.db.commit()


def drop_shared_root() -> None:
    if root := active_shared_root():
        drop_root(root)
    frappe.db.commit()


def reset_demo() -> None:
    frappe.set_user("Administrator")
    demo.reset()


class TestDemoSeed(IntegrationTestCase):
    def setUp(self):
        if frappe.db.exists("User", {"name": ["in", EMAILS]}):
            self.skipTest("This site holds Northwind accounts, and the test would remove them")
        patcher = patch.dict(frappe.local.conf, {"mail": None})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(restore_branding, branding())
        if not active_shared_root():
            self.addCleanup(drop_shared_root)
        self.addCleanup(reset_demo)
        frappe.db.set_single_value("Suite Settings", BRANDING)
        frappe.db.commit()

    def test_seed_fills_the_site_and_reset_removes_it(self):
        frappe.set_user("Guest")
        demo.seed()
        self.assertEqual(frappe.session.user, "Guest")
        frappe.set_user("Administrator")

        welcome = content.find(APP, node_titled("Welcome to Northwind").name)
        self.assertEqual(welcome.head_rev, 1)
        self.assertIn("Welcome to Northwind Labs", content.readable_copy(APP, welcome.id))

        brief = node_titled("Beacon beta launch brief")
        self.assertEqual(effective_role(brief, principals_for("Guest")), READ)
        self.assertEqual(effective_role(brief, principals_for(email_of("leo"))), READ)
        self.assertEqual(effective_role(brief, principals_for(email_of("theo"))), MANAGE)

        frappe.set_user("Guest")
        demo.reset()
        self.assertEqual(frappe.session.user, "Guest")
        frappe.set_user("Administrator")

        self.assertEqual(branding(), BRANDING)
        self.assertFalse(frappe.db.exists("User", {"name": ["in", EMAILS]}))
        self.assertFalse(frappe.db.exists("Contact Email", {"email_id": ["in", EMAILS]}))
        self.assertFalse(frappe.db.exists("Drive Node", {"owner": ["in", EMAILS]}))
        self.assertFalse(frappe.db.exists("Drive Root", {"user": ["in", EMAILS]}))
        groups = [demo.PREFIX + team for team in demo.TEAMS]
        self.assertFalse(frappe.db.exists("User Group", {"name": ["in", groups]}))
        _doc, policy, _measurements = storage.state()
        self.assertFalse(set(EMAILS) & set(policy.get("users", {})))
