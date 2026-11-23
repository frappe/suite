"""Atomic lifecycle for the one-to-one Drive root pair."""

import mimetypes
from uuid import uuid4

import frappe
from frappe import _

from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import MANAGE, READ, UPLOAD

PERSONAL = "Personal"
SHARED = "Shared"
ACTIVE = "Active"
ILLEGAL_ROOT_OPERATIONS = frozenset({"move", "copy", "trash", "restore", "purge", "version", "preview"})
# The breakdown lists this many of a root's largest nodes. Every node still
# counts towards its type's total.
LARGEST_FILES = 10
# Mimes that name no type. A browser sends one for a file it does not know,
# such as Markdown, so the extension decides the type instead.
GENERIC_MIMES = frozenset({"", "application/octet-stream", "binary/octet-stream"})

# The storage types the usage report groups a file's bytes under, by mime.
STORAGE_TYPES: dict[str, tuple[str, ...]] = {
    "Image": (
        "image/png",
        "image/jpeg",
        "image/svg+xml",
        "image/heic",
        "image/heif",
        "image/avif",
        "image/webp",
        "image/tiff",
        "image/gif",
    ),
    "PDF": ("application/pdf",),
    "Text": ("text/plain",),
    "XML Data": ("application/xml",),
    "Document": (
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.apple.pages",
        "application/x-abiword",
    ),
    "Spreadsheet": (
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.spreadsheet",
        "text/csv",
        "application/vnd.apple.numbers",
    ),
    "Presentation": (
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.presentation",
        "application/vnd.apple.keynote",
    ),
    "Code": (
        "text/x-python",
        "text/html",
        "text/css",
        "text/javascript",
        "application/javascript",
        "text/rich-text",
        "text/x-shellscript",
        "text/markdown",
        "application/json",
        "application/x-httpd-php",
        "application/x-python-script",
        "application/x-sql",
        "text/x-perl",
        "text/x-csrc",
        "text/x-sh",
    ),
    "Audio": ("audio/mpeg", "audio/wav", "audio/x-midi", "audio/ogg", "audio/mp4", "audio/mp3"),
    "Video": ("video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"),
    "Book": ("application/epub+zip", "application/x-mobipocket-ebook"),
    "Application": (
        "application/octet-stream",
        "application/x-sh",
        "application/vnd.microsoft.portable-executable",
    ),
    "Archive": (
        "application/zip",
        "application/x-rar-compressed",
        "application/x-tar",
        "application/gzip",
        "application/x-bzip2",
    ),
}
STORAGE_TYPE_BY_MIME = {mime: kind for kind, mimes in STORAGE_TYPES.items() for mime in mimes}


def create_root(
    *,
    kind: str,
    title: str,
    user: str | None = None,
    quota_bytes: int = 0,
) -> frappe._dict:
    """Create a root node, its metadata, and its anchor grant as one unit."""
    _validate_create_arguments(kind, user, quota_bytes)
    savepoint = f"drive_root_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        _lock_identity(kind, user)
        if active_root_for(kind=kind, user=user, for_update=True):
            subject = user if kind == PERSONAL else SHARED
            raise DriveConflict(_("An active Drive root already exists for {0}").format(subject))

        owner = user if kind == PERSONAL else "Administrator"
        node = _insert_root_node(title=title, owner=owner)
        root = _insert_root_metadata(
            node=node.name,
            kind=kind,
            user=user,
            quota_bytes=quota_bytes,
        )
        _insert_anchor_grant(node=node.name, kind=kind, user=user)
        validate_root_pair(node.name)
        from suite.drive._core.changes import emit_for_node

        emit_for_node(node.name)
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return frappe._dict(name=root.name, node=node.name, kind=kind, user=user, title=node.title)


def active_root_for(*, kind: str, user: str | None = None, for_update: bool = False) -> str | None:
    filters = {"kind": kind, "state": ACTIVE}
    if kind == PERSONAL:
        filters["user"] = user
    return frappe.db.get_value("Drive Root", filters, "name", for_update=for_update)


def personal_root_for(user: str) -> str | None:
    """Return a user's active Personal root node id."""
    return active_root_for(kind=PERSONAL, user=user)


def discover(principals: Principals) -> dict:
    """Return the caller's active Personal root and the active Shared root."""
    if principals.user == "Guest":
        raise DriveForbidden(_("Sign in to discover Drive roots"))
    rows = frappe.db.sql(
        """
        SELECT r.name AS node, r.kind, n.title
        FROM `tabDrive Root` r
        JOIN `tabDrive Node` n ON n.name = r.node
        WHERE r.state = 'Active'
          AND ((r.kind = 'Personal' AND r.user = %(user)s) OR r.kind = 'Shared')
        ORDER BY CASE r.kind WHEN 'Personal' THEN 0 ELSE 1 END, r.name
        """,
        {"user": principals.user},
        as_dict=True,
    )
    personal = next((row for row in rows if row.kind == PERSONAL), None)
    if personal is None:
        raise DriveNotFound(_("The caller's active Personal Drive root was not found"))

    from suite.drive._core.access import require

    require(validate_root_pair(personal.node).node, READ, principals)
    organization = next((row for row in rows if row.kind == SHARED), None)
    if organization is not None:
        require(validate_root_pair(organization.node).node, READ, principals)

    def item(row):
        return {"node": row.node, "title": row.title} if row is not None else None

    return {"personal": item(personal), "organization": item(organization)}


def provision_personal_root(user: str, *, title: str = "My Drive") -> str | None:
    """Ensure an ordinary Suite user has one fresh Active Personal root."""
    if not user or user in ("Guest", "Administrator"):
        return None
    current = personal_root_for(user)
    if current:
        return current
    return create_root(kind=PERSONAL, title=title, user=user).name


def archive_personal_root(user: str) -> str | None:
    """Archive only root metadata during offboarding."""
    _lock_identity(PERSONAL, user)
    # Found unlocked, then locked through its pair: the root node row before
    # the Drive Root row, the order every tree write takes them in.
    root = active_root_for(kind=PERSONAL, user=user)
    if not root:
        return None
    pair = validate_root_pair(root, for_update=True)
    if pair.root.state != ACTIVE:
        return None
    if pair.root.user != user:
        raise frappe.ValidationError(_("The Personal Drive root owner does not match"))
    frappe.db.set_value("Drive Root", root, "state", "Archived", update_modified=False)
    from suite.drive._core.changes import emit_for_node

    emit_for_node(root)
    return root


def set_user_active(user: str, *, active: bool) -> str:
    """Preserve root identity and grants across suspension/reactivation (admin spec §4.2)."""
    _lock_identity(PERSONAL, user)
    roots = frappe.get_all("Drive Root", filters={"kind": PERSONAL, "user": user}, pluck="name")
    if len(roots) != 1:
        raise DriveConflict(_("The user must have exactly one retained Personal Root before changing access"))
    pair = validate_root_pair(roots[0], for_update=True)
    state = ACTIVE if active else "Archived"
    if pair.root.state != state:
        frappe.db.set_value("Drive Root", pair.root.name, "state", state, update_modified=False)
        from suite.drive._core.changes import emit_for_node

        emit_for_node(pair.root.name)
    return pair.root.name


def update_root(
    root: str,
    principals: Principals,
    *,
    quota_bytes: int | None = None,
    state: str | None = None,
) -> frappe._dict:
    """Apply exactly one Suite Admin root-metadata change."""
    _require_admin(principals)
    if (quota_bytes is None) == (state is None):
        raise frappe.ValidationError(_("Change exactly one of quota_bytes or state"))
    pair = validate_root_pair(root, for_update=True)
    if quota_bytes is not None:
        _validate_quota(quota_bytes)
        frappe.db.set_value("Drive Root", root, "quota_bytes", quota_bytes, update_modified=False)
        pair.root.quota_bytes = quota_bytes
    else:
        if state != "Archived" or pair.root.state != ACTIVE:
            raise DriveConflict(_("A Drive root can only transition from Active to Archived"))
        frappe.db.set_value("Drive Root", root, "state", state, update_modified=False)
        pair.root.state = state
    from suite.drive._core.changes import emit_for_node

    emit_for_node(root)
    return _root_shape(pair)


def usage_for(root: str, principals: Principals, *, breakdown: bool = False) -> frappe._dict:
    """Answer one root's counters to its own user, its managers, or an admin.

    §11.2 gives this route to "own root, or Suite Admin for any". A Shared Root
    names no user, so its manager is the closest thing it has to an owner and
    is admitted the same way. Everyone else meets `require`, which hides a root
    they cannot read behind 404 rather than confirming it exists.

    `breakdown` adds `by_type` and `largest`, read from the root's Active
    nodes. It lists titles, so it keeps §11.2's rule to the letter: the
    root's own user or a Suite Admin. A manager who is neither reads the
    totals and is refused the breakdown with 403, the answer `require` gives
    a caller who can see the root but holds too low a role.
    """
    # `quota` imports this module for `validate_root_pair`, so both stay
    # function-local here, the same one-way break the purge path uses.
    from suite.drive._core.access import require
    from suite.drive._core.quota import get_storage_usage

    pair = validate_root_pair(root)
    owner_or_admin = principals.is_admin or bool(pair.root.user and pair.root.user == principals.user)
    if not owner_or_admin:
        require(pair.node, MANAGE, principals)
        if breakdown:
            raise DriveForbidden(_("Only the root's own user or a Suite Admin can list its files"))
    usage = get_storage_usage(root)
    if breakdown:
        usage.update(_breakdown(root))
    return usage


def _breakdown(root: str) -> dict:
    """Bytes by type, and the largest items, among one root's Active nodes.

    It answers in the items a Drive listing shows. A Media Node is not listed
    on its own: it lives inside its Content Document, so its bytes count
    towards that document, both in the document's type and in its size among
    the largest. Every byte is still counted once.

    Only nodes that hold bytes are read: folders, links, and empty nodes are
    free (§7.1), so they never appear. Trash and versions are charged too, but
    this answers what the root holds now. The totals group in SQL by the
    columns the type rule reads, so the fold below sees one row per distinct
    mime, not one per node. A file with a generic mime also groups by title,
    because its type then comes from its extension.
    """
    holder = """
        FROM `tabDrive Node` n
        LEFT JOIN `tabDrive Node` d ON d.name = n.parent_node AND d.kind = 'document'
        JOIN `tabDrive Node` item ON item.name = COALESCE(d.name, n.name)
        WHERE n.root = %(root)s AND n.state = 'Active' AND n.kind IN ('file', 'document') AND n.size > 0
    """
    generic = ", ".join(frappe.db.escape(mime) for mime in sorted(GENERIC_MIMES))
    groups = frappe.db.sql(
        f"""SELECT item.kind, item.content_doctype, item.mime,
               CASE WHEN item.mime IS NULL OR item.mime IN ({generic}) THEN item.title END AS title,
               SUM(n.size) AS bytes
           {holder}
           GROUP BY item.kind, item.content_doctype, item.mime,
               CASE WHEN item.mime IS NULL OR item.mime IN ({generic}) THEN item.title END""",
        {"root": root},
        as_dict=True,
    )
    by_type: dict[str, int] = {}
    for group in groups:
        name = _storage_type(group)
        by_type[name] = by_type.get(name, 0) + int(group.bytes)
    largest = frappe.db.sql(
        f"""SELECT item.name, item.title, item.mime, item.kind, item.content_doctype, SUM(n.size) AS size
           {holder}
           GROUP BY item.name, item.title, item.mime, item.kind, item.content_doctype
           ORDER BY size DESC, item.name
           LIMIT %(limit)s""",
        {"root": root, "limit": LARGEST_FILES},
        as_dict=True,
    )
    return {
        "by_type": [
            {"type": name, "bytes": size}
            for name, size in sorted(by_type.items(), key=lambda item: (-item[1], item[0]))
        ],
        "largest": [
            {
                "node": row.name,
                "title": row.title,
                "size": int(row.size),
                "mime": row.mime,
                "kind": row.kind,
                "type": _storage_type(row),
            }
            for row in largest
        ],
    }


def _storage_type(row) -> str:
    """Name the storage type a node's bytes count under.

    A content document is its content doctype. A file is its mime family from
    `STORAGE_TYPES`, which is the clients' vocabulary; a mime the table does
    not hold is "Unknown". A generic mime is replaced by the one its title's
    extension names, when there is one.
    """
    if row.get("kind") == "document":
        return row.get("content_doctype") or "Unknown"
    mime = row.get("mime") or ""
    if mime in GENERIC_MIMES:
        mime = mimetypes.guess_type(row.get("title") or "")[0] or mime
    return STORAGE_TYPE_BY_MIME.get(mime, "Unknown")


def purge_root(root: str, principals: Principals) -> frappe._dict:
    """Atomically remove one explicitly selected Archived root pair.

    Lock order matches every other Drive tree workflow: descendants shallowest
    first, then the root node, then the `Drive Root` row. An upload or a move
    inside the archived root takes the same order, so the two wait for each
    other instead of deadlocking. The Archived state is read once without a
    lock to refuse an Active root cheaply, then proved again under the lock.
    """
    _require_admin(principals)
    _require_archived(validate_root_pair(root))
    savepoint = f"drive_root_purge_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        descendants = _locked_root_descendants(root)
        _require_archived(validate_root_pair(root, for_update=True))
        _validate_root_descendants(root, descendants)
        from suite.drive._core.changes import emit_for_node

        emit_for_node(root)
        _purge_root_rows(root, descendants)
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return frappe._dict(purged=len(descendants) + 1)


def lock_trees(*roots: str) -> None:
    """Take the tree lock on each named tree: its root node row, in id order.

    Every workflow that writes a tree takes this lock before any other row of
    that tree, so two writes to one tree wait at the root instead of meeting
    halfway down in opposite orders. A write that spans two trees (a move or a
    copy between roots) names both, and the id order keeps a pair of them from
    waiting on each other. The lock order is in the `suite.drive` docstring.
    """
    for root in sorted(set(roots)):
        if not frappe.db.get_value("Drive Node", root, "name", for_update=True):
            raise DriveConflict(_("The Drive node has an invalid tree position"))


def validate_root_pair(node_id: str, *, for_update: bool = False) -> frappe._dict:
    """Validate both directions and every root-node invariant."""
    locking = {"for_update": True} if for_update else {}
    node = frappe.db.get_value(
        "Drive Node",
        node_id,
        [
            "name",
            "title",
            "parent_node",
            "root",
            "path",
            "kind",
            "blob",
            "size",
            "mime",
            "url",
            "content_doctype",
            "content_docname",
            "state",
            "trashed_at",
            "trash_root",
            "is_template",
            "owner",
        ],
        as_dict=True,
        **locking,
    )
    if not node:
        raise DriveNotFound(_("Drive root node {0} was not found").format(node_id))
    if (
        node.kind != "root"
        or any(
            (
                node.parent_node,
                node.root,
                node.path,
                node.blob,
                node.size,
                node.mime,
                node.url,
                node.content_doctype,
                node.content_docname,
                node.trashed_at,
                node.trash_root,
                node.is_template,
            )
        )
        or node.state != ACTIVE
    ):
        raise frappe.ValidationError(_("Drive root node {0} has an invalid root shape").format(node_id))

    root = frappe.db.get_value(
        "Drive Root",
        {"node": node_id},
        ["name", "node", "kind", "user", "state", "quota_bytes", "used_bytes"],
        as_dict=True,
        **locking,
    )
    if not root or root.name != node_id or root.node != node_id:
        raise frappe.ValidationError(_("Drive root node {0} has no matching metadata").format(node_id))
    if root.kind == PERSONAL:
        if not root.user:
            raise frappe.ValidationError(_("A Personal Drive root must name its user"))
    elif root.kind == SHARED:
        if root.user:
            raise frappe.ValidationError(_("A Shared Drive root cannot name a user"))
    else:
        raise frappe.ValidationError(_("Drive root kind must be Personal or Shared"))
    if root.state not in (ACTIVE, "Archived"):
        raise frappe.ValidationError(_("Drive root state must be Active or Archived"))
    return frappe._dict(node=node, root=root)


def reject_illegal_root_operation(node: dict, operation: str) -> None:
    """Guard ordinary tree operations that never apply to a root node."""
    if node.get("kind") == "root" and operation in ILLEGAL_ROOT_OPERATIONS:
        from suite.drive._core.errors import DriveForbidden

        raise DriveForbidden(_("The {0} operation does not apply to a Drive root").format(operation))


def _validate_create_arguments(kind: str, user: str | None, quota_bytes: int) -> None:
    if kind not in (PERSONAL, SHARED):
        raise frappe.ValidationError(_("Drive root kind must be Personal or Shared"))
    _validate_quota(quota_bytes)
    if kind == PERSONAL:
        if not user or not frappe.db.exists("User", user):
            raise frappe.ValidationError(_("A Personal Drive root must name an existing user"))
    elif user:
        raise frappe.ValidationError(_("A Shared Drive root cannot name a user"))


def _lock_identity(kind: str, user: str | None) -> None:
    """Serialize on a stable row; the following locking read sees the latest root."""
    if kind == PERSONAL:
        frappe.db.get_value("User", user, "name", for_update=True)
    else:
        frappe.db.get_value("DocType", "Drive Root", "name", for_update=True)


def _insert_root_node(*, title: str, owner: str) -> frappe.model.document.Document:
    node = frappe.get_doc(
        {
            "doctype": "Drive Node",
            "title": title,
            "kind": "root",
            "path": "",
            "state": ACTIVE,
            "size": 0,
            "is_template": 0,
            "owner": owner,
        }
    )
    node.flags.drive_root_lifecycle = True
    node.insert(ignore_permissions=True)
    # Document.insert assigns the session user after construction. Root ownership is
    # a domain value, not the identity of whichever request happened to provision it.
    frappe.db.set_value("Drive Node", node.name, "owner", owner, update_modified=False)
    node.owner = owner
    return node


def _insert_root_metadata(
    *, node: str, kind: str, user: str | None, quota_bytes: int
) -> frappe.model.document.Document:
    root = frappe.get_doc(
        {
            "doctype": "Drive Root",
            "node": node,
            "kind": kind,
            "user": user,
            "state": ACTIVE,
            "quota_bytes": quota_bytes,
            "used_bytes": 0,
        }
    )
    root.flags.drive_root_lifecycle = True
    return root.insert(ignore_permissions=True)


def _insert_anchor_grant(*, node: str, kind: str, user: str | None) -> None:
    principal, role = (user, MANAGE) if kind == PERSONAL else ("$GENERAL", UPLOAD)
    frappe.get_doc({"doctype": "Drive Grant", "node": node, "principal": principal, "role": role}).insert(
        ignore_permissions=True
    )


def _validate_quota(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise frappe.ValidationError(_("Drive root quota must be a nonnegative integer"))


def _require_archived(pair: frappe._dict) -> None:
    if pair.root.state != "Archived":
        raise DriveForbidden(_("Only an Archived Drive root can be purged"))


def _rollback_savepoint(savepoint: str, error: Exception) -> None:
    """Roll one root workflow back without masking MariaDB's original deadlock."""
    from suite.drive._core.nodes import _rollback_savepoint as rollback

    rollback(savepoint, error)


def _require_admin(principals: Principals) -> None:
    if not principals.is_admin:
        raise DriveForbidden(_("Suite Admin access is required"))


def _root_shape(pair: frappe._dict) -> frappe._dict:
    return frappe._dict(
        name=pair.root.name,
        node=pair.root.node,
        kind=pair.root.kind,
        user=pair.root.user,
        state=pair.root.state,
        quota_bytes=int(pair.root.quota_bytes or 0),
        used_bytes=int(pair.root.used_bytes or 0),
        title=pair.node.title,
    )


def _locked_root_descendants(root: str) -> list[frappe._dict]:
    from suite.drive._core.nodes import NODE_FIELDS

    # Same order as `_subtree`: shallowest path first, then id. Every Drive
    # workflow that locks a tree walks it in this direction.
    return frappe.db.sql(
        f"""SELECT {NODE_FIELDS} FROM `tabDrive Node`
            WHERE root = %(root)s ORDER BY CHAR_LENGTH(path), name FOR UPDATE""",
        {"root": root},
        as_dict=True,
    )


def _validate_root_descendants(root: str, descendants: list[frappe._dict]) -> None:
    from suite.drive._core.nodes import child_path

    by_name = {row.name: row for row in descendants}
    for row in descendants:
        parent = frappe.db.get_value(
            "Drive Node", row.parent_node, ["name", "root", "path", "kind"], as_dict=True, for_update=True
        )
        if not parent:
            raise DriveConflict(_("The Archived Drive root tree is incomplete"))
        expected_root = parent.name if parent.kind == "root" else parent.root
        expected_path = child_path(parent)
        if (
            parent.kind not in ("root", "folder", "document")
            or expected_root != root
            or row.root != root
            or row.path != expected_path
            or (parent.kind != "root" and parent.name not in by_name)
        ):
            raise DriveConflict(_("The Archived Drive root tree is inconsistent"))
    node_ids = (root, *tuple(by_name))
    escaped = frappe.db.sql(
        """SELECT name FROM `tabDrive Node`
           WHERE parent_node IN %(parents)s AND name NOT IN %(nodes)s
           LIMIT 1 FOR UPDATE""",
        {"parents": node_ids, "nodes": node_ids},
    )
    if escaped:
        raise DriveConflict(_("The Archived Drive root tree is incomplete"))


def _purge_root_rows(root: str, descendants: list[frappe._dict]) -> None:
    from suite.drive._core import content
    from suite.drive._core.nodes import _content_purge_callbacks

    descendant_ids = tuple(row.name for row in descendants)
    callbacks = _content_purge_callbacks(descendants)
    _delete_node_references(descendant_ids)
    for callback, docname in callbacks:
        content.call_app(callback, docname)
    if descendant_ids:
        frappe.db.delete("Drive Node", {"name": ["in", descendant_ids]})

    _delete_node_references((root,))
    frappe.db.delete("Drive Storage Reservation", {"root": root})
    frappe.db.delete("Drive Root", root)
    frappe.db.delete("Drive Node", root)


def _delete_node_references(node_ids: tuple[str, ...]) -> None:
    if not node_ids:
        return
    activity_ids = tuple(frappe.get_all("Drive Activity", filters={"node": ["in", node_ids]}, pluck="name"))
    _delete_existing_reference("Drive Comment", "node", node_ids)
    _delete_existing_reference("Drive Comment Thread", "node", node_ids)
    if activity_ids:
        _delete_existing_reference("Drive Notification", "activity", activity_ids)
    _delete_existing_reference("Drive Activity", "node", node_ids)
    _delete_existing_reference("Drive Recent", "node", node_ids)
    _delete_existing_reference("Drive Favourite", "node", node_ids)
    _delete_existing_reference("Drive Node Preview", "node", node_ids)
    _delete_existing_reference("Drive Node Version", "node", node_ids)
    _delete_existing_reference("Drive Grant", "node", node_ids)
    _delete_existing_reference("Drive DAV Lock", "entity", node_ids, require_options="Drive Node")
    _delete_existing_reference("Drive DAV Property", "entity", node_ids, require_options="Drive Node")
    _delete_existing_reference("Drive Legacy Route", "entity", node_ids, require_options="Drive Node")


def _delete_existing_reference(
    doctype: str,
    fieldname: str,
    values: tuple[str, ...],
    *,
    require_options: str | None = None,
) -> None:
    """Ignore optional side tables unless both their table and DocType exist."""
    if not frappe.db.exists("DocType", doctype) or not frappe.db.table_exists(doctype):
        return
    from suite.drive._core.nodes import _delete_if_field

    _delete_if_field(doctype, fieldname, values, require_options=require_options)
