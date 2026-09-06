"""Harness for the WebDAV suites.

The DAV namespace is one mount: the caller's own Personal Root at `/dav/`
(§12). Fixtures here therefore build a Personal Root and `Drive Node` rows
through the workflows the product itself uses — `frappe.storage.blob.put_blob`
for the bytes, `_core.roots.create_root` and `_core.nodes.create_folder` /
`create_file` for the tree — so no suite asserts against a shape only a test
can make. Cleanup goes through `suite/drive/tests/fixtures.py`.

`raw_child_node` is the one exception, for the two shapes `_core` will not
build: a content document, and a sibling whose title collides with a live one.
Both are shapes `pathmap` still has to answer for.
"""

import base64
import io

import frappe
from frappe.storage.blob import put_blob
from frappe.utils.password import update_password
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request, Response

from suite.drive._core import nodes as node_core
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, personal_root_for
from suite.drive.tests.fixtures import drop_node_rows, drop_personal_root, drop_record_rows
from suite.drive.webdav.dispatch import DAVResponseException, handle_before_request
from suite.tests.utils import ensure_user

__all__ = [
    "basic_header",
    "dispatch",
    "drop_dav_root",
    "drop_nodes",
    "enable_user_webdav",
    "ensure_system_settings_saveable",
    "ensure_user_with_password",
    "file_node",
    "folder_node",
    "make_ctx",
    "node_principals",
    "personal_dav_root",
    "raw_child_node",
    "raw_document_node",
    "set_dav_request",
]


def ensure_system_settings_saveable() -> None:
    """CI sites skip the setup wizard, leaving System Settings' mandatory
    language/time_zone empty — any later save (e.g. change_settings) then hits
    MandatoryError. Backfill the effective defaults so the doc round-trips."""
    current = frappe.db.get_value("System Settings", "System Settings", ["language", "time_zone"])
    language, time_zone = current or (None, None)
    if not language:
        frappe.db.set_single_value("System Settings", "language", "en")
    if not time_zone:
        frappe.db.set_single_value("System Settings", "time_zone", frappe.utils.get_system_timezone())
    if not language or not time_zone:
        frappe.clear_document_cache("System Settings", "System Settings")


def ensure_user_with_password(email: str, password: str) -> None:
    ensure_user(email)
    update_password(email, password)


def enable_user_webdav(user: str, commit: bool = False) -> None:
    """Flip the (opt-in, default-off) per-user toggle for a test user."""
    if not frappe.db.exists("Drive Settings", user):
        frappe.get_doc({"doctype": "Drive Settings", "user": user}).insert(ignore_permissions=True)
    frappe.db.set_value("Drive Settings", user, "webdav_enabled", 1, update_modified=False)
    if commit:
        frappe.db.commit()


def basic_header(user: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def set_dav_request(
    method: str,
    path: str,
    *,
    user: str | None = None,
    password: str = "",
    headers: dict[str, str] | None = None,
    data: bytes = b"",
    content_type: str | None = None,
) -> Request:
    headers = dict(headers or {})
    if user is not None:
        headers["Authorization"] = basic_header(user, password)
    builder = EnvironBuilder(method=method, path=path, headers=headers, data=data, content_type=content_type)
    frappe.local.request = Request(builder.get_environ())
    return frappe.local.request


def dispatch(*args, **kwargs) -> Response | None:
    """Run the before_request hook; return the DAV response, or None on passthrough."""
    set_dav_request(*args, **kwargs)
    try:
        handle_before_request()
    except DAVResponseException as e:
        return e.response
    return None


def make_ctx(method: str, path: str, user: str, **kwargs):
    """DavContext for calling a verb handler directly (dispatcher bypassed)."""
    from suite.drive.webdav import context, pathmap

    pathmap.reset_memo()
    request = set_dav_request(method, path, **kwargs)
    frappe.set_user(user)
    return context.build(request, user)


# --------------------------------------------------------------------------
# Node fixtures
# --------------------------------------------------------------------------


def node_principals(user: str) -> Principals:
    """The principals a fixture writes with.

    `framework.principals_for` reads this request's `X-Drive-Links` header only
    when `user` is the session user, and a DAV session never carries link
    principals anyway (§6.9), so a fixture built with these reaches exactly what
    the handler under test will reach.
    """
    from suite.drive import framework

    return framework.principals_for(user)


def personal_dav_root(user: str, *, title: str = "My Drive", quota_bytes: int = 0) -> str:
    """The user's Personal Root node id — the whole of the DAV mount.

    `ensure_user` provisions one through `after_user_insert`, so a suite that
    wants its own quota or title drops that pair first (`drop_dav_root`) and
    calls this; otherwise the provisioned root is returned as it stands.
    """
    existing = personal_root_for(user)
    if existing:
        return existing
    return create_root(kind="Personal", title=title, user=user, quota_bytes=quota_bytes).node


def drop_dav_root(user: str) -> None:
    """Remove the user's Personal Root and everything charged to it."""
    drop_personal_root(user)


def folder_node(user: str, parent: str, title: str) -> str:
    return node_core.create_folder(node_principals(user), parent, title)


def file_node(
    user: str,
    parent: str,
    title: str,
    data: bytes = b"",
    *,
    content_modified=None,
) -> frappe._dict:
    """One blob-backed file node, with the blob metadata the DAV suites assert on.

    Returns name/blob/size/mime/checksum/data rather than just the id: the
    strong ETag is the blob's checksum and `getcontenttype` is the blob's
    sniffed mime, so a test that hard-coded either would be asserting against
    its own guess instead of the bytes on the wire.

    The mime is the blob's own and cannot be chosen. `put_blob` sniffs it from
    the content and takes no override, and `_core.nodes._validated_blob` refuses
    a file whose mime differs from its blob's, so a fixture that named one would
    only build a shape the product refuses.
    """
    blob = put_blob(io.BytesIO(data), is_private=True, filename=title)
    node = node_core.create_file(
        node_principals(user),
        parent,
        title,
        blob=blob.name,
        size=blob.file_size,
        mime=blob.mime_type,
        content_modified=content_modified,
    )
    return frappe._dict(
        name=node,
        blob=blob.name,
        size=blob.file_size,
        mime=blob.mime_type,
        checksum=blob.checksum,
        data=data,
    )


def raw_child_node(parent: str, title: str, *, kind: str = "folder", **fields) -> str:
    """Insert one child below `parent` without going through `_core`.

    Two shapes need this. A `kind="document"` node cannot be created by
    `nodes.create_document`: it needs a registered content type and
    `hooks.py drive_content_types` is empty. A title that collides with a live
    sibling — an exact duplicate, or a case variant, which MariaDB's default
    collation makes the same title — is refused by `_refuse_sibling_collision`,
    and both are exactly what `pathmap`'s BINARY-first walk has to answer for.
    The `path`/`root` fields are the ones `_core._insert_node` would write.
    """
    parent_row = frappe.db.get_value("Drive Node", parent, ["name", "kind", "root", "path"], as_dict=True)
    row = {
        "doctype": "Drive Node",
        "title": title,
        "parent": parent_row.name,
        "root": parent_row.name if parent_row.kind == "root" else parent_row.root,
        "path": "" if parent_row.kind == "root" else f"{parent_row.path or '/'}{parent_row.name}/",
        "kind": kind,
        "state": "Active",
        "is_template": 0,
    }
    row.update(fields)
    return frappe.get_doc(row).insert(ignore_permissions=True, ignore_links=True).name


def raw_document_node(parent: str, title: str = "Notes") -> str:
    """A `kind="document"` node — §12.2's hidden Writer/Slides/Sheets shape."""
    return raw_child_node(
        parent,
        title,
        kind="document",
        content_doctype="ToDo",
        content_docname="fake-content",
        mime="frappe/fake",
    )


def drop_nodes(node_ids) -> None:
    """Delete a set of nodes and every row that hangs off them."""
    node_ids = [node for node in node_ids if node]
    drop_record_rows(node_ids)
    drop_node_rows(node_ids)
