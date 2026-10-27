"""`GET /api/suite/people?q=` finds users and groups for a picker (ask S1).

Every case sends a real request through the Suite dispatcher, so the owner
row, the route table, the handler and the v2 envelope are all in the path.
"""

from unittest.mock import patch

import frappe
from frappe.core.doctype.user.user import generate_keys
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite import drive
from suite.api import people
from suite.drive.tests.fixtures import drop_personal_root

# Every fixture name carries this marker, so a search for it sees only them.
MARK = "Qzpeople"
DOMAIN = "qzp.example.com"
CALLER = f"caller@{DOMAIN}"
ASHA = f"asha@{DOMAIN}"
DISABLED = f"disabled@{DOMAIN}"
WEBSITE = f"website@{DOMAIN}"
GROUP = f"{MARK} Design team"
SOLO_GROUP = f"{MARK} Solo group"


def make_user(email: str, first_name: str, *, enabled: bool = True) -> None:
    if frappe.db.exists("User", email):
        frappe.delete_doc("User", email, force=True, ignore_permissions=True)
    frappe.get_doc(
        {"doctype": "User", "email": email, "first_name": first_name, "enabled": int(enabled)}
    ).insert(ignore_permissions=True)


def make_website_user(email: str, first_name: str) -> None:
    """A signed-up visitor: no Suite role, so not a Suite user."""
    make_user(email, first_name)
    frappe.db.delete("Has Role", {"parent": email, "parenttype": "User"})
    frappe.db.set_value("User", email, "user_type", "Website User")
    frappe.clear_cache(user=email)


def make_group(name: str, members: list[str]) -> None:
    if frappe.db.exists("User Group", name):
        frappe.delete_doc("User Group", name, force=True, ignore_permissions=True)
    frappe.get_doc(
        {
            "doctype": "User Group",
            "__newname": name,
            "user_group_members": [{"user": member} for member in members],
        }
    ).insert(ignore_permissions=True)


def token_for(user: str) -> str:
    record = frappe.get_doc("User", user)
    if not record.api_key:
        generate_keys(user)
        record.reload()
    return f"token {record.api_key}:{record.get_password('api_secret')}"


class TestPeople(IntegrationTestCase):
    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        make_user(CALLER, f"{MARK} Caller")
        make_user(ASHA, f"{MARK} Asha")
        make_user(DISABLED, f"{MARK} Disabled", enabled=False)
        make_website_user(WEBSITE, f"{MARK} Website")
        make_group(GROUP, [ASHA, CALLER])
        make_group(SOLO_GROUP, [ASHA])
        cls.caller = token_for(CALLER)
        cls.website = token_for(WEBSITE)
        frappe.db.commit()
        cls.addClassCleanup(cls.remove_fixtures)

    @classmethod
    def remove_fixtures(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        for group in (GROUP, SOLO_GROUP):
            frappe.delete_doc("User Group", group, force=True, ignore_permissions=True)
        for user in (CALLER, ASHA, DISABLED, WEBSITE):
            frappe.delete_doc("User", user, force=True, ignore_permissions=True)
        frappe.db.commit()

    def get(self, query: dict | None = None, *, auth: str | None = None):
        headers = {"Authorization": auth} if auth else {}
        return make_request(
            target=self.CLIENT.open,
            args=("/api/suite/people",),
            kwargs={"method": "GET", "headers": headers, "query_string": query or {}},
        )

    def page(self, query: dict) -> dict:
        response = self.get(query, auth=self.caller)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.json["data"]

    def test_a_suite_user_finds_enabled_people_and_groups_with_member_counts(self):
        found = self.page({"q": MARK.lower()})
        self.assertEqual(
            found["rows"],
            [
                {
                    "kind": "user",
                    "name": ASHA,
                    "email": ASHA,
                    "full_name": f"{MARK} Asha",
                    "user_image": None,
                },
                {
                    "kind": "user",
                    "name": CALLER,
                    "email": CALLER,
                    "full_name": f"{MARK} Caller",
                    "user_image": None,
                },
                {"kind": "group", "name": GROUP, "member_count": 2},
                {"kind": "group", "name": SOLO_GROUP, "member_count": 1},
            ],
        )
        self.assertIsNone(found["next_cursor"])

    def test_a_search_matches_the_email_as_well_as_the_name(self):
        found = self.page({"q": f"asha@{DOMAIN}"})
        self.assertEqual([row["name"] for row in found["rows"]], [ASHA])

    def test_an_empty_search_lists_everyone_but_the_reserved_users(self):
        names = set()
        cursor = None
        while True:
            found = self.page({"cursor": cursor} if cursor else {})
            names.update(row["name"] for row in found["rows"])
            cursor = found["next_cursor"]
            if cursor is None:
                break
        self.assertTrue({ASHA, CALLER, GROUP, SOLO_GROUP} <= names)
        self.assertFalse({"Administrator", "Guest", DISABLED, WEBSITE} & names)

    def test_pages_walk_the_whole_result_once(self):
        whole = self.page({"q": MARK})["rows"]
        walked = []
        cursor = None
        with patch.object(people, "PAGE_SIZE", 3):
            while True:
                found = self.page({"q": MARK, **({"cursor": cursor} if cursor else {})})
                self.assertLessEqual(len(found["rows"]), 3)
                walked.extend(found["rows"])
                cursor = found["next_cursor"]
                if cursor is None:
                    break
        self.assertEqual(walked, whole)

    def test_like_wildcards_in_the_search_are_literal(self):
        self.assertEqual(self.page({"q": "%"})["rows"], [])
        self.assertEqual(self.page({"q": f"{MARK}_Asha"})["rows"], [])

    def test_a_bad_cursor_is_a_bad_request(self):
        for cursor in ("not-a-cursor", "-3", "9" * 38, "9" * 5000, "\u0663"):
            with self.subTest(cursor=cursor):
                response = self.get({"cursor": cursor}, auth=self.caller)
                self.assertEqual(response.status_code, 400, response.get_data(as_text=True))

    def test_a_guest_and_a_website_user_are_refused(self):
        for auth in (None, self.website):
            with self.subTest(signed_in=auth is not None):
                response = self.get({"q": MARK}, auth=auth)
                self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
                self.assertNotIn(ASHA, response.get_data(as_text=True))


# Apart from the fixtures above, so neither class sees the other's people
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

    def test_a_node_the_caller_cannot_comment_on_is_refused(self):
        for auth, status in ((self.stranger, 404), (self.reader, 403)):
            with self.subTest(status=status):
                response = self.get({"node": self.node, "q": NODE_MARK}, auth)
                self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                self.assertNotIn(OWNER, response.get_data(as_text=True))

    def restore_owner(self):
        frappe.db.set_value("Drive Node", self.node, "owner", OWNER)
        frappe.db.commit()
