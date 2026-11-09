"""`GET /api/suite/people?node=` ranks people on a node; `/people/lookup` asks about exact people."""

import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite import drive
from suite.api.test_people import make_user, token_for
from suite.drive._core.access import grant, revoke
from suite.drive._core.roles import NONE
from suite.drive.framework import principals_for
from suite.drive.tests.fixtures import drop_personal_root

NODE_MARK = "Qznode"
NODE_DOMAIN = "qzn.example.com"
OWNER = f"owner@{NODE_DOMAIN}"
COMMENTER = f"commenter@{NODE_DOMAIN}"
READER = f"reader@{NODE_DOMAIN}"
STRANGER = f"stranger@{NODE_DOMAIN}"


class TestPeopleOnANode(IntegrationTestCase):
    """`?node=` ranks the people a mention on that node would reach."""

    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        for user, name in (
            (OWNER, "Owner"),
            (COMMENTER, "Commenter"),
            (READER, "Reader"),
            (STRANGER, "Stranger"),
        ):
            make_user(user, f"{NODE_MARK} {name}")
        cls.owner = token_for(OWNER)
        cls.commenter = token_for(COMMENTER)
        cls.reader = token_for(READER)
        cls.stranger = token_for(STRANGER)
        frappe.set_user(OWNER)
        cls.node = drive.ensure_folder(drive.personal_root_for(OWNER), f"{NODE_MARK} Plan")
        frappe.set_user("Administrator")
        frappe.db.commit()
        cls.share(COMMENTER, drive.COMMENT)
        cls.share(READER, drive.READ)
        cls.addClassCleanup(cls.remove_fixtures)

    @classmethod
    def share(cls, user: str, role: int) -> None:
        response = make_request(
            target=cls.CLIENT.open,
            args=(f"/api/suite/drive/nodes/{cls.node}/grants/{user}",),
            kwargs={"method": "PUT", "headers": {"Authorization": cls.owner}, "json": {"role": role}},
        )
        assert response.status_code == 200, response.get_data(as_text=True)

    @classmethod
    def remove_fixtures(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for user in (OWNER, COMMENTER, READER, STRANGER):
            drop_personal_root(user)
            frappe.delete_doc("User", user, force=True, ignore_permissions=True)
        frappe.db.commit()

    def get(self, query: dict, auth: str):
        return make_request(
            target=self.CLIENT.open,
            args=("/api/suite/people",),
            kwargs={"method": "GET", "headers": {"Authorization": auth}, "query_string": query},
        )

    def found(self, query: dict) -> list[tuple[str, bool]]:
        response = self.get({"node": self.node, **query}, self.commenter)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        page = response.json["data"]
        self.assertIsNone(page["next_cursor"])
        return [(row["name"], row["has_access"]) for row in page["rows"]]

    def test_people_who_can_open_the_node_come_first_and_the_caller_is_left_out(self):
        found = self.found({"q": NODE_MARK})
        self.assertEqual(found, [(OWNER, True), (READER, True), (STRANGER, False)])

    def test_the_creator_is_found_when_the_directory_leaves_them_out(self):
        frappe.db.set_value("Drive Node", self.node, "owner", "Administrator")
        frappe.db.commit()
        self.addCleanup(self.restore_owner)
        self.assertEqual(self.found({"q": "Administrator"}), [("Administrator", True)])

    def test_only_a_manager_sees_who_is_blocked(self):
        owner = principals_for(OWNER)
        before = self.rows(self.commenter)
        grant(self.node, STRANGER, NONE, owner)
        self.addCleanup(self.lift_block, owner)
        frappe.db.commit()

        marks = {row["name"]: row["is_blocked"] for row in self.rows(self.owner)}
        self.assertEqual(marks, {COMMENTER: False, READER: False, STRANGER: True})
        # Byte for byte the answer from before the block, in fields as well as values
        self.assertEqual(self.rows(self.commenter), before)
        self.assertFalse([row for row in before if "is_blocked" in row])

    def rows(self, auth: str) -> list[dict]:
        response = self.get({"node": self.node, "q": NODE_MARK}, auth)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.json["data"]["rows"]

    def lift_block(self, owner):
        revoke(self.node, STRANGER, owner)
        frappe.db.commit()

    def look_up(self, query: dict, auth: str):
        return make_request(
            target=self.CLIENT.open,
            args=("/api/suite/people/lookup",),
            kwargs={"method": "GET", "headers": {"Authorization": auth}, "query_string": query},
        )

    def test_a_lookup_answers_only_the_people_named(self):
        response = self.look_up(
            {"node": self.node, "users": json.dumps([READER, STRANGER, "nobody@example.com"])},
            self.commenter,
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(
            [(row["name"], row["has_access"]) for row in response.json["data"]],
            [(READER, True), (STRANGER, False)],
        )

    def test_a_lookup_refuses_a_missing_argument_and_a_long_list(self):
        too_many = json.dumps(["x"] * (drive.MAX_MENTIONS + 1))
        for query, error in (
            ({"users": json.dumps([READER])}, "BadRequest"),
            ({"node": self.node}, "BadRequest"),
            ({"node": self.node, "users": READER}, "BadRequest"),
            ({"node": self.node, "users": too_many}, "BadLookup"),
        ):
            with self.subTest(query=query):
                response = self.look_up(query, self.commenter)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))
                self.assertEqual(response.json["errors"][0]["type"], error)

    def test_a_lookup_on_a_node_the_caller_cannot_comment_on_is_refused(self):
        for auth, status in ((self.stranger, 404), (self.reader, 403)):
            with self.subTest(status=status):
                response = self.look_up({"node": self.node, "users": json.dumps([OWNER])}, auth)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertNotIn(OWNER, response.get_data(as_text=True))

    def test_a_node_the_caller_cannot_comment_on_is_refused(self):
        for auth, status in ((self.stranger, 404), (self.reader, 403)):
            with self.subTest(status=status):
                response = self.get({"node": self.node, "q": NODE_MARK}, auth)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertNotIn(OWNER, response.get_data(as_text=True))

    def restore_owner(self):
        frappe.db.set_value("Drive Node", self.node, "owner", OWNER)
        frappe.db.commit()
