"""A person's first run: who walks the welcome, which starter files they get, and Home's list."""

import json
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from suite import drive
from suite.api import routes
from suite.composition.welcome import finish_site_setup, give_starter_files
from suite.draw import get_drawing


def new_person() -> str:
    user = frappe.new_doc("User")
    user.email = f"welcome-{uuid4().hex[:8]}@example.com"
    user.first_name = "Welcome Test"
    user.insert(ignore_permissions=True)
    return user.name


def starter(user: str, content_doctype: str) -> str:
    return frappe.db.get_value(
        "Drive Node", {"root": drive.personal_root_for(user), "content_doctype": content_doctype}, "name"
    )


def starter_kinds(user: str) -> list[str]:
    root = drive.personal_root_for(user)
    return sorted(
        frappe.get_all(
            "Drive Node",
            filters={"root": root, "kind": "document", "trashed_at": ["is", "not set"]},
            pluck="content_doctype",
        )
    )


@contextmanager
def queued_jobs():
    """Hold the jobs queued inside the block, and answer a call that runs them as a worker would."""
    held = []
    with patch("frappe.enqueue", lambda method, **kwargs: held.append((method, kwargs))):
        yield lambda: [run_as_job(method, kwargs) for method, kwargs in held]


def run_as_job(method: str, kwargs: dict) -> None:
    arguments = {key: value for key, value in kwargs.items() if key in {"node", "workbook"}}
    frappe.local.job = frappe._dict(method=method)
    try:
        frappe.get_attr(method)(**arguments)
    finally:
        del frappe.local.job


class TestWelcome(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(frappe.set_user, "Administrator")

    def test_someone_added_after_onboarding_walks_the_welcome_once(self):
        frappe.db.set_single_value("Suite Settings", "is_onboarded", 1)
        person = new_person()
        frappe.set_user(person)
        self.assertTrue(routes.account_get()["needs_welcome"])

        account = routes.account_patch(welcomed=True)

        self.assertFalse(account["needs_welcome"])
        self.assertEqual(starter_kinds(person), ["Writer Document"])
        # Finishing again gives no second copy.
        routes.account_patch(welcomed=True)
        self.assertEqual(starter_kinds(person), ["Writer Document"])

    def test_someone_added_before_onboarding_is_not_asked(self):
        frappe.db.set_single_value("Suite Settings", "is_onboarded", 0)
        person = new_person()
        frappe.set_user(person)
        self.assertFalse(routes.account_get()["needs_welcome"])

    def test_the_first_admin_gets_one_starter_file_of_each_kind_with_something_in_it(self):
        person = new_person()
        with queued_jobs() as run_jobs:
            give_starter_files(person, admin=True)
        run_jobs()
        self.assertEqual(starter_kinds(person), ["Drawing", "Presentation", "Sheet", "Writer Document"])

        frappe.set_user(person)
        # The readable copy is what search and exports read, and it is written from the live body.
        budget = frappe.db.get_value("Sheet", {"node": starter(person, "Sheet")}, "html")
        for text in ("Category", "Marketing", "Total"):
            self.assertIn(text, budget)

        board = json.loads(get_drawing(starter(person, "Drawing"))["content"])
        labels = {shape.get("label") or shape.get("text") for shape in board["rectangles"]}
        self.assertTrue({"Ideas", "Questions", "Next steps", "Invite the team"} <= labels)
        self.assertTrue(board["lines"])

    def test_an_admin_who_finishes_site_setup_is_not_asked_to_walk_the_welcome_too(self):
        frappe.db.set_single_value("Suite Settings", "is_onboarded", 1)
        admin = new_person()
        frappe.db.set_single_value("Suite Settings", "is_onboarded", 0)
        frappe.set_user(admin)
        self.assertTrue(routes.account_get()["needs_welcome"])

        finish_site_setup(admin)

        self.assertFalse(routes.account_get()["needs_welcome"])
        self.assertIn("Sheet", starter_kinds(admin))

    def test_a_new_person_follows_their_system_theme(self):
        self.assertEqual(frappe.db.get_value("User", new_person(), "desk_theme"), "Automatic")

    def test_hiding_get_started_is_saved_for_that_person_only(self):
        person, other = new_person(), new_person()
        frappe.set_user(person)
        self.assertFalse(routes.account_get()["get_started_hidden"])

        self.assertTrue(routes.account_patch(get_started_hidden=True)["get_started_hidden"])
        self.assertTrue(routes.account_get()["get_started_hidden"])
        frappe.set_user(other)
        self.assertFalse(routes.account_get()["get_started_hidden"])

        frappe.set_user(person)
        self.assertFalse(routes.account_patch(get_started_hidden=False)["get_started_hidden"])

    def test_an_update_must_say_what_changes(self):
        frappe.set_user(new_person())
        for body in ({}, {"welcomed": False}, {"get_started_hidden": "yes"}):
            with self.subTest(body=body), self.assertRaises(frappe.ValidationError):
                routes.account_patch(**body)
