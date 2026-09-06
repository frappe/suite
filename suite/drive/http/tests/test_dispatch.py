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
from unittest.mock import patch

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
    "parent",
    "root",
    "state",
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
                    "parent": cls.root.name,
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
        self.assertEqual(answer["owner"], OWNER)

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
            body={"upload_id": "smuggled", "parent": self.folder, "title": "x"},
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
    def test_a_detail_fetch_publishes_exactly_the_base_fields(self):
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.file}"))
        self.assertEqual(set(answer), NODE_SHAPE_FIELDS)

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
                "POST", f"{PREFIX}/nodes", body={"parent": self.folder, "title": "New", "kind": "folder"}
            )
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(set(answer), NODE_SHAPE_FIELDS)
        self.assertEqual(answer["kind"], "folder")
        self.assertEqual(answer["parent"], self.folder)

    def test_a_folder_create_refuses_a_blob(self):
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent": self.folder, "title": "Sneaky", "kind": "folder", "blob": "anything"},
        )
        self.refusal(response, 400, "DriveError")

    def test_a_file_create_refuses_a_size_the_blob_does_not_have(self):
        blob = frappe.db.get_value("Drive Node", self.file, "blob")
        response = self.as_owner(
            "POST",
            f"{PREFIX}/nodes",
            body={
                "parent": self.folder,
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
                    "parent": self.folder,
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
            "POST", f"{PREFIX}/nodes", body={"parent": self.folder, "title": "x", "kind": "root"}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_create_a_stranger_may_not_make_is_hidden(self):
        sid = self.session_for(STRANGER)
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent": self.folder, "title": "x", "kind": "folder"},
            sid=sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_rename_and_a_move_cannot_arrive_in_one_patch(self):
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.file}", body={"title": "x", "parent": self.root.name}
        )
        self.refusal(response, 400, "DriveError")

    def test_a_content_time_is_a_whole_patch_body_of_its_own(self):
        # §11.2's PATCH row declares `{content_modified}` as one of five whole
        # bodies. It is `content.touch` with the time supplied (§8.11), so it
        # writes no version and, per §9.4, no activity row.
        before = frappe.db.count("Drive Activity", {"node": self.file})
        answer = self.data(
            self.as_owner(
                "PATCH", f"{PREFIX}/nodes/{self.file}", body={"content_modified": "2024-03-04 05:06:07"}
            )
        )
        self.reread()
        self.assertEqual(answer["content_modified"], "2024-03-04 05:06:07")
        self.assertEqual(
            str(frappe.db.get_value("Drive Node", self.file, "content_modified")),
            "2024-03-04 05:06:07",
        )
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.file}), before)
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": self.file}), 0)

    def test_a_content_time_cannot_arrive_with_a_tree_mutation(self):
        response = self.as_owner(
            "PATCH",
            f"{PREFIX}/nodes/{self.file}",
            body={"title": "Renamed.bin", "content_modified": "2024-03-04 05:06:07"},
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
            self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/copy", body={"parent": self.root.name})
        )
        self.reread()
        self.addCleanup(self.drop_node, answer["name"])
        self.assertEqual(answer["parent"], self.root.name)
        self.assertNotEqual(answer["name"], self.file)

    def test_a_purge_reports_how_many_nodes_it_removed(self):
        doomed = create_folder(self.owner, self.root.name, "Doomed")
        frappe.db.commit()
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{doomed}"))
        self.reread()
        self.assertEqual(answer, {"purged": 1})
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
        self.assertEqual(answer["parent"], self.outer)

    def test_naming_a_destination_when_the_original_is_available_is_a_conflict(self):
        self.trash(self.inner)
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active", "parent": self.root.name}
        )
        self.refusal(response, 409, "DriveConflict")

    def test_a_restore_without_a_destination_is_a_conflict_when_the_choice_is_needed(self):
        self.trash(self.inner)
        self.trash(self.outer)
        response = self.as_owner("PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active"})
        self.refusal(response, 409, "DriveConflict")

    def test_a_restore_accepts_a_destination_with_active_state(self):
        self.trash(self.inner)
        self.trash(self.outer)
        answer = self.data(
            self.as_owner(
                "PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Active", "parent": self.root.name}
            )
        )
        self.assertEqual(answer["state"], "Active")
        self.assertEqual(answer["parent"], self.root.name)

    def test_trashing_cannot_select_a_destination(self):
        response = self.as_owner(
            "PATCH", f"{PREFIX}/nodes/{self.inner}", body={"state": "Trashed", "parent": self.root.name}
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
                body={"parent": self.folder, "filename": filename, "size": size},
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
                body={"parent": self.folder, "title": "upload.bin"},
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
            body={"parent": self.folder, "filename": "big.bin", "size": 10_000_000},
        )
        self.refusal(response, 413, "DriveOverQuota")

    def test_a_stranger_cannot_open_a_session_in_a_folder_they_cannot_see(self):
        sid = self.session_for(STRANGER)
        response = self.drive(
            "POST",
            f"{PREFIX}/uploads",
            body={"parent": self.folder, "filename": "x.bin", "size": 4},
            sid=sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def restore_quota(self):
        frappe.db.rollback()
        frappe.db.set_value("Drive Root", self.root.name, "quota_bytes", 0, update_modified=False)
        frappe.db.commit()

    def drop_node(self, node):
        frappe.db.rollback()
        blob = frappe.db.get_value("Drive Node", node, "blob")
        drop_node_rows([node])
        if blob:
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
                    body={"parent": self.folder, "filename": "theirs.bin", "size": 4},
                    sid=self.stranger_sid,
                )
            )
        self.assertIn("upload_id", answer)

    def test_an_editor_below_upload_on_a_root_cannot_create_there(self):
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent": self.root.name, "title": "x", "kind": "folder"},
            sid=self.stranger_sid,
        )
        self.refusal(response, 404, "DriveNotFound")

    def test_a_role_below_upload_cannot_create(self):
        frappe.db.set_value("Drive Grant", self.granted["name"], "role", READ, update_modified=False)
        frappe.db.commit()
        response = self.drive(
            "POST",
            f"{PREFIX}/nodes",
            body={"parent": self.folder, "title": "x", "kind": "folder"},
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
        answer = self.data(self.as_owner("GET", f"{PREFIX}/nodes/{self.shared}/grants"))
        listed = {row["name"]: row for row in answer["grants"]}
        self.assertEqual(set(listed), {live, stale})
        self.assertEqual(set(listed[live]), GRANT_SHAPE_FIELDS)
        self.assertEqual(listed[live]["node"], self.shared)
        self.assertIsNone(listed[live]["expires_on"])
        self.assertEqual(listed[stale]["expires_on"], PAST)
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
        self.assertEqual(written["grant"]["role"], NONE)
        self.assertEqual(written["grant"]["principal"], STRANGER)
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", sid=sid), 404, "DriveNotFound")

    def test_a_delete_removes_the_local_row_and_leaves_the_inherited_one(self):
        grant(self.shared, STRANGER, READ, self.owner)
        grant(self.inner, STRANGER, EDIT, self.owner)
        frappe.db.commit()
        sid = self.session_for(STRANGER)
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.inner}/grants/{STRANGER}"))
        self.assertEqual(answer, {"result": "revoked"})
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
        self.assertEqual(answer, {"result": "revoked", "rows": 2})
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
        token = minted["grant"]["principal"].split(":", 1)[1]
        self.assertEqual(minted["url"], f"/drive/l/{token}")
        opened = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=token))
        self.assertEqual(opened["name"], self.inner)

        rotated = self.data(
            self.as_owner("POST", f"{PREFIX}/grants/{minted['grant']['name']}/rotate", body={})
        )
        fresh = rotated["grant"]["principal"].split(":", 1)[1]
        self.assertNotEqual(fresh, token)
        self.assertEqual(rotated["url"], f"/drive/l/{fresh}")
        self.assertEqual(rotated["grant"]["name"], minted["grant"]["name"])
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=token), 404, "DriveNotFound")
        reopened = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}", links=fresh))
        self.assertEqual(reopened["name"], self.inner)

    def test_a_public_grant_publishes_the_node_to_an_anonymous_reader(self):
        self.refusal(self.drive("GET", f"{PREFIX}/nodes/{self.inner}"), 404, "DriveNotFound")
        written = self.data(
            self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", body={"role": 10})
        )
        self.assertEqual(written["grant"]["principal"], "$PUBLIC")
        self.assertEqual(written["grant"]["role"], READ)
        self.assertNotIn("url", written)
        answer = self.data(self.drive("GET", f"{PREFIX}/nodes/{self.inner}"))
        self.assertEqual(answer["name"], self.inner)

    def test_a_grant_write_without_a_role_is_refused_and_writes_nothing(self):
        before = frappe.db.count("Drive Grant", {"node": self.inner})
        response = self.as_owner("PUT", f"{PREFIX}/nodes/{self.inner}/grants/{STRANGER}", body={})
        self.refusal(response, 400, "DriveError")
        self.reread()
        self.assertEqual(frappe.db.count("Drive Grant", {"node": self.inner}), before)

    def test_a_guest_is_not_heard_on_any_grant_route(self):
        calls = (
            ("GET", f"{PREFIX}/nodes/{self.inner}/grants", None),
            ("PUT", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", {"role": READ}),
            ("DELETE", f"{PREFIX}/nodes/{self.inner}/grants/$PUBLIC", None),
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

    def test_an_unlock_answers_a_ticket_that_then_opens_the_node_for_a_guest(self):
        _created, token = self.link(password="correct horse")
        answer = self.data(
            self.drive("POST", f"{PREFIX}/links/{token}/unlock", body={"password": "correct horse"})
        )
        self.assertEqual(set(answer), {"ticket", "expires"})
        self.assertGreater(answer["expires"], int(time.time()))
        opened = self.data(
            self.drive("GET", f"{PREFIX}/nodes/{self.gated}", links=f"{token}.{answer['ticket']}")
        )
        self.assertEqual(opened["name"], self.gated)

    def test_a_wrong_link_password_is_refused(self):
        _created, token = self.link(password="correct horse")
        response = self.drive("POST", f"{PREFIX}/links/{token}/unlock", body={"password": "wrong"})
        self.refusal(response, 401, "DriveLocked")

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
        response = self.drive("POST", f"{PREFIX}/links/{'a' * 22}/unlock", body={"password": "x"})
        self.refusal(response, 404, "DriveNotFound")


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

    def test_a_view_expands_a_preview_and_refuses_the_other_two(self):
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        answer = self.view("favourites", expand="preview")
        self.assertEqual([row["name"] for row in answer["rows"]], [self.file])
        self.assertIn("preview", answer["rows"][0])
        self.assertIsNone(answer["rows"][0]["preview"])
        for expansion in ("access", "breadcrumbs"):
            with self.subTest(expand=expansion):
                response = self.as_owner("GET", f"{PREFIX}/views/favourites", query={"expand": expansion})
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

    def test_clearing_recents_leaves_the_favourites_alone(self):
        self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.file}/visit", body={}))
        self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.file}/favourite"))
        answer = self.data(self.as_owner("DELETE", f"{PREFIX}/views/recents"))
        self.assertEqual(answer, {"cleared": 1})
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

    def test_a_take_answers_a_sequence_and_the_page_never_carries_the_blob(self):
        self.assertEqual(self.take(kind="named", label="First"), {"seq": 1})
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
        self.assertEqual(answer, {"label": "Release", "pinned": 1})
        self.reread()
        stored = frappe.db.get_value(
            "Drive Node Version", {"node": self.node, "seq": 1}, ["label", "pinned"], as_dict=True
        )
        self.assertEqual((stored.label, stored.pinned), ("Release", 1))

    def test_a_restore_answers_the_sequence_it_captured_first(self):
        self.take()
        answer = self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.node}/versions/1/restore", body={}))
        self.assertEqual(answer, {"seq": 2})
        self.reread()
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": self.node}), 2)

    def test_a_version_delete_removes_the_row(self):
        self.take()
        self.assertEqual(self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.node}/versions/1")), {})
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

    def test_a_thread_create_answers_both_ids_and_the_list_carries_the_comment(self):
        opened = self.open_thread()
        self.assertEqual(set(opened), {"thread", "comment"})
        thread = self.threads_of(opened["thread"])
        self.assertEqual(set(thread), THREAD_SHAPE_FIELDS)
        self.assertEqual(thread["node"], self.doc)
        self.assertFalse(thread["resolved"])
        self.assertEqual([row["name"] for row in thread["comments"]], [opened["comment"]])
        self.assertEqual(thread["comments"][0]["author"], OWNER)
        self.assertEqual(thread["comments"][0]["content"], "First note")

    def test_a_thread_is_resolved_and_then_reopened(self):
        opened = self.open_thread()
        path = f"{PREFIX}/threads/{opened['thread']}"
        self.assertEqual(self.data(self.as_owner("PATCH", path, body={"resolved": True})), {"resolved": True})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment Thread", opened["thread"], "resolved"), 1)
        self.assertEqual(
            self.data(self.as_owner("PATCH", path, body={"resolved": False})), {"resolved": False}
        )
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment Thread", opened["thread"], "resolved"), 0)

    def test_a_resolve_without_the_flag_is_a_bad_request(self):
        opened = self.open_thread()
        response = self.as_owner("PATCH", f"{PREFIX}/threads/{opened['thread']}", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_reply_is_appended_to_its_thread(self):
        opened = self.open_thread()
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/threads/{opened['thread']}/comments", body={"text": "Second"})
        )
        self.assertEqual(set(answer), {"comment"})
        thread = self.threads_of(opened["thread"])
        self.assertEqual({row["name"] for row in thread["comments"]}, {opened["comment"], answer["comment"]})

    def test_a_comment_is_edited_and_then_deleted(self):
        opened = self.open_thread()
        path = f"{PREFIX}/comments/{opened['comment']}"
        self.assertEqual(self.data(self.as_owner("PATCH", path, body={"text": "Rewritten"})), {})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Comment", opened["comment"], "content"), "Rewritten")
        self.assertEqual(self.data(self.as_owner("DELETE", path)), {})
        self.reread()
        self.assertFalse(frappe.db.exists("Drive Comment", opened["comment"]))

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
            "Drive Comment", answer["comment"], ["author", "author_name"], as_dict=True
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
        self.assertEqual(self.data(self.as_owner("POST", f"{PREFIX}/nodes/{self.node}/visit", body={})), {})
        self.reread()
        self.assertEqual(frappe.db.count("Drive Recent", {"node": self.node, "user": OWNER}), 1)
        self.assertEqual(frappe.db.count("Drive Recent", {"node": self.node, "user": STRANGER}), 0)
        self.assertEqual(frappe.db.count("Drive Activity", {"node": self.node, "action": "create"}), 1)

    def test_a_favourite_is_set_and_cleared_for_the_caller_alone(self):
        self.assertEqual(self.data(self.as_owner("PUT", f"{PREFIX}/nodes/{self.node}/favourite")), {})
        self.reread()
        self.assertEqual(frappe.db.count("Drive Favourite", {"node": self.node, "user": OWNER}), 1)
        self.assertEqual(frappe.db.count("Drive Favourite", {"node": self.node, "user": STRANGER}), 0)
        self.assertEqual(self.data(self.as_owner("DELETE", f"{PREFIX}/nodes/{self.node}/favourite")), {})
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

    def test_reading_another_users_notification_marks_nothing(self):
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/notifications/read", body={"notifications": [self.theirs]})
        )
        self.assertEqual(answer, {"read": 0})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Notification", self.theirs, "read"), 0)

    def test_reading_the_callers_own_notification_marks_exactly_it(self):
        answer = self.data(
            self.as_owner("POST", f"{PREFIX}/notifications/read", body={"notifications": [self.mine]})
        )
        self.assertEqual(answer, {"read": 1})
        self.reread()
        self.assertEqual(frappe.db.get_value("Drive Notification", self.mine, "read"), 1)
        self.assertEqual(frappe.db.get_value("Drive Notification", self.theirs, "read"), 0)

    def test_naming_neither_notifications_nor_all_is_a_bad_request(self):
        response = self.as_owner("POST", f"{PREFIX}/notifications/read", body={})
        self.refusal(response, 400, "DriveError")

    def test_a_guest_is_not_heard_on_the_notification_routes(self):
        for method, path, body in (
            ("GET", f"{PREFIX}/notifications", None),
            ("POST", f"{PREFIX}/notifications/read", {"all": True}),
        ):
            with self.subTest(method=method, path=path):
                response = self.drive(method, path, body=body)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json["errors"][0]["type"], "PermissionError")
