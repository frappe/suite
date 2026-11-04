"""Seed and reset the Northwind demo on a real site, without a mail server."""

from io import BytesIO
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite import content, drive
from suite.composition.demo import drive as demo
from suite.composition.demo.cast import PEOPLE, acting_as, email_of
from suite.drive import MANAGE, READ, UPLOAD
from suite.drive._core import nodes
from suite.drive._core.access import effective_role, grant
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import drop_personal_root, drop_root
from suite.suite_core import storage
from suite.tests.utils import ensure_user
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


def restore_storage(previous: dict) -> None:
    frappe.db.set_value("Suite Storage State", "site", previous)
    frappe.db.commit()


def remove_user(user: str) -> None:
    with acting_as("Administrator"):
        drop_personal_root(user)
        for contact in frappe.get_all("Contact", filters={"user": user}, pluck="name"):
            frappe.delete_doc("Contact", contact, ignore_permissions=True)
        frappe.delete_doc("User", user, ignore_permissions=True)
    frappe.db.commit()


def purge_if_active(node: str) -> None:
    with acting_as("Administrator"):
        if frappe.db.exists("Drive Node", {"name": node, "state": "Active"}):
            admin = principals_for("Administrator")
            nodes.update(admin, node, state="Trashed")
            nodes.purge(admin, node)
    frappe.db.commit()


class TestDemoSeed(IntegrationTestCase):
    def setUp(self):
        if frappe.db.exists("User", {"name": ["in", EMAILS]}):
            self.skipTest("This site holds Northwind accounts, and the test would remove them")
        patcher = patch.dict(frappe.local.conf, {"mail": None})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(restore_branding, branding())
        site_storage, _policy, _measurements = storage.state()
        self.addCleanup(
            restore_storage, {"policy": site_storage.policy, "measurements": site_storage.measurements}
        )
        if not active_shared_root():
            self.addCleanup(drop_shared_root)
        self.colleague = f"not-northwind-{frappe.generate_hash(length=8)}@example.test"
        ensure_user(self.colleague)
        self.addCleanup(remove_user, self.colleague)
        self.addCleanup(reset_demo)
        frappe.db.set_single_value("Suite Settings", BRANDING)
        frappe.db.commit()

    def store_colleague_files(self) -> tuple[str, str]:
        """Have a non-demo user store one file beside the demo folders and one inside a demo folder."""
        folder = node_titled(demo.PREFIX + "Company").name
        grant(folder, self.colleague, UPLOAD, principals_for(email_of("maya")), notify=False)
        with acting_as(self.colleague):
            outside = drive.store_file(active_shared_root(), "Not demo.txt", BytesIO(b"keep me"))
            self.addCleanup(purge_if_active, outside)
            inside = drive.store_file(folder, "Added to demo.txt", BytesIO(b"remove me"))
            self.addCleanup(purge_if_active, inside)
        return outside, inside

    def measure_mail(self) -> None:
        """Record Mail usage for one demo user and for the non-demo user."""
        _doc, _policy, measurements = storage.state()
        measurements["personal"] = {email_of("maya"): 123, self.colleague: 7}
        frappe.db.set_value("Suite Storage State", "site", "measurements", frappe.as_json(measurements))

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

        outside, inside = self.store_colleague_files()
        self.measure_mail()
        frappe.db.commit()

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
        _doc, policy, measurements = storage.state()
        self.assertFalse(set(EMAILS) & set(policy.get("users", {})))
        self.assertEqual(measurements["personal"], {self.colleague: 7})

        self.assertTrue(frappe.db.exists("User", self.colleague))
        self.assertEqual(frappe.db.get_value("Drive Node", outside, "state"), "Active")
        self.assertFalse(frappe.db.exists("Drive Node", inside))
