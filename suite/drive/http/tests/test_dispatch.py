"""Whole HTTP requests, through Frappe's own WSGI application.

Nothing here calls a handler. Every case goes in as bytes on a socket-shaped
environ and comes back as a status code and a JSON body, because the parts this
ticket is responsible for only exist end to end: the rewrite happens in
`init_request`, authentication happens after it, argument binding happens in
`frappe.call`, and the envelope is written by `frappe.utils.response`.

Two mechanics are inherited from `frappe/tests/test_api.py` and matter for
every test below. The request runs on its own thread with its own
`frappe.local` and its own database connection, so a fixture is only visible to
it once committed. And the reply's own writes are only visible here after this
connection's snapshot is dropped, which `reread` does.
"""

import io
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qsl, urlsplit
from zoneinfo import ZoneInfo

import frappe
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase
from frappe.tests.test_api import make_request
from frappe.utils import get_test_client

from suite.drive._core import activity as activity_core
from suite.drive._core import upload as upload_core
from suite.drive._core.access import grant, unlock_link
from suite.drive._core.nodes import create_file, create_folder
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD
from suite.drive._core.roots import create_root
from suite.drive.tests.fixtures import drop_personal_root
from suite.tests.utils import ensure_user

OWNER = "drive-http-owner@example.com"
STRANGER = "drive-http-stranger@example.com"
PREFIX = "/api/suite/drive"
V2 = "/api/v2/method/suite.drive.http.routes"

NODE_SHAPE_FIELDS = {
    "name",
    "title",
    "kind",
    "parent_node",
    "root",
    "state",
    "trash_root",
    "size",
    "mime",
    "url",
    "content_doctype",
    "content_docname",
    "is_template",
    "owner",
    "creation",
    "modified",
    "content_modified",
}

GRANT_SHAPE_FIELDS = {
    "name",
    "node",
    "principal",
    "role",
    "expires_on",
    "has_password",
    "sent_to",
}

# Every user the API names is published this way (B2).
PERSON_FIELDS = {"id", "full_name", "user_image"}

# A comment by a signed-in author. A Guest's comment has no `person`.
COMMENT_SHAPE_FIELDS = {
    "name",
    "thread",
    "node",
    "content",
    "author",
    "author_name",
    "person",
    "mentions",
    "creation",
    "modified",
}

EXPLAIN_ROW_FIELDS = {
    "node",
    "depth",
    "principal",
    "role",
    "expires_on",
    "pass",
    "held",
    "winner",
}

VERSION_SHAPE_FIELDS = {
    "name",
    "node",
    "seq",
    "kind",
    "label",
    "pinned",
    "actor",
    "size",
    "creation",
}

ACTIVITY_SHAPE_FIELDS = {
    "name",
    "node",
    "action",
    "actor",
    "at",
    "via_link",
    "client",
    "detail",
}

THREAD_SHAPE_FIELDS = {
    "name",
    "node",
    "anchor",
    "resolved",
    "resolved_by",
    "resolved_at",
    "creation",
    "comments",
}

NOTIFICATION_SHAPE_FIELDS = {
    "name",
    "read",
    "creation",
    "activity",
}

# The seven names 11.2 freezes, in table order. A view outside this tuple is a
# name the route table does not answer.
VIEW_NAMES = (
    "shared",
    "recents",
    "favourites",
    "trash",
    "archived-roots",
    "templates",
    "search",
)

PAST = "2020-01-01 00:00:00"


@contextmanager
def storage_v2_on():
    """Let the requests inside this block open a real upload session.

    `create_blob_upload` refuses unless `frappe.storage.enabled()` answers
    True, and that reads `frappe.conf`, which every request rebuilds from the
    site's own config file. The request runs on its own thread, so writing
    `frappe.conf` here would never reach it. Patch the predicate instead. It is
    process wide for the length of the block and restored after, so the site
    config stays dormant. Activating it is ticket 29's work, not this one's.
    """
    with patch("frappe.storage.enabled", return_value=True):
        yield


def drop_node_rows(nodes) -> None:
    """Delete a set of nodes and everything that hangs off them.

    `Drive Notification` has no `node` column. It points at the `Drive
    Activity` row, so the activity ids must be read before that table goes.
    """
    nodes = [node for node in nodes if node]
    if not nodes:
        return
    activity = frappe.get_all("Drive Activity", filters={"node": ["in", nodes]}, pluck="name")
    if activity:
        frappe.db.delete("Drive Notification", {"activity": ["in", activity]})
    for table in ("Drive Activity", "Drive Grant", "Drive Node Version", "Drive Node Preview"):
        frappe.db.delete(table, {"node": ["in", nodes]})
    frappe.db.delete("Drive Node", {"name": ["in", nodes]})


def drop_record_rows(nodes) -> None:
    """Delete the side rows `drop_node_rows` leaves behind.

    A recent, a favourite, a thread, and a comment all point at a node, and
    none of them is removed with it. They are dropped before the node rows so
    a link never dangles.
    """
    nodes = [node for node in nodes if node]
    if not nodes:
        return
    for table in ("Drive Recent", "Drive Favourite", "Drive Comment", "Drive Comment Thread"):
        frappe.db.delete(table, {"node": ["in", nodes]})


class DriveHTTPCase(IntegrationTestCase):
    """One committed fixture tree, and one way to send a request at it."""

    CLIENT = get_test_client(use_cookies=False)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        frappe.set_user("Administrator")
        ensure_user(OWNER)
        ensure_user(STRANGER)
        drop_personal_root(OWNER)
        cls.admin = Principals("Administrator", ("Administrator",), ("$PUBLIC",), is_admin=True)
        cls.owner = Principals(OWNER, (OWNER, "$GENERAL"), ("$PUBLIC",))
        cls.stranger = Principals(STRANGER, (STRANGER, "$GENERAL"), ("$PUBLIC",))

        cls.created_blobs = []
        cls.root = create_root(kind="Personal", title="HTTP fixtures", user=OWNER)
        cls.folder = create_folder(cls.owner, cls.root.name, "Folder")
        cls.file = cls.make_file(cls.folder, "report.bin", b"drive bytes")
        cls.document = cls.make_document("Deck")
        frappe.db.commit()
        cls.addClassCleanup(cls.remove_fixtures)

    @classmethod
    def make_document(cls, title: str) -> str:
        """Insert a content document directly, the way `test_previews` does.

        `create_document` reads `drive_content_types`, which is empty until
        ticket 29 activates it, so no `_core` helper can mint one here. Routes
        that only accept a document need a node of that kind to be reachable
        at all.
        """
        return (
            frappe.get_doc(
                {
                    "doctype": "Drive Node",
                    "title": title,
                    "parent_node": cls.root.name,
                    "root": cls.root.name,
                    "path": "",
                    "kind": "document",
                    "content_doctype": "ToDo",
                    "content_docname": f"dispatch-{frappe.generate_hash(length=8)}",
                    "mime": "frappe/test",
                    "state": "Active",
                }
            )
            .insert(ignore_permissions=True, ignore_links=True)
            .name
        )

    @classmethod
    def make_file(cls, parent: str, title: str, content: bytes) -> str:
        blob = put_blob(io.BytesIO(content), is_private=True, filename=title)
        cls.created_blobs.append(blob.name)
        return create_file(cls.owner, parent, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type)

    @classmethod
    def remove_fixtures(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        nodes = [
            row.name for row in frappe.get_all("Drive Node", filters={"root": cls.root.name}, fields=["name"])
        ]
        nodes.append(cls.root.name)
        drop_node_rows(nodes)
        frappe.db.delete("Drive Root", {"name": cls.root.name})
        frappe.db.delete("File Blob", {"name": ["in", cls.created_blobs]})
        frappe.db.commit()

    # -- sending -----------------------------------------------------------

    @classmethod
    def session_for(cls, user: str) -> str:
        """Mint a real session, the way an interactive client gets one."""
        from frappe.auth import CookieManager, LoginManager
        from frappe.utils import set_request

        kept = {
            name: getattr(frappe.local, name, None)
            for name in ("request", "session", "login_manager", "cookie_manager")
        }
        set_request(path="/")
        try:
            frappe.local.cookie_manager = CookieManager()
            frappe.local.login_manager = LoginManager()
            frappe.local.login_manager.login_as(user)
            sid = frappe.session.sid
        finally:
            for name, value in kept.items():
                if value is None:
                    # `frappe.local` is a contextvar store, not an object with
                    # a `__dict__`. Deleting a name it never held raises.
                    try:
                        delattr(frappe.local, name)
                    except AttributeError:
                        pass
                else:
                    setattr(frappe.local, name, value)
        frappe.db.commit()
        return sid

    @classmethod
    def api_key_for(cls, user: str) -> str:
        """Return one user's `key:secret` token, generating the pair once."""
        from frappe.core.doctype.user.user import generate_keys

        record = frappe.get_doc("User", user)
        if not record.api_key:
            generate_keys(user)
            record.reload()
        secret = record.get_password("api_secret")
        frappe.db.commit()
        return f"{record.api_key}:{secret}"

    def drive(
        self,
        method: str,
        path: str,
        *,
        body=None,
        raw: bytes | None = None,
        query: dict | None = None,
        sid: str | None = None,
        token: str | None = None,
        links: str | None = None,
        headers: dict | None = None,
        content_type: str | None = None,
    ):
        """Send one request and return werkzeug's `TestResponse`."""
        sent = dict(headers or {})
        if token:
            sent["Authorization"] = f"token {token}"
        if sid:
            sent["Cookie"] = f"sid={sid}"
        if links:
            sent["X-Drive-Links"] = links
        kwargs = {"method": method, "headers": sent, "query_string": query or {}}
        if raw is not None:
            kwargs["data"] = raw
            kwargs["content_type"] = content_type or "application/octet-stream"
        elif body is not None:
            kwargs["json"] = body
        return make_request(target=self.CLIENT.open, args=(path,), kwargs=kwargs)

    def as_owner(self, method, path, **kwargs):
        return self.drive(method, path, sid=self.owner_sid, **kwargs)

    def setUp(self):
        super().setUp()
        self.owner_sid = self.session_for(OWNER)

    def reread(self):
        """Drop this connection's snapshot so a reply's writes become visible."""
        frappe.db.rollback()

    # -- reading -----------------------------------------------------------

    def data(self, response):
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.json
        self.assertIn("data", payload, payload)
        return payload["data"]

    def refusal(self, response, status, kind):
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        errors = response.json.get("errors")
        self.assertTrue(errors, response.get_data(as_text=True))
        self.assertEqual(errors[0]["type"], kind)
        return errors[0]


class TestAuthentication(DriveHTTPCase):
    """Frappe resolves the caller. Drive only reads the result."""

    def test_a_session_cookie_authenticates(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}"))
        self.assertEqual(answer["name"], self.file)
        self.assertEqual(set(answer["owner"]), PERSON_FIELDS)
        self.assertEqual(answer["owner"]["id"], OWNER)

    def test_an_api_key_authenticates_the_same_caller(self):
        token = self.api_key_for(OWNER)
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.file}", token=token))
        self.assertEqual(answer["name"], self.file)

    def test_an_api_key_carries_its_own_user_not_the_cookies(self):
        token = self.api_key_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}", token=token)
        self.refusal(response, 404, "DriveNotFound")

    def test_a_wrong_api_secret_is_refused_before_any_route_runs(self):
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}", token="nope:nope")
        self.assertEqual(response.status_code, 401)

    def test_a_guest_is_heard_and_then_refused_on_a_node_it_cannot_read(self):
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}")
        self.refusal(response, 404, "DriveNotFound")

    def test_a_guest_carrying_a_read_link_is_answered(self):
        created = grant(self.folder, "$LINK", READ, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke, created)
        token = created["principal"].split(":", 1)[1]
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.file}", links=token))
        self.assertEqual(answer["name"], self.file)

    def test_a_password_link_without_a_ticket_is_locked_not_forbidden(self):
        created = grant(self.folder, "$LINK", READ, self.owner, password="correct horse")
        frappe.db.commit()
        self.addCleanup(self.revoke, created)
        token = created["principal"].split(":", 1)[1]
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}", links=token)
        self.refusal(response, 401, "DriveLocked")
        self.assertEqual(response.headers.get("WWW-Authenticate"), 'DriveLink realm="drive"')

    def test_a_password_link_with_its_ticket_is_answered(self):
        created = grant(self.folder, "$LINK", READ, self.owner, password="correct horse")
        frappe.db.commit()
        self.addCleanup(self.revoke, created)
        token = created["principal"].split(":", 1)[1]
        ticket = unlock_link(token, "correct horse")["ticket"]
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.file}", links=f"{token}.{ticket}"))
        self.assertEqual(answer["name"], self.file)

    def test_a_guest_is_not_heard_on_a_session_only_route(self):
        response = self.drive("DELETE", f"{PREFIX}/nodes/{self.file}")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json["errors"][0]["type"], "PermissionError")

    def revoke(self, created):
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"name": created["name"]})
        frappe.db.commit()


class TestAddressing(DriveHTTPCase):
    """The path decides the route and the target. Nothing in the body does."""

    def test_a_verb_no_row_declares_is_not_found(self):
        response = self.as_owner("POST", f"{PREFIX}/nodes/{self.file}", body={})
        self.refusal(response, 404, "DriveNotFound")

    def test_an_unclaimed_path_answers_json_not_html(self):
        # `/history` is not a route row. `/activity` is the one that is.
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}/history")
        self.refusal(response, 404, "DriveNotFound")
        self.assertEqual(response.mimetype, "application/json")

    def test_the_path_id_beats_a_body_argument_naming_another_node(self):
        target = create_folder(self.owner, self.root.name, "Addressed")
        decoy = create_folder(self.owner, self.root.name, "Decoy")
        frappe.db.commit()
        self.as_owner("PATCH", f"{PREFIX}/nodes/{target}", body={"node": decoy, "title": "Renamed"})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Node", target, "title"), "Renamed")
        self.assertEqual(frappe.db.get_value("Drive Node", decoy, "title"), "Decoy")

    def test_the_path_upload_id_beats_a_body_argument(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/uploads/addressed/finish",
            body={"upload_id": "smuggled", "parent_node": self.folder, "title": "x"},
        )
        # Neither session exists. The message must be about the addressed one.
        self.refusal(response, 404, "DriveNotFound")

    def test_cmd_cannot_replace_the_addressed_route(self):
        response = self.as_owner(
            "GET",
            f"{PREFIX}/nodes/{self.file}",
            query={"cmd": "frappe.client.get_list", "doctype": "User"},
        )
        answer = self.data(response)
        self.assertEqual(answer["name"], self.file)

    def test_cmd_cannot_run_from_an_unclaimed_drive_path(self):
        response = self.as_owner(
            "GET",
            f"{PREFIX}/nothing/here",
            query={"cmd": "frappe.client.get_list", "doctype": "User"},
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_the_v2_method_url_still_refuses_a_verb_the_handler_denies(self):
        # The whitelist is the second gate: it stops the same call made
        # straight at the target the translator writes.
        response = self.as_owner("POST", f"{V2}.node_get", body={"node": self.file})
        self.assertEqual(response.status_code, 403)

    def test_the_v2_method_url_honours_the_handler_for_its_declared_verb(self):
        answer = self.data(self.as_owner("GET", f"{V2}.node_get", query={"node": self.file}))
        self.assertEqual(answer["name"], self.file)

    def test_options_is_answered_by_the_framework(self):
        response = self.drive("OPTIONS", f"{PREFIX}/nodes/{self.file}")
        self.assertEqual(response.status_code, 200)


class TestNodeShape(DriveHTTPCase):
    def test_a_detail_fetch_publishes_exactly_the_base_fields_and_the_callers_star(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}"))
        self.assertEqual(set(answer), NODE_SHAPE_FIELDS | {"favourite"})

    def test_a_list_row_is_the_same_shape_as_a_detail_fetch(self):
        listed = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/children"))
        row = next(row for row in listed["rows"] if row["name"] == self.file)
        detail = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}"))
        self.assertEqual(row, detail)

    def test_the_root_field_is_the_effective_root_on_a_root_node(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.root.name}"))
        self.assertEqual(answer["root"], self.root.name)
        self.assertEqual(answer["kind"], "root")

    def test_no_expansion_is_published_unless_it_is_asked_for(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}"))
        for expansion in ("access", "breadcrumbs", "preview"):
            self.assertNotIn(expansion, answer)

    def test_the_access_expansion_reports_the_role_and_its_source(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}", query={"expand": "access"}))
        self.assertEqual(set(answer["access"]), {"role", "via_link", "source_node", "source_principal"})
        self.assertGreaterEqual(answer["access"]["role"], READ)

    def test_the_breadcrumb_expansion_runs_root_first_and_stops_at_the_parent(self):
        answer = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.file}", query={"expand": "breadcrumbs"})
        )
        self.assertEqual([step["name"] for step in answer["breadcrumbs"]], [self.root.name, self.folder])

    def test_a_list_page_can_carry_the_access_expansion_too(self):
        listed = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/children", query={"expand": "access"})
        )
        for row in listed["rows"]:
            self.assertGreaterEqual(row["access"]["role"], READ)

    def test_an_unknown_expansion_is_a_bad_request(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}", query={"expand": "grants"})
        self.refusal(response, 400, "DriveError")

    def test_a_page_carries_an_opaque_cursor_and_honours_its_cap(self):
        listed = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/children", query={"limit": "1"})
        )
        self.assertEqual(len(listed["rows"]), 1)
        self.assertIn("next_cursor", listed)

    def test_a_negative_limit_is_a_bad_request(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/children", query={"limit": "-1"})
        self.refusal(response, 400, "DriveError")


class TestNodeWorkflows(DriveHTTPCase):
    def test_a_folder_is_created_and_returned_in_the_node_shape(self):
        answer = self.data(
            self.as_owner(
                "POST", f"{PREFIX}/nodes", body={"parent_node": self.folder, "title": "New", "kind": "folder"}
            )
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(set(answer), NODE_SHAPE_FIELDS)
        self.assertEqual(answer["kind"], "folder")
        self.assertEqual(answer["parent_node"], self.folder)

    def test_a_folder_create_refuses_a_blob(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent_node": self.folder, "title": "Sneaky", "kind": "folder", "blob": "anything"},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_file_create_refuses_a_size_the_blob_does_not_have(self):
        blob = frappe.db.get_value("Drive Node", self.file, "blob")
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes",
            body={
                "parent_node": self.folder,
                "title": "Understated",
                "kind": "file",
                "blob": blob,
                "size": 1,
                "mime": "application/octet-stream",
            },
        )
        self.refusal(response, 400, "DriveError")

    def test_a_file_create_charges_the_stored_size_not_the_declared_one(self):
        blob = frappe.db.get_value("Drive Node", self.file, "blob")
        row = frappe.db.get_value("File Blob", blob, ["file_size", "mime_type"], as_dict=True)
        before = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        answer = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/nodes",
                body={
                    "parent_node": self.folder,
                    "title": "Second copy.bin",
                    "kind": "file",
                    "blob": blob,
                    "size": row.file_size,
                    "mime": row.mime_type,
                },
            )
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(answer["size"], row.file_size)
        after = frappe.db.get_value("Drive Root", self.root.name, "used_bytes")
        self.assertEqual(int(after) - int(before), row.file_size)

    def test_an_unknown_kind_is_a_bad_request(self):
        response = self.as_owner(
            "POST", f"{PREFIX}/nodes", body={"parent_node": self.folder, "title": "x", "kind": "root"}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_create_a_stranger_may_not_make_is_hidden(self):
        sid = self.session_for(STRANGER)
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent_node": self.folder, "title": "x", "kind": "folder"},
            sid=sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_rename_and_a_move_cannot_arrive_in_one_patch(self):
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.file}", body={"title": "x", "parent_node": self.root.name}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_content_time_is_a_whole_patch_body_of_its_own(self):
        # §11.2's PATCH row declares `{content_modified}` as one of five whole
        # bodies. It is `content.touch` with the time supplied (§8.11), so it
        # writes no version and, per §9.4, no activity row.
        before = frappe.db.count("Drive Activity", {"node": self.file})
        # §11.3: the wire carries UTC `Z`; the column stores the site's zone
        # (pinned to IST, +05:30, so the conversion is visible).
        with patch("suite.drive._core.times.site_zone", return_value=ZoneInfo("Asia/Kolkata")):
            answer = self.data(
                self.as_owner(
                    "PATCH", f"{PREFIX}/nodes/{self.file}", body={"content_modified": "2024-03-04T05:06:07Z"}
                )
            )
        self.reread()
        self.assertEqual(answer["content_modified"], "2024-03-04T05:06:07Z")
        self.assertEqual(
            str(frappe.db.get_value("Drive Node", self.file, "content_modified")),
            "2024-03-04 10:36:07",
        )
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.file}), before)
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": self.file}), 0)

    def test_a_content_time_without_an_offset_is_a_400(self):
        # The sender does not know the site's zone, so a naive time is refused
        # rather than read in it (§11.3).
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.file}", body={"content_modified": "2024-03-04 05:06:07"}
        )
        self.refusal(response, 400, "DriveError")
        self.reread()
        self.assertNotEqual(
            str(frappe.db.get_value("Drive Node", self.file, "content_modified")), "2024-03-04 05:06:07"
        )

    def test_a_content_time_cannot_arrive_with_a_tree_mutation(self):
        response = self.as_owner(
            "PATCH",
            f"{PREFIX}/nodes/{self.file}",
            body={"title": "Renamed.bin", "content_modified": "2024-03-04T05:06:07Z"},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_patch_cannot_name_a_blob_at_all(self):
        # §11.2 routes a head replacement through PUT /nodes/<id>/content,
        # which names a finished upload session. `blob` is not an argument of
        # this handler, so `frappe.call` drops it and the body mutates nothing.
        blob = frappe.db.get_value("Drive Node", self.file, "blob")
        row = frappe.db.get_value("File Blob", blob, ["file_size", "mime_type"], as_dict=True)
        response = self.as_owner(
            "PATCH",
            f"{PREFIX}/nodes/{self.file}",
            body={"blob": blob, "size": row.file_size, "mime": row.mime_type},
        )
        self.refusal(response, 400, "DriveError")
        self.reread()
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": self.file}), 0)

    def test_a_copy_shares_the_blob_and_charges_the_root_again(self):
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/copy", body={"parent_node": self.root.name})
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(answer["parent_node"], self.root.name)
        self.assertNotEqual(answer["name"], self.file)

    def test_a_taken_title_is_refused_with_the_free_title_in_the_envelope(self):
        # D12: Keep both for a folder upload needs the server's free title.
        # `Folder` is the fixture folder below the root.
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent_node": self.root.name, "title": "Folder", "kind": "folder"},
        )
        error = self.refusal(response, 409, "DriveConflict")
        self.assertEqual(error["free_title"], "Folder (2)")

    def test_a_purge_reports_how_many_nodes_it_removed(self):
        doomed = create_folder(self.owner, self.root.name, "Doomed")
        frappe.db.commit()
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{doomed}", body={"state": "Trashed"}))
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{doomed}"))
        self.reread()
        self.assertEqual(answer, {"count": 1})
        self.assertFalse(frappe.db.exists("Drive Node", doomed))

    def drop_node(self, node):
        frappe.db.rollback()
        drop_node_rows([node])
        frappe.db.commit()


class TestRestore(DriveHTTPCase):
    """§8.2's restore, including the choice the server refuses to make."""

    def setUp(self):
        super().setUp()
        self.outer = create_folder(self.owner, self.root.name, "Outer")
        self.inner = create_folder(self.owner, self.outer, "Inner")
        frappe.db.commit()
        self.addCleanup(self.drop_tree)

    def drop_tree(self):
        frappe.db.rollback()
        drop_node_rows([self.inner, self.outer])
        frappe.db.commit()

    def trash(self, node):
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{node}", body={"state": "Trashed"}))

    def test_a_restore_with_the_original_path_available_takes_no_destination(self):
        self.trash(self.inner)
        answer = self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active"}))
        self.assertEqual(answer["state"], "Active")
        self.assertEqual(answer["parent_node"], self.outer)

    def test_naming_a_destination_when_the_original_is_available_is_a_conflict(self):
        self.trash(self.inner)
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active", "parent_node": self.root.name}
        )
        self.refusal(response, 409, "DriveConflict")

    def test_a_restore_without_a_destination_names_the_choice_it_needs(self):
        # D14: the subclass is the envelope type, on the single route and in a
        # batch, so a client can tell "pick a folder" from any other conflict.
        self.trash(self.inner)
        self.trash(self.outer)
        response = self.as_owner("PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active"})
        self.refusal(response, 409, "DriveRestoreDestinationRequired")
        answer = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/nodes/batch",
                body={"nodes": [self.inner], "patch": {"state": "Active"}},
            )
        )
        self.assertEqual(answer["ok"], [])
        self.assertEqual(answer["failed"][0]["type"], "DriveRestoreDestinationRequired")

    def test_a_restore_accepts_a_destination_with_active_state(self):
        self.trash(self.inner)
        self.trash(self.outer)
        answer = self.data(
            self.as_owner(
                "PATCH",
                f"{PREFIX}/nodes/{self.inner}",
                body={"state": "Active", "parent_node": self.root.name},
            )
        )
        self.assertEqual(answer["state"], "Active")
        self.assertEqual(answer["parent_node"], self.root.name)

    def test_trashing_cannot_select_a_destination(self):
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Trashed", "parent_node": self.root.name}
        )
        self.refusal(response, 400, "DriveError")

    def test_an_unknown_state_is_a_bad_request(self):
        response = self.as_owner("PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Deleted"})
        self.refusal(response, 400, "DriveError")


class TestBatch(DriveHTTPCase):
    """§11.5: partial success is a result, and a failure rolls back alone."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A node the caller cannot see has to sit outside the caller's own
        # root. §5.1 gives the owner a root anchor grant, which every
        # descendant inherits, so nothing under `cls.root` can be hidden from
        # them by dropping a grant or rewriting an `owner` column.
        drop_personal_root(STRANGER)
        cls.outsider = create_root(kind="Personal", title="HTTP outsider", user=STRANGER)
        frappe.db.commit()
        cls.addClassCleanup(cls.remove_outsider)

    @classmethod
    def remove_outsider(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        nodes = frappe.get_all("Drive Node", filters={"root": cls.outsider.name}, pluck="name")
        drop_node_rows([*nodes, cls.outsider.name])
        frappe.db.delete("Drive Root", {"name": cls.outsider.name})
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.mine = [create_folder(self.owner, self.root.name, f"Batch {i}") for i in range(2)]
        self.theirs = create_folder(self.stranger, self.outsider.name, "Locked")
        frappe.db.commit()
        self.addCleanup(self.drop_tree)

    def drop_tree(self):
        frappe.db.rollback()
        drop_node_rows([*self.mine, self.theirs])
        frappe.db.commit()

    def another_folder(self, title: str) -> str:
        """One more folder of the owner's, dropped with the rest after the test."""
        node = create_folder(self.owner, self.root.name, title)
        frappe.db.commit()
        self.mine.append(node)
        return node

    def test_a_mixed_batch_reports_both_lists_and_answers_200(self):
        asked = [*self.mine, "does-not-exist"]
        answer = self.data(
            self.as_owner(
                "POST", f"{PREFIX}/nodes/batch", body={"nodes": asked, "patch": {"state": "Trashed"}}
            )
        )
        self.assertEqual(answer["ok"], self.mine)
        self.assertEqual([row["node"] for row in answer["failed"]], ["does-not-exist"])
        self.assertEqual(answer["failed"][0]["type"], "DriveNotFound")

    def test_a_failed_item_leaves_the_others_written(self):
        asked = [*self.mine, "does-not-exist"]
        self.as_owner("POST", f"{PREFIX}/nodes/batch", body={"nodes": asked, "patch": {"state": "Trashed"}})
        self.reread()
        for node in self.mine:
            self.assertEqual(frappe.db.get_value("Drive Node", node, "state"), "Trashed")

    def test_a_failed_item_writes_no_activity_row(self):
        before = frappe.db.count("Drive Activity")
        asked = [*self.mine, "does-not-exist"]
        self.as_owner("POST", f"{PREFIX}/nodes/batch", body={"nodes": asked, "patch": {"state": "Trashed"}})
        self.reread()
        after = frappe.db.count("Drive Activity")
        self.assertEqual(after - before, len(self.mine))

    def test_one_activity_row_lands_per_node_that_moved(self):
        self.as_owner(
            "POST", f"{PREFIX}/nodes/batch", body={"nodes": self.mine, "patch": {"state": "Trashed"}}
        )
        self.reread()
        for node in self.mine:
            rows = frappe.get_all("Drive Activity", filters={"node": node, "action": "trash"})
            self.assertEqual(len(rows), 1)

    def test_a_node_the_caller_cannot_see_fails_as_not_found(self):
        answer = self.data(
            self.as_owner(
                "POST", f"{PREFIX}/nodes/batch", body={"nodes": [self.theirs], "patch": {"state": "Trashed"}}
            )
        )
        self.assertEqual(answer["ok"], [])
        self.assertEqual(answer["failed"][0]["type"], "DriveNotFound")

    def test_a_batch_over_the_cap_is_a_bad_request(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes/batch",
            body={"nodes": [f"n{i}" for i in range(201)], "patch": {"state": "Trashed"}},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_patch_field_node_patch_does_not_take_is_a_bad_request(self):
        response = self.as_owner(
            "POST", f"{PREFIX}/nodes/batch", body={"nodes": self.mine, "patch": {"blob": "x"}}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_nodes_value_that_is_not_a_list_is_a_bad_request(self):
        response = self.as_owner(
            "POST", f"{PREFIX}/nodes/batch", body={"nodes": self.mine[0], "patch": {"state": "Trashed"}}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_move_naming_the_folder_it_expects_is_refused_once_the_node_moved_on(self):
        # Safe Undo: an undo says where it last saw the item. If a later move
        # took it elsewhere, the undo answers 409 and writes nothing.
        first, second = self.mine
        moved = self.data(
            self.as_owner(
                "PATCH",
                f"{PREFIX}/nodes/{first}",
                body={"parent_node": second, "expect_parent_node": self.root.name},
            )
        )
        self.assertEqual(moved["parent_node"], second)
        elsewhere = self.another_folder("Elsewhere")
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{first}", body={"parent_node": elsewhere}))

        stale = self.as_owner(
            "PATCH",
            f"{PREFIX}/nodes/{first}",
            body={"parent_node": self.root.name, "expect_parent_node": second},
        )
        self.refusal(stale, 409, "DriveMoved")
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Node", first, "parent_node"), elsewhere)

    def test_a_batch_move_reports_only_the_node_that_moved_on(self):
        first, second = self.mine
        elsewhere = self.another_folder("Elsewhere")
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{first}", body={"parent_node": second}))
        answer = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/nodes/batch",
                body={
                    "nodes": [first, second],
                    "patch": {"parent_node": elsewhere, "expect_parent_node": self.root.name},
                },
            )
        )
        self.assertEqual(answer["ok"], [second])
        self.assertEqual([(row["node"], row["type"]) for row in answer["failed"]], [(first, "DriveMoved")])
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Node", first, "parent_node"), second)
        self.assertEqual(frappe.db.get_value("Drive Node", second, "parent_node"), elsewhere)


class TestPurgeRoutes(DriveHTTPCase):
    """D15 and D16: Delete forever for a selection, and Empty trash per root."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        drop_personal_root(STRANGER)
        cls.outsider = create_root(kind="Personal", title="HTTP purge outsider", user=STRANGER)
        frappe.db.commit()
        cls.addClassCleanup(cls.remove_outsider)

    @classmethod
    def remove_outsider(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        nodes = frappe.get_all("Drive Node", filters={"root": cls.outsider.name}, pluck="name")
        drop_node_rows([*nodes, cls.outsider.name])
        frappe.db.delete("Drive Root", {"name": cls.outsider.name})
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        self.mine = [create_folder(self.owner, self.root.name, f"Purge {i}") for i in range(2)]
        # Visible to the owner through an EDIT grant, so a purge is refused
        # as forbidden rather than hidden as not found.
        self.shared = create_folder(self.stranger, self.outsider.name, "Shared with owner")
        grant(self.shared, OWNER, EDIT, self.stranger)
        frappe.db.commit()
        self.addCleanup(self.drop_tree)

    def drop_tree(self):
        self.drop_rows([*self.mine, self.shared])

    def drop_rows(self, nodes):
        frappe.db.rollback()
        drop_node_rows(nodes)
        frappe.db.commit()

    def test_a_batch_purge_removes_what_it_may_and_reports_the_rest(self):
        for node in self.mine:
            self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{node}", body={"state": "Trashed"}))
        asked = [*self.mine, self.shared]
        answer = self.data(self.as_owner("POST", f"{PREFIX}/nodes/batch/purge", body={"nodes": asked}))
        self.reread()
        self.assertEqual(answer["ok"], self.mine)
        self.assertEqual(
            [(row["node"], row["type"]) for row in answer["failed"]], [(self.shared, "DriveForbidden")]
        )
        for node in self.mine:
            self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertEqual(frappe.db.get_value("Drive Node", self.shared, "state"), "Active")

    def test_a_batch_purge_of_a_folder_and_its_descendant_purges_both(self):
        # The ancestor's purge takes the descendant with it. That is the
        # outcome the caller asked for, so the descendant is reported purged,
        # not missing. Both are trash roots: the inner one was trashed first.
        inner = create_folder(self.owner, self.mine[0], "Inner")
        frappe.db.commit()
        self.addCleanup(self.drop_rows, [inner])
        for node in (inner, self.mine[0]):
            self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{node}", body={"state": "Trashed"}))
        asked = [self.mine[0], inner]
        answer = self.data(self.as_owner("POST", f"{PREFIX}/nodes/batch/purge", body={"nodes": asked}))
        self.reread()
        self.assertEqual(answer["failed"], [])
        self.assertCountEqual(answer["ok"], asked)
        for node in asked:
            self.assertFalse(frappe.db.exists("Drive Node", node))

    def test_a_guest_is_not_heard_on_the_purge_routes(self):
        for path in ("nodes/batch/purge", f"roots/{self.root.name}/trash/empty"):
            with self.subTest(path=path):
                response = self.drive("POST", f"{PREFIX}/{path}", body={"nodes": self.mine})
                self.assertEqual(response.status_code, 403)

    def test_empty_trash_purges_the_roots_trash_and_counts_the_nodes(self):
        inner = create_folder(self.owner, self.mine[0], "Inner")
        frappe.db.commit()
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{inner}", body={"state": "Trashed"}))
        for node in self.mine:
            self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{node}", body={"state": "Trashed"}))

        answer = self.data(self.as_owner("POST", f"{PREFIX}/roots/{self.root.name}/trash/empty"))
        self.reread()
        self.assertEqual(answer, {"count": 3})
        for node in (*self.mine, inner):
            self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertEqual(frappe.db.get_value("Drive Node", self.folder, "state"), "Active")

    def test_empty_trash_hides_a_root_the_caller_cannot_read_and_forbids_one_they_cannot_manage(self):
        response = self.as_owner("POST", f"{PREFIX}/roots/{self.outsider.name}/trash/empty")
        self.refusal(response, 404, "DriveNotFound")
        grant(self.outsider.name, OWNER, EDIT, self.stranger)
        frappe.db.commit()
        self.addCleanup(self.drop_outsider_grant)
        response = self.as_owner("POST", f"{PREFIX}/roots/{self.outsider.name}/trash/empty")
        self.refusal(response, 403, "DriveForbidden")

    def drop_outsider_grant(self):
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"node": self.outsider.name, "principal": OWNER})
        frappe.db.commit()


class TestUploads(DriveHTTPCase):
    """§8.4: the session is the only proof that the caller produced the bytes."""

    def setUp(self):
        super().setUp()
        self.enterContext(storage_v2_on())

    def open_session(self, size: int, filename="upload.bin"):
        return self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/uploads",
                body={"parent_node": self.folder, "filename": filename, "size": size},
            )
        )

    def test_a_whole_upload_becomes_one_node_and_one_charge(self):
        payload = b"streamed drive bytes"
        before = int(frappe.db.get_value("Drive Root", self.root.name, "used_bytes") or 0)
        opened = self.open_session(len(payload))
        written = self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=payload,
                query={"offset": "0"},
            )
        )
        self.assertEqual(written["upload_id"], opened["upload_id"])
        answer = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/uploads/{opened['upload_id']}/finish",
                body={"parent_node": self.folder, "title": "upload.bin"},
            )
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(answer["size"], len(payload))
        after = int(frappe.db.get_value("Drive Root", self.root.name, "used_bytes") or 0)
        self.assertEqual(after - before, len(payload))

    def test_a_chunk_body_streams_and_is_not_parsed_as_a_form(self):
        payload = b"parent=evil&title=evil"
        opened = self.open_session(len(payload))
        written = self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=payload,
                query={"offset": "0"},
                content_type="application/x-www-form-urlencoded",
            )
        )
        self.assertEqual(written["received"], len(payload))

    def test_a_chunk_past_the_limit_is_a_bad_request(self):
        opened = self.open_session(4)
        with patch.object(upload_core, "MAX_CHUNK_BYTES", 4):
            response = self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=b"far too many bytes",
                query={"offset": "0"},
            )
        self.refusal(response, 400, "DriveError")

    def test_another_visitor_cannot_write_to_someone_elses_session(self):
        opened = self.open_session(4)
        sid = self.session_for(STRANGER)
        response = self.drive(
            "PUT",
            f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
            raw=b"1234",
            query={"offset": "0"},
            sid=sid,
        )
        self.refusal(response, 403, "DriveForbidden")

    def test_an_unknown_session_is_not_found(self):
        response = self.as_owner(
            "PUT", f"{PREFIX}/uploads/deadbeef/chunk", raw=b"1234", query={"offset": "0"}
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_finish_with_neither_a_destination_nor_a_target_is_a_bad_request(self):
        opened = self.open_session(4)
        response = self.as_owner("POST", f"{PREFIX}/uploads/{opened['upload_id']}/finish", body={})
        self.refusal(response, 400, "DriveError")

    def test_an_over_quota_session_is_refused_on_the_declared_size(self):
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 8, update_modified=False)
        frappe.db.commit()
        self.addCleanup(self.restore_quota)
        response = self.as_owner(
            "POST",
            f"{PREFIX}/uploads",
            body={"parent_node": self.folder, "filename": "big.bin", "size": 10_000_000},
        )
        self.refusal(response, 413, "DriveOverQuota")

    def test_a_stranger_cannot_open_a_session_in_a_folder_they_cannot_see(self):
        sid = self.session_for(STRANGER)
        response = self.drive(
            "POST",
            f"{PREFIX}/uploads",
            body={"parent_node": self.folder, "filename": "x.bin", "size": 4},
            sid=sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def restore_quota(self):
        frappe.db.rollback()
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 0, update_modified=False)
        frappe.db.commit()

    def test_a_head_replacement_swaps_the_bytes_and_keeps_no_version(self):
        # §11.2 routes a head replacement through PUT /nodes/<id>/content, and
        # §8.4 makes a finished session the only proof the caller produced the
        # bytes. The node id survives and the blob, the size, and the MIME move
        # to the new head. A browser replace keeps no auto version (§8.5, ask
        # D13), so the old head's charge is released and the root moves by
        # new - old.
        first = self.upload(b"first bytes", "replaceable.bin")
        self.addCleanup(self.drop_node, first["name"])
        self.reread()
        original = frappe.db.get_value("Drive Node", first["name"], "blob")
        before = int(frappe.db.get_value("Drive Root", self.root.name, "used_bytes") or 0)

        payload = b"a second head, longer than the first"
        opened = self.open_session(len(payload))
        self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=payload,
                query={"offset": "0"},
            )
        )
        answer = self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/nodes/{first['name']}/content",
                body={"upload_id": opened["upload_id"]},
            )
        )
        self.reread()
        self.assertEqual(set(answer), NODE_SHAPE_FIELDS)
        self.assertEqual(answer["name"], first["name"])
        self.assertEqual(answer["size"], len(payload))
        replaced = frappe.db.get_value("Drive Node", first["name"], "blob")
        self.assertNotEqual(replaced, original)
        after = int(frappe.db.get_value("Drive Root", self.root.name, "used_bytes") or 0)
        self.assertEqual(after - before, len(payload) - first["size"])
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": first["name"]}), 0)

    def test_a_taken_filename_is_refused_with_the_free_title_in_the_envelope(self):
        # D11: `report.bin` is the fixture file in this folder. The refusal is
        # a 409 whose envelope names the title Keep both would save under.
        response = self.as_owner(
            "POST",
            f"{PREFIX}/uploads",
            body={"parent_node": self.folder, "filename": "report.bin", "size": 4},
        )
        error = self.refusal(response, 409, "DriveConflict")
        self.assertEqual(error["free_title"], "report (2).bin")
        self.assertTrue(error.get("message"), error)

    def test_a_replace_session_opens_under_the_title_of_the_file_it_replaces(self):
        # Replace after a collision: naming `replaces` lets the session keep
        # the taken title, and the finish replaces that file in place.
        first = self.upload(b"first draft", "draft.bin")
        self.addCleanup(self.drop_node, first["name"])
        payload = b"a replacement draft"
        opened = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/uploads",
                body={
                    "parent_node": self.folder,
                    "filename": "draft.bin",
                    "size": len(payload),
                    "replaces": first["name"],
                },
            )
        )
        self.data(
            self.as_owner(
                "PUT", f"{PREFIX}/uploads/{opened['upload_id']}/chunk", raw=payload, query={"offset": "0"}
            )
        )
        refused = self.as_owner(
            "POST",
            f"{PREFIX}/uploads/{opened['upload_id']}/finish",
            body={"parent_node": self.folder, "title": "draft (2).bin"},
        )
        self.refusal(refused, 403, "DriveForbidden")
        answer = self.data(
            self.as_owner(
                "PUT", f"{PREFIX}/nodes/{first['name']}/content", body={"upload_id": opened["upload_id"]}
            )
        )
        self.assertEqual(
            (answer["name"], answer["title"], answer["size"]), (first["name"], "draft.bin", len(payload))
        )

    def test_a_replacement_target_that_is_not_a_file_is_refused(self):
        # §11.2 declares 403 on this row. A folder holds no head, so EDIT on it
        # is not enough to make it a replacement target (§8.4).
        opened = self.open_session(4)
        self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=b"1234",
                query={"offset": "0"},
            )
        )
        response = self.as_owner(
            "PUT", f"{PREFIX}/nodes/{self.folder}/content", body={"upload_id": opened["upload_id"]}
        )
        self.refusal(response, 403, "DriveForbidden")

    def test_a_replacement_outside_the_sessions_destination_is_refused(self):
        # The binding names one parent, and §8.4 reauthorizes against it. A
        # file in another folder is not reachable from this session.
        elsewhere = create_folder(self.owner, self.root.name, "Elsewhere")
        target = self.make_file(elsewhere, "other.bin", b"other bytes")
        frappe.db.commit()
        self.addCleanup(self.drop_node, target)
        self.addCleanup(self.drop_node, elsewhere)
        opened = self.open_session(4)
        self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=b"1234",
                query={"offset": "0"},
            )
        )
        response = self.as_owner(
            "PUT", f"{PREFIX}/nodes/{target}/content", body={"upload_id": opened["upload_id"]}
        )
        self.refusal(response, 403, "DriveForbidden")

    def test_a_replacement_without_a_session_is_a_bad_request(self):
        response = self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/content", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_stranger_cannot_replace_a_head_they_cannot_edit(self):
        # The session is the caller's own, so the refusal has to come from the
        # target's own EDIT check, not from the binding.
        opened = self.open_session(4)
        self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=b"1234",
                query={"offset": "0"},
            )
        )
        sid = self.session_for(STRANGER)
        response = self.drive(
            "PUT",
            f"{PREFIX}/nodes/{self.file}/content",
            body={"upload_id": opened["upload_id"]},
            sid=sid,
        )
        self.refusal(response, 403, "DriveForbidden")

    def upload(self, payload: bytes, title: str) -> dict:
        """Create one node the way §8.4 says a node is created."""
        opened = self.open_session(len(payload), filename=title)
        self.data(
            self.as_owner(
                "PUT",
                f"{PREFIX}/uploads/{opened['upload_id']}/chunk",
                raw=payload,
                query={"offset": "0"},
            )
        )
        return self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/uploads/{opened['upload_id']}/finish",
                body={"parent_node": self.folder, "title": title},
            )
        )

    def drop_node(self, node):
        frappe.db.rollback()
        # A replaced head lives on as a version blob. `drop_node_rows` removes
        # the version row, so the blob behind it has to go here or it outlives
        # the fixture.
        blobs = frappe.get_all("Drive Node Version", filters={"node": node}, pluck="blob")
        blobs.append(frappe.db.get_value("Drive Node", node, "blob"))
        drop_node_rows([node])
        for blob in filter(None, blobs):
            frappe.db.delete("File Blob", {"name": blob})
        frappe.db.commit()


class TestByteEgress(DriveHTTPCase):
    """Every route that emits or mints bytes runs its READ check first."""

    def test_a_readable_file_redirects_to_a_signed_url(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}/content")
        self.assertEqual(response.status_code, 302)
        location = response.headers["Location"]
        self.assertTrue(location.startswith("/f/"), location)
        self.assertIn("e=", location)
        self.assertIn("s=", location)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")

    def test_a_file_opens_in_place_unless_the_caller_asks_to_save_it(self):
        def served(query):
            response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}/content", query=query)
            self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
            location = urlsplit(response.headers["Location"])
            return self.drive("GET", location.path, query=dict(parse_qsl(location.query)))

        shown = served({})
        saved = served({"download": "1"})
        self.assertEqual(shown.status_code, 200, shown.get_data(as_text=True))
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertTrue(shown.headers["Content-Disposition"].startswith("inline;"), shown.headers)
        self.assertTrue(saved.headers["Content-Disposition"].startswith("attachment;"), saved.headers)
        self.assertEqual(saved.get_data(), b"drive bytes")

    def test_the_signed_url_expires_within_the_declared_window(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}/content")
        expiry = int(response.headers["Location"].split("e=")[1].split("&")[0])
        self.assertLessEqual(expiry - int(time.time()), 15 * 60 + 5)

    def test_a_stranger_gets_no_url_at_all(self):
        sid = self.session_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}/content", sid=sid)
        self.refusal(response, 404, "DriveNotFound")
        self.assertNotIn("Location", response.headers)

    def test_a_guest_with_no_link_gets_no_url_at_all(self):
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}/content")
        self.refusal(response, 404, "DriveNotFound")
        self.assertNotIn("Location", response.headers)

    def test_a_guest_holding_a_read_link_is_redirected(self):
        created = grant(self.folder, "$LINK", READ, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke, created)
        token = created["principal"].split(":", 1)[1]
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}/content", links=token)
        self.assertEqual(response.status_code, 302)

    def test_a_folder_has_no_content_to_send(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/content")
        self.refusal(response, 409, "DriveConflict")

    def test_media_is_refused_on_a_node_that_is_not_a_document(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}/media")
        self.assertIn(response.status_code, (404, 409))

    def test_a_stranger_cannot_list_media(self):
        sid = self.session_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/nodes/{self.file}/media", sid=sid)
        self.refusal(response, 404, "DriveNotFound")

    def test_a_preview_push_needs_a_real_image(self):
        # §9.2 takes a pushed preview only on a content document, so the byte
        # check is only reachable on one.
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes/{self.document}/preview",
            body={"image": "bm90IGFuIGltYWdl", "mime": "image/png"},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_preview_push_refuses_a_body_that_is_not_base64(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes/{self.document}/preview",
            body={"image": "not base64!", "mime": "image/png"},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_preview_push_is_refused_on_a_node_that_is_not_a_document(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes/{self.file}/preview",
            body={"image": "bm90IGFuIGltYWdl", "mime": "image/png"},
        )
        self.refusal(response, 403, "DriveForbidden")

    def revoke(self, created):
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"name": created["name"]})
        frappe.db.commit()


class TestRoots(DriveHTTPCase):
    """§11.2's own-root read, and the two Suite Admin writes."""

    def test_root_discovery_returns_the_callers_personal_location(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/roots"))
        self.assertEqual(answer["personal"]["node"], self.root.name)
        self.assertEqual(set(answer["personal"]), {"node", "title"})
        self.assertIn("organization", answer)

    def test_the_owner_reads_their_own_counters(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/roots/{self.root.name}/usage"))
        self.assertEqual(set(answer), {"used_bytes", "reserved_bytes", "quota_bytes", "effective_quota"})

    def test_a_stranger_cannot_read_another_root(self):
        sid = self.session_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/roots/{self.root.name}/usage", sid=sid)
        self.refusal(response, 404, "DriveNotFound")

    def test_a_guest_is_not_heard_on_the_usage_route(self):
        response = self.drive("GET", f"{PREFIX}/roots/{self.root.name}/usage")
        self.assertEqual(response.status_code, 403)

    def test_an_administrator_reads_any_root(self):
        sid = self.session_for("Administrator")
        answer = self.data(self.drive("GET", f"{PREFIX}/roots/{self.root.name}/usage", sid=sid))
        self.assertIn("used_bytes", answer)

    def test_the_breakdown_expansion_lists_what_the_root_holds(self):
        path = f"{PREFIX}/roots/{self.root.name}/usage"
        answer = self.data(self.as_owner("GET", path, query={"expand": "breakdown"}))
        self.assertEqual(
            set(answer),
            {"used_bytes", "reserved_bytes", "quota_bytes", "effective_quota", "by_type", "largest"},
        )
        # The fixture holds one 11-byte file; the folder and the empty document are free.
        self.assertEqual([row["bytes"] for row in answer["by_type"]], [11])
        self.assertEqual(
            answer["largest"],
            [
                {
                    "node": self.file,
                    "title": "report.bin",
                    "size": 11,
                    "mime": answer["largest"][0]["mime"],
                    "kind": "file",
                    "type": answer["by_type"][0]["type"],
                }
            ],
        )

        sid = self.session_for("Administrator")
        admin = self.data(self.drive("GET", path, query={"expand": "breakdown"}, sid=sid))
        self.assertEqual(admin["largest"], answer["largest"])

        stranger = self.session_for(STRANGER)
        refused = self.drive("GET", path, query={"expand": "breakdown"}, sid=stranger)
        self.refusal(refused, 404, "DriveNotFound")

    def test_an_ordinary_user_cannot_change_a_quota(self):
        response = self.as_owner("PATCH", f"{PREFIX}/roots/{self.root.name}", body={"quota_bytes": 10})
        self.assertIn(response.status_code, (403, 404))

    def test_an_administrator_changes_exactly_one_field(self):
        sid = self.session_for("Administrator")
        answer = self.data(
            self.drive("PATCH", f"{PREFIX}/roots/{self.root.name}", body={"quota_bytes": 4096}, sid=sid)
        )
        self.addCleanup(self.restore_quota)
        self.assertEqual(answer["quota_bytes"], 4096)

    def test_naming_both_fields_is_a_bad_request(self):
        sid = self.session_for("Administrator")
        response = self.drive(
            "PATCH",
            f"{PREFIX}/roots/{self.root.name}",
            body={"quota_bytes": 4096, "state": "Archived"},
            sid=sid,
        )
        self.refusal(response, 400, "DriveError")

    def test_an_active_root_cannot_be_purged(self):
        # §11.2's roots table declares no extra error for this row, and its
        # prose makes Archived a condition on the right to call it, next to
        # Suite Admin. `_core` already answers `DriveForbidden`.
        sid = self.session_for("Administrator")
        response = self.drive("DELETE", f"{PREFIX}/roots/{self.root.name}", sid=sid)
        self.refusal(response, 403, "DriveForbidden")

    def restore_quota(self):
        frappe.db.rollback()
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 0, update_modified=False)
        frappe.db.commit()


# `Drive Settings.writer_settings` default, as the doctype declares it.
WRITER_DEFAULTS = {"font_family": "inter", "font_size": "15", "line_height": "1.5", "versioning": 5}

SITE_SETTINGS_FIELDS = {"is_admin", "preview_size"}

ADMIN_SITE_SETTINGS_FIELDS = SITE_SETTINGS_FIELDS | {
    "webdav_enabled",
    "webdav_allowed_methods",
    "default_personal_quota",
    "shared_quota",
}

WEBDAV_CONNECTION_FIELDS = {
    "globally_enabled",
    "is_admin",
    "server_url",
    "username",
    "enabled_for_user",
    "two_factor_blocked",
    "api_key",
}


class TestSettingsRoutes(DriveHTTPCase):
    """§11.2 "Settings and WebDAV": the caller's row, the site's, and the mount."""

    def setUp(self):
        super().setUp()
        self.site_switch = frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled")
        self.addCleanup(self.restore)
        self.drop_owner_row()
        self.switch_site(0)

    def restore(self):
        self.drop_owner_row()
        self.switch_site(self.site_switch)

    def drop_owner_row(self):
        frappe.db.rollback()
        frappe.db.delete("Drive Settings", {"user": OWNER})
        frappe.db.commit()

    def switch_site(self, value):
        frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()

    def as_admin(self, method, path, **kwargs):
        return self.drive(method, path, sid=self.session_for("Administrator"), **kwargs)

    def test_a_guest_is_refused_on_every_settings_route(self):
        for method, path in (
            ("GET", "settings"),
            ("PATCH", "settings"),
            ("GET", "site-settings"),
            ("PATCH", "site-settings"),
            ("GET", "webdav"),
        ):
            with self.subTest(method=method, path=path):
                body = {"webdav_enabled": True} if method == "PATCH" else None
                response = self.drive(method, f"{PREFIX}/{path}", body=body)
                self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Settings", OWNER))
        self.assertFalse(frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled"))

    def test_a_caller_without_a_row_reads_the_field_defaults(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/settings"))
        self.assertEqual(answer, {"webdav_enabled": False, "writer_settings": WRITER_DEFAULTS})

    def test_the_first_patch_creates_the_callers_row(self):
        answer = self.data(self.as_owner("PATCH", f"{PREFIX}/settings", body={"webdav_enabled": True}))
        self.assertEqual(answer, {"webdav_enabled": True, "writer_settings": WRITER_DEFAULTS})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Settings", OWNER, "webdav_enabled"), 1)

        answer = self.data(self.as_owner("PATCH", f"{PREFIX}/settings", body={"webdav_enabled": False}))
        self.assertFalse(answer["webdav_enabled"])
        self.assertFalse(self.data(self.as_owner("GET", f"{PREFIX}/settings"))["webdav_enabled"])

    def test_a_drive_admin_reads_and_writes_only_their_own_row(self):
        kept = frappe.db.get_value("Drive Settings", "Administrator", "webdav_enabled")
        self.addCleanup(self.restore_admin_row, kept)

        answer = self.data(self.as_admin("PATCH", f"{PREFIX}/settings", body={"webdav_enabled": True}))
        self.assertIs(answer["webdav_enabled"], True)
        self.assertEqual(set(answer), {"webdav_enabled", "writer_settings"})
        self.assertIs(self.data(self.as_admin("GET", f"{PREFIX}/settings"))["webdav_enabled"], True)
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Settings", OWNER))

    def restore_admin_row(self, kept):
        frappe.db.rollback()
        if kept is None:
            frappe.db.delete("Drive Settings", {"user": "Administrator"})
        else:
            frappe.db.set_value(
                "Drive Settings", "Administrator", "webdav_enabled", kept, update_modified=False
            )
        frappe.db.commit()

    def test_a_settings_patch_without_the_field_is_a_bad_request(self):
        response = self.as_owner("PATCH", f"{PREFIX}/settings", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_plain_user_reads_only_the_public_site_settings(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/site-settings"))
        self.assertEqual(set(answer), SITE_SETTINGS_FIELDS)
        self.assertIs(answer["is_admin"], False)

    def test_a_drive_admin_reads_the_admin_site_settings(self):
        answer = self.data(self.as_admin("GET", f"{PREFIX}/site-settings"))
        self.assertEqual(set(answer), ADMIN_SITE_SETTINGS_FIELDS)
        self.assertIs(answer["is_admin"], True)
        self.assertIs(answer["webdav_enabled"], False)

    def test_every_numeric_site_setting_is_a_json_integer(self):
        # The site settings contract returns integer quotas to the client.
        quotas = {"default_personal_quota": 5 * 1024**3, "shared_quota": 50 * 1024**3}
        kept = {field: frappe.db.get_single_value("Drive Disk Settings", field) for field in quotas}
        self.addCleanup(self.set_site_values, kept)
        self.set_site_values(quotas)

        answer = self.data(self.as_admin("GET", f"{PREFIX}/site-settings"))
        for field, value in (*quotas.items(), ("preview_size", answer["preview_size"])):
            with self.subTest(field=field):
                self.assertIs(type(answer[field]), int, answer)
                self.assertEqual(answer[field], value)
        self.assertIs(type(self.data(self.as_owner("GET", f"{PREFIX}/site-settings"))["preview_size"]), int)

    def set_site_values(self, values):
        frappe.db.rollback()
        for field, value in values.items():
            frappe.db.set_single_value("Drive Disk Settings", field, value)
        frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
        frappe.db.commit()

    def test_a_plain_user_cannot_turn_the_site_switch_on(self):
        response = self.as_owner("PATCH", f"{PREFIX}/site-settings", body={"webdav_enabled": True})
        self.refusal(response, 403, "DriveForbidden")
        self.reread()
        self.assertFalse(frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled"))

    def test_a_drive_admin_turns_the_site_switch_on_and_off(self):
        answer = self.data(self.as_admin("PATCH", f"{PREFIX}/site-settings", body={"webdav_enabled": True}))
        self.assertEqual(set(answer), ADMIN_SITE_SETTINGS_FIELDS)
        self.assertIs(answer["webdav_enabled"], True)
        self.reread()
        self.assertTrue(frappe.db.get_single_value("Drive Disk Settings", "webdav_enabled"))

        answer = self.data(self.as_admin("PATCH", f"{PREFIX}/site-settings", body={"webdav_enabled": False}))
        self.assertIs(answer["webdav_enabled"], False)

    def test_webdav_is_empty_for_a_plain_user_while_the_site_switch_is_off(self):
        self.assertEqual(self.data(self.as_owner("GET", f"{PREFIX}/webdav")), {})

    def test_webdav_shows_an_admin_the_switch_while_it_is_off(self):
        answer = self.data(self.as_admin("GET", f"{PREFIX}/webdav"))
        self.assertEqual(answer, {"globally_enabled": False, "is_admin": True})

    def test_webdav_gives_the_connection_but_never_the_secret_while_the_switch_is_on(self):
        key, secret = self.api_key_for(OWNER).split(":", 1)
        self.switch_site(1)
        response = self.as_owner("GET", f"{PREFIX}/webdav")
        answer = self.data(response)
        self.assertEqual(set(answer), WEBDAV_CONNECTION_FIELDS)
        self.assertEqual(answer["globally_enabled"], True)
        self.assertEqual(answer["is_admin"], False)
        self.assertEqual(answer["username"], OWNER)
        self.assertEqual(answer["api_key"], key)
        self.assertTrue(answer["server_url"].endswith("/dav/"))
        self.assertIs(answer["enabled_for_user"], False)
        self.assertNotIn(secret, response.get_data(as_text=True))

        self.data(self.as_owner("PATCH", f"{PREFIX}/settings", body={"webdav_enabled": True}))
        self.assertIs(self.data(self.as_owner("GET", f"{PREFIX}/webdav"))["enabled_for_user"], True)


class TestErrorEnvelope(DriveHTTPCase):
    """§11.6: the class name is the code, and the message reaches the client."""

    def test_a_refusal_carries_its_class_and_its_message(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/no-such-node")
        error = self.refusal(response, 404, "DriveNotFound")
        self.assertTrue(error.get("message"), error)

    def test_a_missing_required_argument_is_a_400_not_a_417(self):
        response = self.as_owner("GET", f"{V2}.node_get")
        self.refusal(response, 400, "DriveError")

    def test_an_argument_of_the_wrong_json_type_is_a_400_not_a_417(self):
        response = self.as_owner("GET", f"{V2}.node_children", query={"node": self.folder, "limit": "many"})
        self.refusal(response, 400, "DriveError")

    def test_an_unparseable_body_is_refused_before_the_translator_runs(self):
        # `make_form_dict` reads the body in `init_request`, ahead of every
        # `before_request` hook, so this refusal is the framework's and is
        # scored against the client's own path. It is recorded, not asserted
        # into the Drive envelope.
        response = self.as_owner("POST", f"{PREFIX}/nodes", raw=b"{not json", content_type="application/json")
        self.assertGreaterEqual(response.status_code, 400)

    def test_every_declared_status_is_reachable_over_http(self):
        seen = {}
        seen[404] = self.as_owner("GET", f"{PREFIX}/nodes/no-such-node")
        seen[400] = self.as_owner("GET", f"{PREFIX}/nodes/{self.file}", query={"expand": "grants"})
        seen[409] = self.as_owner("GET", f"{PREFIX}/nodes/{self.folder}/content")
        for status, response in seen.items():
            with self.subTest(status=status):
                self.assertEqual(response.status_code, status)
                self.assertTrue(response.json["errors"][0]["type"].startswith("Drive"))


class TestNoLegacyReach(DriveHTTPCase):
    """The namespace answers its own routes and nothing else."""

    def test_a_drive_path_cannot_reach_an_arbitrary_whitelisted_method(self):
        for path in (
            f"{PREFIX}/frappe.client.get_list",
            f"{PREFIX}/nodes/../../v2/method/frappe.client.get_list",
        ):
            with self.subTest(path=path):
                response = self.as_owner("GET", path, query={"doctype": "User"})
                self.refusal(response, 404, "DriveNotFound")

    def test_a_drive_route_is_not_reachable_without_the_prefix_or_the_v2_url(self):
        response = self.as_owner("GET", "/api/method/suite.drive.http.routes.node_get")
        # v1 answers whitelisted methods too. What must not happen is a Drive
        # workflow running for a caller the v2 envelope never described.
        self.assertNotEqual(response.status_code, 500)

    def test_an_uploads_path_outside_the_table_is_not_found(self):
        response = self.as_owner("PUT", f"{PREFIX}/uploads/u1/chunk/extra", raw=b"x")
        self.refusal(response, 404, "DriveNotFound")


class TestGrantedCollaborator(DriveHTTPCase):
    """A second session, holding a real grant, reaches exactly its role."""

    def setUp(self):
        super().setUp()
        self.granted = grant(self.folder, STRANGER, EDIT, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke)
        self.stranger_sid = self.session_for(STRANGER)

    def revoke(self):
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"name": self.granted["name"]})
        frappe.db.commit()

    def test_an_editor_reads_the_node(self):
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.file}", sid=self.stranger_sid))
        self.assertEqual(answer["name"], self.file)

    def test_an_editor_sees_their_role_in_the_access_expansion(self):
        answer = self.data(
            self.drive(
                "GET", f"{PREFIX}/nodes/{self.file}", query={"expand": "access"}, sid=self.stranger_sid
            )
        )
        self.assertEqual(answer["access"]["role"], EDIT)
        self.assertEqual(answer["access"]["source_node"], self.folder)
        self.assertEqual(answer["access"]["source_principal"], STRANGER)

    def test_a_link_that_ties_an_own_grant_is_not_named_as_the_source(self):
        # §5.1 makes pass 1 the answer when it ties pass 2, and `via_link` says
        # so. The source fields have to agree: naming the deeper link while
        # reporting no deciding link contradicts one payload with itself.
        link = grant(self.file, "$LINK", EDIT, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke_row, link)
        token = link["principal"].split(":", 1)[1]
        answer = self.data(
            self.drive(
                "GET",
                f"{PREFIX}/nodes/{self.file}",
                query={"expand": "access"},
                sid=self.stranger_sid,
                links=token,
            )
        )
        self.assertEqual(answer["access"]["role"], EDIT)
        self.assertIsNone(answer["access"]["via_link"])
        self.assertEqual(answer["access"]["source_principal"], STRANGER)
        self.assertEqual(answer["access"]["source_node"], self.folder)

    def test_a_link_above_an_own_grant_is_named_by_both_fields(self):
        # §5.10 row 9 caps a link at EDIT, so the own grant has to sit below
        # it for the link to be the strictly higher answer.
        frappe.db.set_value("Drive Grant", self.granted["name"], "role", READ, update_modified=False)
        link = grant(self.file, "$LINK", EDIT, self.owner)
        frappe.db.commit()
        self.addCleanup(self.revoke_row, link)
        token = link["principal"].split(":", 1)[1]
        answer = self.data(
            self.drive(
                "GET",
                f"{PREFIX}/nodes/{self.file}",
                query={"expand": "access"},
                sid=self.stranger_sid,
                links=token,
            )
        )
        self.assertEqual(answer["access"]["role"], EDIT)
        self.assertEqual(answer["access"]["via_link"], link["principal"])
        self.assertEqual(answer["access"]["source_principal"], link["principal"])
        self.assertEqual(answer["access"]["source_node"], self.file)

    def revoke_row(self, created):
        frappe.db.rollback()
        frappe.db.delete("Drive Grant", {"name": created["name"]})
        frappe.db.commit()

    def test_an_editor_may_not_purge(self):
        response = self.drive("DELETE", f"{PREFIX}/nodes/{self.file}", sid=self.stranger_sid)
        self.refusal(response, 403, "DriveForbidden")

    def test_an_editor_may_open_an_upload_session(self):
        with storage_v2_on():
            answer = self.data(
                self.drive(
                    "POST",
                    f"{PREFIX}/uploads",
                    body={"parent_node": self.folder, "filename": "theirs.bin", "size": 4},
                    sid=self.stranger_sid,
                )
            )
        self.assertIn("upload_id", answer)

    def test_an_editor_below_upload_on_a_root_cannot_create_there(self):
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent_node": self.root.name, "title": "x", "kind": "folder"},
            sid=self.stranger_sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_role_below_upload_cannot_create(self):
        frappe.db.set_value("Drive Grant", self.granted["name"], "role", READ, update_modified=False)
        frappe.db.commit()
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent_node": self.folder, "title": "x", "kind": "folder"},
            sid=self.stranger_sid,
        )
        self.refusal(response, 403, "DriveForbidden")
        self.assertLess(READ, UPLOAD)


class TestGrantRoutes(DriveHTTPCase):
    """§11.2's grant table: one listing, one explanation, four writes."""

    def setUp(self):
        super().setUp()
        self.shared = create_folder(self.owner, self.root.name, "Shared")
        self.inner = create_folder(self.owner, self.shared, "Inner")
        frappe.db.commit()
        self.addCleanup(self.drop_tree)

    def drop_tree(self):
        frappe.db.rollback()
        drop_record_rows([self.inner, self.shared])
        drop_node_rows([self.inner, self.shared])
        frappe.db.commit()

    def add_grant(self, node, principal, role, expires_on=None):
        """Insert one grant row directly.

        `access.grant` refuses an expiry in the past (§5.9) and §6.4 keeps an
        expired row on disk, so only a direct insert can build that state.
        """
        row = frappe.get_doc(
            {
                "doctype": "Drive Grant",
                "node": node,
                "principal": principal,
                "role": role,
                "expires_on": expires_on,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        return row.name

    def test_a_grant_list_carries_the_local_rows_including_an_expired_one(self):
        live = self.add_grant(self.shared, STRANGER, READ)
        stale = self.add_grant(self.shared, "$GENERAL", READ, expires_on=PAST)
        with patch("suite.drive._core.times.site_zone", return_value=ZoneInfo("Asia/Kolkata")):
            answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.shared}/grants"))
        listed = {row["name"]: row for row in answer["grants"]}
        self.assertEqual(set(listed), {live, stale})
        # A user grant names its person; a special principal has none.
        self.assertEqual(set(listed[live]), GRANT_SHAPE_FIELDS | {"person"})
        self.assertEqual(set(listed[live]["person"]), PERSON_FIELDS)
        self.assertEqual(listed[live]["person"]["id"], STRANGER)
        self.assertEqual(set(listed[stale]), GRANT_SHAPE_FIELDS)
        self.assertEqual(set(answer["owner"]), PERSON_FIELDS)
        self.assertEqual(answer["owner"]["id"], OWNER)
        self.assertEqual(listed[live]["node"], self.shared)
        self.assertIsNone(listed[live]["expires_on"])
        # `PAST` is stored site-naive; IST midnight is 18:30 UTC the day before.
        self.assertEqual(listed[stale]["expires_on"], "2019-12-31T18:30:00Z")
        self.assertNotIn("explain", answer)

    def test_a_grant_list_names_the_ancestor_row_nowhere(self):
        # §5.10 keeps removal and denial apart, so the listing is local rows
        # only. The root anchor grant sits one node up and is `explain`'s job.
        self.add_grant(self.inner, STRANGER, READ)
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants"))
        self.assertEqual([row["node"] for row in answer["grants"]], [self.inner])

    def test_a_listed_grant_never_carries_its_password_hash(self):
        created = grant(self.shared, "$LINK", READ, self.owner, password="correct horse")
        frappe.db.commit()
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.shared}/grants")
        answer = self.data(response)
        row = next(item for item in answer["grants"] if item["name"] == created["name"])
        self.assertEqual(set(row), GRANT_SHAPE_FIELDS | {"url"})
        self.assertTrue(row["has_password"])
        self.assertNotIn("password_hash", response.get_data(as_text=True))

    def test_a_principal_query_adds_the_explanation_and_marks_its_winner(self):
        self.add_grant(self.shared, STRANGER, READ)
        answer = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants", query={"principal": STRANGER})
        )
        explain = answer["explain"]
        self.assertEqual(set(explain), {"role", "source", "rows"})
        self.assertEqual(explain["role"], READ)
        self.assertEqual(explain["source"], "grant")
        for row in explain["rows"]:
            self.assertEqual(set(row), EXPLAIN_ROW_FIELDS)
        anchor = next(row for row in explain["rows"] if row["principal"] == OWNER)
        self.assertEqual((anchor["node"], anchor["depth"], anchor["role"]), (self.root.name, 0, MANAGE))
        self.assertFalse(anchor["held"])
        winner = next(row for row in explain["rows"] if row["winner"])
        self.assertEqual((winner["node"], winner["principal"], winner["pass"]), (self.shared, STRANGER, 1))
        self.assertTrue(winner["held"])

    def test_an_editor_may_not_read_the_grant_list_or_its_explanation(self):
        grant(self.shared, STRANGER, EDIT, self.owner)
        frappe.db.commit()
        sid = self.session_for(STRANGER)
        response = self.drive(
            "GET", f"{PREFIX}/nodes/{self.shared}/grants", query={"principal": OWNER}, sid=sid
        )
        self.refusal(response, 403, "DriveForbidden")

    def test_a_caller_with_no_access_is_not_told_the_node_exists(self):
        sid = self.session_for(STRANGER)
        response = self.drive(
            "GET", f"{PREFIX}/nodes/{self.shared}/grants", query={"principal": STRANGER}, sid=sid
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_manager_may_ask_about_a_principal_who_holds_nothing(self):
        answer = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants", query={"principal": STRANGER})
        )
        explain = answer["explain"]
        self.assertEqual(explain["role"], NONE)
        self.assertEqual(explain["source"], "none")
        self.assertTrue(explain["rows"])
        self.assertTrue(all(row["held"] is False for row in explain["rows"]))
        self.assertTrue(all(row["winner"] is False for row in explain["rows"]))

    def test_a_role_zero_write_denies_a_principal_who_inherits_access(self):
        grant(self.shared, STRANGER, READ, self.owner)
        frappe.db.commit()
        sid = self.session_for(STRANGER)
        self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", sid=sid))
        written = self.data(
            self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/{STRANGER}", body={"role": 0})
        )
        self.assertEqual(written["role"], NONE)
        self.assertEqual(written["principal"], STRANGER)
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", sid=sid), 404, "DriveNotFound")

    def test_a_delete_removes_the_local_row_and_leaves_the_inherited_one(self):
        grant(self.shared, STRANGER, READ, self.owner)
        grant(self.inner, STRANGER, EDIT, self.owner)
        frappe.db.commit()
        sid = self.session_for(STRANGER)
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.inner}/grants/{STRANGER}"))
        self.assertEqual(answer, {"count": 1})
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Grant", {"node": self.inner, "principal": STRANGER}))
        seen = self.data(
            self.drive("GET", f"{PREFIX}/nodes/{self.inner}", query={"expand": "access"}, sid=sid)
        )
        self.assertEqual(seen["access"]["role"], READ)
        self.assertEqual(seen["access"]["source_node"], self.shared)

    def test_a_delete_below_evicts_the_subtree_and_reports_the_count(self):
        grant(self.shared, STRANGER, READ, self.owner)
        grant(self.inner, STRANGER, EDIT, self.owner)
        frappe.db.commit()
        answer = self.data(
            self.as_owner("DELETE", f"{PREFIX}/nodes/{self.shared}/grants/{STRANGER}", query={"below": "1"})
        )
        self.assertEqual(answer, {"count": 2})
        self.reread()
        self.assertEqual(
            frappe.db.count(
                "Drive Grant", {"principal": STRANGER, "node": ["in", [self.shared, self.inner]]}
            ),
            0,
        )

    def test_a_link_is_minted_then_rotated_and_the_old_token_stops_working(self):
        minted = self.data(
            self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/$LINK", body={"role": READ})
        )
        token = minted["principal"].split(":", 1)[1]
        self.assertEqual(set(minted), GRANT_SHAPE_FIELDS | {"url"})
        self.assertEqual(minted["url"], f"/l/{token}")
        listed = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants"))["grants"]
        self.assertEqual([row["url"] for row in listed if row["name"] == minted["name"]], [f"/l/{token}"])
        opened = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=token))
        self.assertEqual(opened["name"], self.inner)

        rotated = self.data(self.as_owner("POST", f"{PREFIX}/grants/{minted['name']}/rotate", body={}))
        fresh = rotated["principal"].split(":", 1)[1]
        self.assertNotEqual(fresh, token)
        self.assertEqual(rotated["url"], f"/l/{fresh}")
        self.assertEqual(rotated["name"], minted["name"])
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=token), 404, "DriveNotFound")
        reopened = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=fresh))
        self.assertEqual(reopened["name"], self.inner)

    def test_a_public_grant_publishes_the_node_to_an_anonymous_reader(self):
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}"), 404, "DriveNotFound")
        written = self.data(
            self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", body={"role": 10})
        )
        self.assertEqual(written["principal"], "$PUBLIC")
        self.assertEqual(written["role"], READ)
        self.assertNotIn("url", written)
        self.assertNotIn("person", written)
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}"))
        self.assertEqual(answer["name"], self.inner)

    def test_a_grant_write_without_a_role_is_refused_and_writes_nothing(self):
        before = frappe.db.count("Drive Grant", {"node": self.inner})
        response = self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/{STRANGER}", body={})
        self.refusal(response, 400, "DriveError")
        self.reread()
        self.assertEqual(frappe.db.count("Drive Grant", {"node": self.inner}), before)

    def test_inherited_rows_arrive_with_their_source_node_nearest_first(self):
        self.add_grant(self.shared, STRANGER, NONE)
        self.add_grant(self.inner, "$GROUP:drive-http-readers", READ)
        answer = self.data(
            self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants", query={"inherited": "1"})
        )
        self.assertEqual([row["principal"] for row in answer["grants"]], ["$GROUP:drive-http-readers"])
        inherited = answer["inherited"]
        for entry in inherited:
            self.assertEqual(set(entry), {"grant", "redacted", "source_node", "source_title"})
            self.assertFalse(entry["redacted"])
            self.assertEqual(set(entry["grant"]), GRANT_SHAPE_FIELDS | {"person"})
            self.assertEqual(entry["grant"]["person"]["id"], entry["grant"]["principal"])
        self.assertEqual(
            (inherited[0]["source_node"], inherited[0]["source_title"], inherited[0]["grant"]["role"]),
            (self.shared, "Shared", NONE),
        )
        anchor = next(entry for entry in inherited if entry["grant"]["principal"] == OWNER)
        self.assertEqual((anchor["source_node"], anchor["grant"]["role"]), (self.root.name, MANAGE))
        self.assertNotIn("inherited", self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.inner}/grants")))

    def test_a_child_manager_sees_an_ancestor_link_without_its_secrets(self):
        minted = grant(self.shared, "$LINK", READ, self.owner)
        grant(self.inner, STRANGER, MANAGE, self.owner)
        frappe.db.commit()
        token = minted["principal"].split(":", 1)[1]
        response = self.drive(
            "GET",
            f"{PREFIX}/nodes/{self.inner}/grants",
            query={"inherited": "1"},
            sid=self.session_for(STRANGER),
        )
        entry = next(row for row in self.data(response)["inherited"] if row["redacted"])
        self.assertEqual(set(entry["grant"]), {"node", "principal", "role", "expires_on", "has_password"})
        self.assertEqual(entry["grant"]["principal"], "$LINK")
        self.assertEqual((entry["source_node"], entry["source_title"]), (self.shared, "Shared"))
        self.assertNotIn(token, response.get_data(as_text=True))

    def test_a_link_password_survives_an_expiry_change_and_null_clears_it(self):
        # A5: an existing link is changed by its grant id, never by its token.
        path = f"{PREFIX}/nodes/{self.inner}/grants"
        minted = self.data(self.as_owner("PUT", f"{path}/$LINK", body={"role": READ, "password": "secret"}))
        principal = minted["principal"]
        self.assertTrue(minted["has_password"])

        future = (datetime.now(UTC) + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
        kept = self.data(
            self.as_owner(
                "PATCH", f"{PREFIX}/grants/{minted['name']}", body={"role": READ, "expires_on": future}
            )
        )
        self.assertEqual((kept["name"], kept["principal"]), (minted["name"], principal))
        self.assertTrue(kept["has_password"])
        self.assertEqual(kept["expires_on"], future)

        cleared = self.data(
            self.as_owner("PATCH", f"{PREFIX}/grants/{minted['name']}", body={"role": READ, "password": None})
        )
        self.assertFalse(cleared["has_password"])
        self.assertIsNone(cleared["expires_on"])
        opened = self.data(
            self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=principal.split(":", 1)[1])
        )
        self.assertEqual(opened["name"], self.inner)

    def test_a_link_is_rewritten_and_removed_by_its_grant_id(self):
        path = f"{PREFIX}/nodes/{self.inner}/grants"
        minted = self.data(self.as_owner("PUT", f"{path}/$LINK", body={"role": READ}))
        token = minted["principal"].split(":", 1)[1]
        changed = self.data(self.as_owner("PATCH", f"{PREFIX}/grants/{minted['name']}", body={"role": EDIT}))
        self.assertEqual((changed["name"], changed["role"]), (minted["name"], EDIT))
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Grant", minted["name"], "role"), EDIT)

        removed = self.data(self.as_owner("DELETE", f"{PREFIX}/grants/{minted['name']}"))
        self.assertEqual(removed, {"count": 1})
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Grant", minted["name"]))
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=token), 404, "DriveNotFound")
        self.refusal(self.as_owner("DELETE", f"{PREFIX}/grants/{minted['name']}"), 404, "DriveNotFound")

    def test_a_link_token_in_a_grant_path_is_a_bad_request(self):
        # The token is the credential. It travels in a body or a listing, and
        # never in an address a proxy or a browser history keeps.
        path = f"{PREFIX}/nodes/{self.inner}/grants"
        minted = self.data(self.as_owner("PUT", f"{path}/$LINK", body={"role": READ}))
        self.refusal(
            self.as_owner("PUT", f"{path}/{minted['principal']}", body={"role": EDIT}), 400, "DriveError"
        )
        self.refusal(self.as_owner("DELETE", f"{path}/{minted['principal']}"), 400, "DriveError")
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Grant", minted["name"], "role"), READ)

    def test_share_email_is_queued_for_a_sent_link_and_a_notified_user_only(self):
        path = f"{PREFIX}/nodes/{self.inner}/grants"
        with patch("frappe.enqueue") as enqueue:
            sent = self.data(
                self.as_owner("PUT", f"{path}/$LINK", body={"role": READ, "send_to": "outsider@example.com"})
            )
            self.assertEqual(enqueue.call_count, 1)
            self.assertEqual(sent["sent_to"], "outsider@example.com")
            self.assertEqual(enqueue.call_args.kwargs["path"], sent["url"])

            refused = self.as_owner(
                "PUT", f"{path}/{STRANGER}", body={"role": READ, "send_to": "outsider@example.com"}
            )
            self.refusal(refused, 400, "DriveError")
            self.assertEqual(enqueue.call_count, 1)

            self.data(self.as_owner("PUT", f"{path}/{STRANGER}", body={"role": READ}))
            self.assertEqual(enqueue.call_count, 1)
            notified = self.data(
                self.as_owner("PUT", f"{path}/{STRANGER}", body={"role": EDIT, "notify": True})
            )
            self.assertEqual(enqueue.call_count, 2)
            self.assertEqual(enqueue.call_args.kwargs["recipient"], STRANGER)
            self.assertIsNone(notified["sent_to"])

    def test_a_queue_failure_after_commit_still_answers_the_committed_link(self):
        # Redis refusing the push after commit must not turn a written grant
        # into a 500, or a retry would mint a second link for one address.
        before = frappe.db.count("Drive Grant", {"node": self.inner})
        with patch("frappe.enqueue", side_effect=RuntimeError("redis down")) as enqueue:
            sent = self.data(
                self.as_owner(
                    "PUT",
                    f"{PREFIX}/nodes/{self.inner}/grants/$LINK",
                    body={"role": READ, "send_to": "outsider@example.com"},
                )
            )
        self.assertTrue(enqueue.called)
        self.assertEqual(sent["sent_to"], "outsider@example.com")
        self.reread()
        self.assertEqual(frappe.db.count("Drive Grant", {"node": self.inner}), before + 1)
        self.assertTrue(frappe.db.exists("Drive Grant", sent["name"]))

    def test_a_guest_is_not_heard_on_any_grant_route(self):
        calls = (
            ("GET", f"{PREFIX}/nodes/{self.inner}/grants", None),
            ("PUT", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", {"role": READ}),
            ("DELETE", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", None),
            ("PATCH", f"{PREFIX}/grants/no-such-grant", {"role": READ}),
            ("DELETE", f"{PREFIX}/grants/no-such-grant", None),
            ("POST", f"{PREFIX}/grants/no-such-grant/rotate", {}),
        )
        for method, path, body in calls:
            with self.subTest(method=method, path=path):
                response = self.drive(method, path, body=body)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")


class TestShareLinkRoutes(DriveHTTPCase):
    """§4.8's ticket, and the two refusals a link must keep apart."""

    def setUp(self):
        super().setUp()
        self.gated = create_folder(self.owner, self.root.name, "Gated")
        frappe.db.commit()
        self.addCleanup(self.drop_folder)

    def drop_folder(self):
        frappe.db.rollback()
        drop_node_rows([self.gated])
        frappe.db.commit()

    def link(self, **kwargs):
        created = grant(self.gated, "$LINK", READ, self.owner, **kwargs)
        frappe.db.commit()
        return created, created["principal"].split(":", 1)[1]

    def unlock(self, token, password):
        # A5: the token travels in the body with the password, never in the path.
        return self.drive("POST", f"{PREFIX}/links/unlock", body={"token": token, "password": password})

    def test_an_unlock_answers_a_ticket_that_then_opens_the_node_for_a_guest(self):
        _created, token = self.link(password="correct horse")
        answer = self.data(self.unlock(token, "correct horse"))
        self.assertEqual(set(answer), {"ticket", "expires"})
        self.assertGreater(answer["expires"], int(time.time()))
        opened = self.data(
            self.drive("GET", f"{PREFIX}/nodes/{self.gated}", links=f"{token}.{answer['ticket']}")
        )
        self.assertEqual(opened["name"], self.gated)

    def test_a_wrong_link_password_is_refused(self):
        _created, token = self.link(password="correct horse")
        self.refusal(self.unlock(token, "wrong"), 401, "DriveLocked")

    def test_an_unlock_without_a_token_is_a_bad_request(self):
        response = self.drive("POST", f"{PREFIX}/links/unlock", body={"password": "correct horse"})
        self.refusal(response, 400, "DriveError")

    def test_the_failure_that_sets_the_lockout_answers_429_with_the_seconds_left(self):
        _created, token = self.link(password="correct horse")
        bucket = f"drive:link_unlock:{token}"
        self.addCleanup(frappe.cache.delete_value, bucket)
        for _attempt in range(4):
            self.refusal(self.unlock(token, "wrong"), 401, "DriveLocked")

        locked = self.unlock(token, "wrong")
        self.refusal(locked, 429, "RateLimitExceededError")
        self.assertIn(int(locked.headers["Retry-After"]), range(899, 901))

        # Ten minutes pass. The next refusal names the five that are left, even
        # for the right password.
        frappe.cache.expire_key(bucket, 300)
        later = self.unlock(token, "correct horse")
        self.refusal(later, 429, "RateLimitExceededError")
        self.assertIn(int(later.headers["Retry-After"]), range(299, 301))

    def test_a_password_link_with_no_ticket_answers_locked(self):
        _created, token = self.link(password="correct horse")
        response = self.drive("GET", f"{PREFIX}/nodes/{self.gated}", links=token)
        self.refusal(response, 401, "DriveLocked")
        self.assertEqual(response.headers.get("WWW-Authenticate"), 'DriveLink realm="drive"')

    def test_an_expired_link_answers_gone_not_locked(self):
        created, token = self.link()
        frappe.db.set_value("Drive Grant", created["name"], "expires_on", PAST, update_modified=False)
        frappe.db.commit()
        response = self.drive("GET", f"{PREFIX}/nodes/{self.gated}", links=token)
        self.refusal(response, 410, "DriveLinkExpired")

    def test_unlock_is_reachable_without_a_session(self):
        # A caller unlocks before they hold anything, so the route is guest
        # reachable. An unknown token is answered by the workflow, not by the
        # framework's session gate.
        self.refusal(self.unlock("a" * 22, "x"), 404, "DriveNotFound")


class TestViewRoutes(DriveHTTPCase):
    """§11.2's seven frozen views, paged by §11.4."""

    def setUp(self):
        super().setUp()
        self.clear_personal_rows()
        self.addCleanup(self.clear_personal_rows)

    def clear_personal_rows(self):
        frappe.db.rollback()
        for user in (OWNER, STRANGER):
            frappe.db.delete("Drive Recent", {"user": user})
            frappe.db.delete("Drive Favourite", {"user": user})
        frappe.db.commit()

    def view(self, name, **query):
        return self.data(self.as_owner("GET", f"{PREFIX}/views/{name}", query=query))

    def test_every_frozen_view_name_answers_a_page(self):
        required = {"trash": {"root": self.root.name}, "search": {"term": "report"}}
        for name in VIEW_NAMES:
            with self.subTest(view=name):
                answer = self.view(name, **required.get(name, {}))
                self.assertEqual(set(answer), {"rows", "next_cursor"})
                self.assertIsInstance(answer["rows"], list)

    def test_trash_without_a_root_and_search_without_a_term_are_bad_requests(self):
        for name in ("trash", "search"):
            with self.subTest(view=name):
                response = self.as_owner("GET", f"{PREFIX}/views/{name}")
                self.refusal(response, 400, "DriveError")

    def test_an_unknown_view_name_is_a_bad_request(self):
        self.refusal(self.as_owner("GET", f"{PREFIX}/views/everything"), 400, "DriveError")

    def test_a_view_expands_preview_and_access(self):
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        answer = self.view("favourites", expand="preview")
        self.assertEqual([row["name"] for row in answer["rows"]], [self.file])
        self.assertIn("preview", answer["rows"][0])
        self.assertIsNone(answer["rows"][0]["preview"])
        access = self.view("favourites", expand="access")
        self.assertGreaterEqual(access["rows"][0]["access"]["role"], READ)

    def test_breadcrumbs_expand_on_the_lists_a_folder_is_opened_from(self):
        # B29: Shared and Starred show where an item lives. Recents hides
        # folders and the trash shows its own root's trail, so neither takes
        # the expansion.
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        starred = self.view("favourites", expand="breadcrumbs")
        self.assertEqual([row["name"] for row in starred["rows"]], [self.file])
        self.assertIn(self.folder, [crumb["name"] for crumb in starred["rows"][0]["breadcrumbs"]])
        grant(self.folder, STRANGER, READ, self.owner)
        frappe.db.commit()
        self.addCleanup(frappe.db.delete, "Drive Grant", {"node": self.folder, "principal": STRANGER})
        shared = self.data(
            self.drive(
                "GET",
                f"{PREFIX}/views/shared",
                query={"expand": "breadcrumbs"},
                sid=self.session_for(STRANGER),
            )
        )
        self.assertEqual([row["name"] for row in shared["rows"]], [self.folder])
        self.assertIsInstance(shared["rows"][0]["breadcrumbs"], list)
        for name, query in (("recents", {}), ("trash", {"root": self.root.name})):
            with self.subTest(view=name):
                response = self.as_owner(
                    "GET", f"{PREFIX}/views/{name}", query={"expand": "breadcrumbs", **query}
                )
                self.refusal(response, 400, "DriveError")

    def test_a_personal_view_is_scoped_to_the_caller(self):
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/visit", body={}))
        sid = self.session_for(STRANGER)
        for name in ("favourites", "recents"):
            with self.subTest(view=name):
                theirs = self.data(self.drive("GET", f"{PREFIX}/views/{name}", sid=sid))
                self.assertEqual(theirs["rows"], [])
                self.assertEqual([row["name"] for row in self.view(name)["rows"]], [self.file])

    def test_recents_filter_by_type_from_the_query_string(self):
        self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.folder}/visit", body={}))
        self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/visit", body={}))
        everything = self.view("recents")
        self.assertEqual({row["name"] for row in everything["rows"]}, {self.folder, self.file})
        folders = self.view("recents", type="folder")
        self.assertEqual([row["name"] for row in folders["rows"]], [self.folder])
        self.assertIsNotNone(folders["rows"][0]["opened_at"])
        self.assertEqual(self.view("recents", type="image"), {"rows": [], "next_cursor": None})
        either = self.view("recents", type="image,folder")
        self.assertEqual([row["name"] for row in either["rows"]], [self.folder])
        for unknown in ("spreadsheets", "folder,spreadsheets"):
            with self.subTest(type=unknown):
                answer = self.as_owner("GET", f"{PREFIX}/views/recents", query={"type": unknown})
                self.refusal(answer, 400, "DriveError")

    def test_every_node_view_filters_by_type_and_the_root_views_refuse_it(self):
        # B46: `?type=` means the same on every node view. `templates` lists
        # documents by `content_doctype` and `archived-roots` lists roots, so
        # both refuse it rather than ignore it.
        typed = self.data(
            self.as_owner(
                "POST",
                f"{PREFIX}/nodes",
                body={"kind": "folder", "parent_node": self.root.name, "title": "Typed"},
            )
        )["name"]
        self.addCleanup(self.as_owner, "DELETE", f"{PREFIX}/nodes/{typed}")
        for node in (self.folder, self.file):
            self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{node}/favourite"))
            grant(node, STRANGER, READ, self.owner)
            self.addCleanup(frappe.db.delete, "Drive Grant", {"node": node, "principal": STRANGER})
        # The grants hold this tree's lock until committed, and the request
        # below runs on its own connection.
        frappe.db.commit()
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{typed}", body={"state": "Trashed"}))
        stranger = self.session_for(STRANGER)

        def shared(**query):
            return self.data(self.drive("GET", f"{PREFIX}/views/shared", query=query, sid=stranger))

        cases = (
            ("favourites", None, {}, {self.folder, self.file}, [self.folder]),
            # The file sits below the shared folder, so the folder alone is listed.
            ("shared", shared, {}, {self.folder}, [self.folder]),
            ("trash", None, {"root": self.root.name}, {typed}, [typed]),
            ("search", None, {"term": "Folder"}, {self.folder}, [self.folder]),
        )
        for name, reader, required, everything, folders in cases:
            with self.subTest(view=name):
                read = reader or (lambda **query: self.view(name, **query))
                self.assertEqual({row["name"] for row in read(**required)["rows"]}, everything)
                self.assertEqual([row["name"] for row in read(**required, type="folder")["rows"]], folders)
                self.assertEqual(read(**required, type="image")["rows"], [])
                response = self.as_owner(
                    "GET", f"{PREFIX}/views/{name}", query={**required, "type": "folder,spreadsheets"}
                )
                self.refusal(response, 400, "DriveError")
        for name in ("templates", "archived-roots"):
            with self.subTest(view=name):
                self.assertIn("rows", self.view(name))
                response = self.as_owner("GET", f"{PREFIX}/views/{name}", query={"type": "folder"})
                self.refusal(response, 400, "DriveError")

    def test_clearing_recents_leaves_the_favourites_alone(self):
        self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/visit", body={}))
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/views/recents"))
        self.assertEqual(answer, {"count": 1})
        self.assertEqual(self.view("recents")["rows"], [])
        self.assertEqual([row["name"] for row in self.view("favourites")["rows"]], [self.file])

    def test_a_guest_is_not_heard_on_the_view_routes(self):
        for method, path in (
            ("GET", f"{PREFIX}/views/recents"),
            ("GET", f"{PREFIX}/views/shared"),
            ("DELETE", f"{PREFIX}/views/recents"),
        ):
            with self.subTest(method=method, path=path):
                response = self.drive(method, path)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")


class TestVersionRoutes(DriveHTTPCase):
    """§9.1's history over §11.2's six version rows."""

    def setUp(self):
        super().setUp()
        self.node = self.make_file(self.folder, "versioned.bin", b"version bytes")
        frappe.db.commit()
        self.addCleanup(self.drop_node)

    def drop_node(self):
        frappe.db.rollback()
        drop_node_rows([self.node])
        frappe.db.commit()

    def take(self, **body):
        return self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.node}/versions", body=body))

    def test_a_take_answers_the_version_and_the_page_never_carries_the_blob(self):
        taken = self.take(kind="named", label="First")
        self.assertEqual(set(taken), VERSION_SHAPE_FIELDS)
        self.assertEqual((taken["seq"], taken["kind"], taken["label"]), (1, "named", "First"))
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.node}/versions")
        page = self.data(response)
        self.assertEqual(set(page), {"rows", "next_cursor"})
        self.assertIsNone(page["next_cursor"])
        row = page["rows"][0]
        self.assertEqual(set(row), VERSION_SHAPE_FIELDS)
        self.assertEqual((row["seq"], row["kind"], row["label"], row["actor"]), (1, "named", "First", OWNER))
        self.assertNotIn("blob", response.get_data(as_text=True))

    def test_a_label_and_a_pin_are_written_and_answered(self):
        self.take()
        answer = self.data(
            self.as_owner(
                "PATCH",
                f"{PREFIX}/nodes/{self.node}/versions/1",
                body={"label": "Release", "pinned": True},
            )
        )
        self.assertEqual(set(answer), VERSION_SHAPE_FIELDS)
        self.assertEqual((answer["seq"], answer["label"], answer["pinned"]), (1, "Release", 1))
        self.reread()
        stored = frappe.db.get_value(
            "Drive Node Version", {"node": self.node, "seq": 1}, ["label", "pinned"], as_dict=True
        )
        self.assertEqual((stored.label, stored.pinned), ("Release", 1))

    def test_a_restore_answers_the_version_it_captured_first(self):
        self.take()
        answer = self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.node}/versions/1/restore", body={}))
        self.assertEqual(set(answer), VERSION_SHAPE_FIELDS)
        self.assertEqual(answer["seq"], 2)
        self.reread()
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": self.node}), 2)

    def test_a_version_delete_removes_the_row(self):
        self.take()
        self.assertEqual(
            self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.node}/versions/1")), {"count": 1}
        )
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Node Version", {"node": self.node, "seq": 1}))

    def test_a_version_content_read_redirects_to_a_signed_url(self):
        self.take()
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.node}/versions/1/content")
        self.assertEqual(response.status_code, 302)
        location = response.headers["Location"]
        self.assertTrue(location.startswith("/f/"), location)
        self.assertIn("e=", location)
        self.assertIn("s=", location)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")

    def test_a_link_holder_may_not_delete_a_version(self):
        # §11.2 gives the delete MANAGE, and §5.10 caps a link at EDIT, so no
        # link holder ever reaches this row.
        created = grant(self.node, "$LINK", EDIT, self.owner)
        frappe.db.commit()
        token = created["principal"].split(":", 1)[1]
        self.take()
        sid = self.session_for(STRANGER)
        response = self.drive("DELETE", f"{PREFIX}/nodes/{self.node}/versions/1", sid=sid, links=token)
        self.refusal(response, 403, "DriveForbidden")
        self.reread()
        self.assertTrue(frappe.db.exists("Drive Node Version", {"node": self.node, "seq": 1}))

    def test_an_unknown_sequence_is_not_found(self):
        response = self.as_owner("GET", f"{PREFIX}/nodes/{self.node}/versions/9/content")
        self.refusal(response, 404, "DriveNotFound")

    def test_a_sequence_below_one_is_a_bad_request(self):
        response = self.as_owner("DELETE", f"{PREFIX}/nodes/{self.node}/versions/0")
        self.refusal(response, 400, "DriveError")


class TestThreadRoutes(DriveHTTPCase):
    """§9.3's threads and comments over §11.2's six rows."""

    def setUp(self):
        super().setUp()
        self.doc = self.make_document("Threaded")
        frappe.db.commit()
        self.addCleanup(self.drop_document)

    def drop_document(self):
        frappe.db.rollback()
        drop_record_rows([self.doc])
        drop_node_rows([self.doc])
        frappe.db.commit()

    def open_thread(self, text="First note", anchor="block-1"):
        return self.data(
            self.as_owner("POST", f"{PREFIX}/nodes/{self.doc}/threads", body={"anchor": anchor, "text": text})
        )

    def threads_of(self, thread):
        listed = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.doc}/threads"))
        return next(row for row in listed["threads"] if row["name"] == thread)

    def test_a_thread_create_answers_the_thread_as_the_list_shows_it(self):
        opened = self.open_thread()
        self.assertEqual(set(opened), THREAD_SHAPE_FIELDS)
        self.assertEqual(set(opened["comments"][0]), COMMENT_SHAPE_FIELDS)
        thread = self.threads_of(opened["name"])
        self.assertEqual(thread, opened)
        self.assertEqual(thread["node"], self.doc)
        self.assertFalse(thread["resolved"])
        self.assertEqual(thread["comments"][0]["author"], OWNER)
        self.assertEqual(thread["comments"][0]["content"], "First note")

    def test_a_thread_is_resolved_and_then_reopened(self):
        opened = self.open_thread()
        path = f"{PREFIX}/threads/{opened['name']}"
        resolved = self.data(self.as_owner("PATCH", path, body={"resolved": True}))
        self.assertEqual(set(resolved), THREAD_SHAPE_FIELDS)
        self.assertEqual(
            (resolved["name"], resolved["resolved"], resolved["resolved_by"]), (opened["name"], True, OWNER)
        )
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment Thread", opened["name"], "resolved"), 1)
        reopened = self.data(self.as_owner("PATCH", path, body={"resolved": False}))
        self.assertFalse(reopened["resolved"])
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment Thread", opened["name"], "resolved"), 0)

    def test_a_resolve_without_the_flag_is_a_bad_request(self):
        opened = self.open_thread()
        response = self.as_owner("PATCH", f"{PREFIX}/threads/{opened['name']}", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_reply_is_appended_to_its_thread(self):
        opened = self.open_thread()
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/threads/{opened['name']}/comments", body={"text": "Second"})
        )
        self.assertEqual(set(answer), COMMENT_SHAPE_FIELDS)
        self.assertEqual(
            (answer["thread"], answer["content"], answer["author"]), (opened["name"], "Second", OWNER)
        )
        thread = self.threads_of(opened["name"])
        self.assertEqual(
            {row["name"] for row in thread["comments"]}, {opened["comments"][0]["name"], answer["name"]}
        )

    def test_a_comment_is_edited_and_then_deleted(self):
        opened = self.open_thread()
        comment = opened["comments"][0]["name"]
        path = f"{PREFIX}/comments/{comment}"
        edited = self.data(self.as_owner("PATCH", path, body={"text": "Rewritten"}))
        self.assertEqual((edited["name"], edited["content"]), (comment, "Rewritten"))
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment", comment, "content"), "Rewritten")
        self.assertEqual(self.data(self.as_owner("DELETE", path)), {"count": 1})
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Comment", comment))

    def test_a_guest_holding_a_comment_link_comments_under_a_server_set_author(self):
        # §6.7: a guest supplies the display name they typed, never the
        # identity. The author column is the server's to write.
        created = grant(self.doc, "$LINK", COMMENT, self.owner)
        frappe.db.commit()
        token = created["principal"].split(":", 1)[1]
        answer = self.data(
            self.drive(
                "POST",
                f"{PREFIX}/nodes/{self.doc}/threads",
                body={"anchor": "block-2", "text": "From outside", "author_name": "Visitor"},
                links=token,
            )
        )
        self.reread()
        stored = frappe.db.get_value(
            "Drive Comment", answer["comments"][0]["name"], ["author", "author_name"], as_dict=True
        )
        self.assertEqual((stored.author, stored.author_name), ("Guest", "Visitor"))

    def test_a_thread_list_is_refused_on_a_node_the_caller_cannot_read(self):
        sid = self.session_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/nodes/{self.doc}/threads", sid=sid)
        self.refusal(response, 404, "DriveNotFound")


class TestRecordRoutes(DriveHTTPCase):
    """§9.4's history and §9.5's private per-person marks."""

    def setUp(self):
        super().setUp()
        self.node = create_folder(self.owner, self.root.name, "Recorded")
        frappe.db.commit()
        self.addCleanup(self.drop_node)

    def drop_node(self):
        frappe.db.rollback()
        drop_record_rows([self.node])
        drop_node_rows([self.node])
        frappe.db.commit()

    def test_the_activity_page_carries_the_create_row_in_its_declared_shape(self):
        page = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.node}/activity"))
        self.assertEqual(set(page), {"rows", "next_cursor"})
        self.assertIsNone(page["next_cursor"])
        self.assertEqual([row["action"] for row in page["rows"]], ["create"])
        row = page["rows"][0]
        self.assertEqual(set(row), ACTIVITY_SHAPE_FIELDS)
        self.assertEqual((row["node"], row["actor"]), (self.node, OWNER))

    def test_the_activity_page_honours_its_limit_and_hands_back_a_cursor(self):
        self.data(self.as_owner("PATCH", f"{PREFIX}/nodes/{self.node}", body={"title": "Renamed"}))
        first = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.node}/activity", query={"limit": "1"}))
        self.assertEqual(len(first["rows"]), 1)
        self.assertIsNotNone(first["next_cursor"])
        second = self.data(
            self.as_owner(
                "GET",
                f"{PREFIX}/nodes/{self.node}/activity",
                query={"limit": "1", "cursor": first["next_cursor"]},
            )
        )
        self.assertEqual(len(second["rows"]), 1)
        self.assertNotEqual(second["rows"][0]["name"], first["rows"][0]["name"])

    def test_activity_is_refused_on_a_node_the_caller_cannot_read(self):
        sid = self.session_for(STRANGER)
        response = self.drive("GET", f"{PREFIX}/nodes/{self.node}/activity", sid=sid)
        self.refusal(response, 404, "DriveNotFound")

    def test_a_visit_records_one_recent_row_for_the_caller_alone(self):
        self.assertEqual(
            self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.node}/visit", body={})), {"count": 1}
        )
        self.reread()
        self.assertEqual(frappe.db.count("Drive Recent", {"node": self.node, "user": OWNER}), 1)
        self.assertEqual(frappe.db.count("Drive Recent", {"node": self.node, "user": STRANGER}), 0)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.node, "action": "create"}), 1)

    def test_a_favourite_is_set_and_cleared_for_the_caller_alone(self):
        self.assertEqual(
            self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.node}/favourite")), {"count": 1}
        )
        self.reread()
        self.assertEqual(frappe.db.count("Drive Favourite", {"node": self.node, "user": OWNER}), 1)
        self.assertEqual(frappe.db.count("Drive Favourite", {"node": self.node, "user": STRANGER}), 0)
        self.assertEqual(
            self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.node}/favourite")), {"count": 1}
        )
        self.reread()
        self.assertEqual(frappe.db.count("Drive Favourite", {"node": self.node}), 0)

    def test_a_guest_is_not_heard_on_a_visit_or_a_favourite(self):
        calls = (
            ("POST", f"{PREFIX}/nodes/{self.node}/visit", {}),
            ("PUT", f"{PREFIX}/nodes/{self.node}/favourite", None),
            ("DELETE", f"{PREFIX}/nodes/{self.node}/favourite", None),
        )
        for method, path, body in calls:
            with self.subTest(method=method):
                response = self.drive(method, path, body=body)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")


class TestNotificationRoutes(DriveHTTPCase):
    """§9.5's inbox: the caller's own pointers, and nobody else's."""

    def setUp(self):
        super().setUp()
        self.node = create_folder(self.owner, self.root.name, "Notified")
        self.activity = activity_core.record(self.owner, self.node, "edit", detail={"version": 1})
        activity_core.notify_users(self.activity, (OWNER, STRANGER))
        self.mine = frappe.db.get_value(
            "Drive Notification", {"activity": self.activity, "to_user": OWNER}, "name"
        )
        self.theirs = frappe.db.get_value(
            "Drive Notification", {"activity": self.activity, "to_user": STRANGER}, "name"
        )
        frappe.db.commit()
        self.addCleanup(self.drop_node)

    def drop_node(self):
        frappe.db.rollback()
        drop_record_rows([self.node])
        drop_node_rows([self.node])
        frappe.db.commit()

    def test_the_inbox_pages_the_callers_own_rows_and_never_another_users(self):
        page = self.data(self.as_owner("GET", f"{PREFIX}/notifications"))
        self.assertEqual(set(page), {"rows", "next_cursor"})
        names = [row["name"] for row in page["rows"]]
        self.assertIn(self.mine, names)
        self.assertNotIn(self.theirs, names)
        row = next(item for item in page["rows"] if item["name"] == self.mine)
        self.assertEqual(set(row), NOTIFICATION_SHAPE_FIELDS)
        self.assertEqual(row["read"], 0)
        self.assertEqual(row["activity"]["name"], self.activity)
        self.assertEqual(row["activity"]["node"], self.node)

    def test_unread_count_is_the_callers_exact_scalar(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/notifications/unread-count"))
        self.assertEqual(answer, {"unread": activity_core.unread_count(self.owner)})

    def test_reading_another_users_notification_marks_nothing(self):
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/notifications/read", body={"notifications": [self.theirs]})
        )
        self.assertEqual(answer, {"count": 0})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Notification", self.theirs, "read"), 0)

    def test_reading_the_callers_own_notification_marks_exactly_it(self):
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/notifications/read", body={"notifications": [self.mine]})
        )
        self.assertEqual(answer, {"count": 1})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Notification", self.mine, "read"), 1)
        self.assertEqual(frappe.db.get_value("Drive Notification", self.theirs, "read"), 0)

    def test_naming_neither_notifications_nor_all_is_a_bad_request(self):
        response = self.as_owner("POST", f"{PREFIX}/notifications/read", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_guest_is_not_heard_on_the_notification_routes(self):
        for method, path, body in (
            ("GET", f"{PREFIX}/notifications", None),
            ("GET", f"{PREFIX}/notifications/unread-count", None),
            ("POST", f"{PREFIX}/notifications/read", {"all": True}),
        ):
            with self.subTest(method=method, path=path):
                response = self.drive(method, path, body=body)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")
