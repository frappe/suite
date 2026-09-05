"""Permission-filtered Drive node listings and discovery views."""

import base64
import binascii
import collections
import os
from datetime import UTC, datetime
from uuid import uuid4

import frappe
from frappe import _
from frappe.storage.blob import revive_blob
from frappe.utils import convert_utc_to_system_timezone, get_attr, get_datetime, now, now_datetime

from suite.drive._core.access import (
    POINT_SQL,
    _resolve_rows,
    add_creator_grant,
    chain_ids,
    check,
    effective_role,
    effective_roles,
    require,
    require_from_rows,
    require_link,
)
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.quota import admit, release, root_for_node
from suite.drive._core.roles import EDIT, MANAGE, READ, UPLOAD
from suite.drive._core.roots import personal_root_for, reject_illegal_root_operation, validate_root_pair

DEFAULT_PAGE_SIZE = 60
MAX_PAGE_SIZE = 200

NODE_FIELD_NAMES = (
    "name",
    "parent",
    "root",
    "path",
    "title",
    "kind",
    "state",
    "trashed_at",
    "trash_root",
    "blob",
    "size",
    "mime",
    "url",
    "content_doctype",
    "content_docname",
    "content_modified",
    "is_template",
    "owner",
    "creation",
    "modified",
    "modified_by",
)
NODE_FIELDS = ", ".join(f"`{field}`" for field in NODE_FIELD_NAMES)

FOLDER_PAGE_SQL = """
SELECT page.*
FROM (
    SELECT 0 AS _drive_parent,
           EXISTS (
               SELECT 1
               FROM JSON_TABLE(
                   CASE WHEN COALESCE(parent_node.path, '') = '' THEN '[]'
                        ELSE CONCAT('["', REPLACE(TRIM(BOTH '/' FROM parent_node.path), '/', '","'), '"]')
                   END,
                   '$[*]' COLUMNS (
                       name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
                   )
               ) AS ancestor_id
               JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
               WHERE document_ancestor.kind = 'document'
           ) AS _drive_document_descendant,
           {parent_fields}
    FROM `tabDrive Node` parent_node
    WHERE parent_node.name = %(parent)s
    UNION ALL
    SELECT 1 AS _drive_parent, 0 AS _drive_document_descendant, {child_fields}
    FROM (
        SELECT {node_fields}
        FROM `tabDrive Node`
        WHERE parent = %(parent)s
          AND state = 'Active'
          AND kind <> 'root'
          AND is_template = 0
        ORDER BY {order_by} {direction}
        LIMIT %(limit)s OFFSET %(offset)s
    ) children
) page
ORDER BY page._drive_parent, page.{order_by} {direction}
"""

SHARED_SQL = """
SELECT DISTINCT g.node AS name, n.root, n.path, n.title, n.kind, n.content_doctype,
       n.content_docname, n.size, n.mime, n.content_modified, n.owner
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
JOIN `tabDrive Root` r ON r.name = n.root
WHERE g.principal IN %(own)s
  AND g.role > 0
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
  AND n.state = 'Active'
  AND n.kind <> 'root'
  AND n.is_template = 0
  AND r.state = 'Active'
  AND (%(personal_root)s IS NULL OR n.root <> %(personal_root)s)
  AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
          CASE WHEN COALESCE(n.path, '') = '' THEN '[]'
               ELSE CONCAT('["', REPLACE(TRIM(BOTH '/' FROM n.path), '/', '","'), '"]')
          END,
          '$[*]' COLUMNS (
              name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
          )
      ) AS ancestor_id
      JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
      WHERE document_ancestor.kind = 'document'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM `tabDrive Grant` ancestor_grant
      WHERE ancestor_grant.principal IN %(own)s
        AND ancestor_grant.role > 0
        AND (ancestor_grant.expires_on IS NULL OR ancestor_grant.expires_on > %(now)s)
        AND (
            ancestor_grant.node = n.root
            OR n.path LIKE CONCAT('%%/', ancestor_grant.node, '/%%')
        )
  )
ORDER BY n.title
LIMIT %(limit)s OFFSET %(offset)s
"""

ARCHIVED_SQL = """
SELECT DISTINCT r.node AS root, r.user, r.used_bytes, r.quota_bytes
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
JOIN `tabDrive Root` r ON r.node = COALESCE(n.root, n.name)
WHERE g.principal IN %(own)s
  AND g.role > 0
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
  AND r.state = 'Archived'
ORDER BY r.node
LIMIT %(limit)s OFFSET %(offset)s
"""

ADMIN_ARCHIVED_SQL = """
SELECT name AS root, user, used_bytes, quota_bytes
FROM `tabDrive Root`
WHERE kind = 'Personal' AND state = 'Archived'
ORDER BY name
LIMIT %(limit)s OFFSET %(offset)s
"""

ARCHIVED_CANDIDATES_SQL = """
SELECT DISTINCT n.name, n.root, n.path, n.kind
FROM `tabDrive Grant` g
JOIN `tabDrive Node` n ON n.name = g.node
WHERE COALESCE(n.root, n.name) IN %(roots)s
  AND g.principal IN %(own)s
  AND g.role > 0
  AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
"""

TRASH_SQL = """
SELECT n.name, n.parent, n.root, n.path, n.title, n.kind, n.state, n.size, n.mime,
       n.trashed_at, n.owner
FROM `tabDrive Node` n
WHERE n.root = %(root)s
  AND n.state = 'Trashed'
  AND n.trash_root = n.name
  AND n.kind <> 'root'
  AND n.is_template = 0
  AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
          CASE WHEN COALESCE(n.path, '') = '' THEN '[]'
               ELSE CONCAT('["', REPLACE(TRIM(BOTH '/' FROM n.path), '/', '","'), '"]')
          END,
          '$[*]' COLUMNS (
              name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
          )
      ) AS ancestor_id
      JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
      WHERE document_ancestor.kind = 'document'
  )
ORDER BY n.trashed_at DESC
LIMIT %(limit)s OFFSET %(offset)s
"""

TEMPLATES_SQL = """
SELECT n.name, n.parent, n.root, n.path, n.title, n.kind, n.state, n.size, n.mime,
       n.content_doctype, n.content_docname, n.content_modified, n.is_template, n.owner,
       n.creation, n.modified
FROM `tabDrive Node` n
WHERE n.state = 'Active'
  AND n.kind <> 'root'
  AND n.is_template = 1
  AND (%(content_doctype)s IS NULL OR n.content_doctype = %(content_doctype)s)
  AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
          CASE WHEN COALESCE(n.path, '') = '' THEN '[]'
               ELSE CONCAT('["', REPLACE(TRIM(BOTH '/' FROM n.path), '/', '","'), '"]')
          END,
          '$[*]' COLUMNS (
              name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
          )
      ) AS ancestor_id
      JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
      WHERE document_ancestor.kind = 'document'
  )
ORDER BY n.title
LIMIT %(limit)s OFFSET %(offset)s
"""

SEARCH_SQL = """
SELECT n.name, n.parent, n.root, n.path, n.title, n.kind, n.state, n.size, n.mime, n.url,
       n.content_doctype, n.content_docname, n.content_modified, n.is_template, n.owner,
       n.creation, n.modified
FROM `tabDrive Node` n
WHERE n.state = 'Active'
  AND n.kind <> 'root'
  AND n.is_template = 0
  AND n.root IN %(visible_roots)s
  AND n.title LIKE %(term)s
  AND NOT EXISTS (
      SELECT 1
      FROM JSON_TABLE(
          CASE WHEN COALESCE(n.path, '') = '' THEN '[]'
               ELSE CONCAT('["', REPLACE(TRIM(BOTH '/' FROM n.path), '/', '","'), '"]')
          END,
          '$[*]' COLUMNS (
              name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
          )
      ) AS ancestor_id
      JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
      WHERE document_ancestor.kind = 'document'
  )
ORDER BY n.modified DESC
LIMIT %(limit)s OFFSET %(offset)s
"""

VISIBLE_ROOTS_SQL = """
SELECT DISTINCT r.name
FROM `tabDrive Root` r
WHERE (r.kind = 'Personal' AND r.state = 'Active' AND r.user = %(user)s)
   OR (r.kind = 'Shared' AND r.state = 'Active')
   OR r.name IN (
       SELECT COALESCE(n.root, n.name)
       FROM `tabDrive Grant` g
       JOIN `tabDrive Node` n ON n.name = g.node
       WHERE g.principal IN %(own)s
         AND g.role > 0
         AND (g.expires_on IS NULL OR g.expires_on > %(now)s)
   )
"""

SUBTREE_SQL = f"""
SELECT {NODE_FIELDS}
FROM `tabDrive Node`
WHERE root = %(root)s
  AND (name = %(node)s OR path LIKE %(prefix)s)
ORDER BY CHAR_LENGTH(path), name
FOR UPDATE
"""

SUBTREE_CHARGE_SQL = """
SELECT COALESCE(SUM(n.size), 0) + COALESCE((
         SELECT SUM(v.size)
         FROM `tabDrive Node Version` v
         WHERE v.node IN (
             SELECT s.name
             FROM `tabDrive Node` s
             WHERE s.root = %(root)s
               AND (s.name = %(node)s OR s.path LIKE %(prefix)s)
         )
       ), 0) AS delta
FROM `tabDrive Node` n
WHERE n.root = %(root)s
  AND (n.name = %(node)s OR n.path LIKE %(prefix)s)
"""

MOVE_DESCENDANTS_SQL = """
UPDATE `tabDrive Node`
SET path = CONCAT(%(new_prefix)s, SUBSTRING(path, CHAR_LENGTH(%(old_prefix)s) + 1)),
    root = %(dest_root)s
WHERE root = %(src_root)s
  AND path LIKE %(old_prefix_like)s
"""

MOVE_NODE_SQL = """
UPDATE `tabDrive Node`
SET parent = %(dest)s,
    path = %(dest_child_path)s,
    root = %(dest_root)s,
    modified = %(now)s,
    modified_by = %(actor)s
WHERE name = %(node)s
"""


def create_folder(principals: Principals, parent: str, title: str) -> str:
    """Create an empty folder below an authorized active container."""
    return _create_empty_node(principals, parent, title, kind="folder")


def create_link(principals: Principals, parent: str, title: str, *, url: str) -> str:
    """Create a URL link below an authorized active container."""
    if not isinstance(url, str) or not url.strip():
        frappe.throw(_("A Drive link URL is required"), frappe.ValidationError)
    return _create_empty_node(principals, parent, title, kind="link", url=url)


def _create_empty_node(
    principals: Principals,
    parent: str,
    title: str,
    *,
    kind: str,
    url: str | None = None,
) -> str:
    _validate_title(title)
    savepoint = f"drive_create_{kind}_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        parent_row = _lock_create_parent(parent)
        via_link = require(parent_row, UPLOAD, principals)
        _validate_parent(parent_row, for_update=True, allow_document=False)
        _refuse_sibling_collision(parent_row.name, title)
        node = _insert_node(
            principals,
            parent_row,
            title=title,
            kind=kind,
            url=url,
        )
        add_creator_grant(node, parent_row, principals, via_link=via_link)
        detail = {"kind": kind, "title": title}
        if url is not None:
            detail["url"] = url
        _record_activity(node.name, "create", principals, detail, via_link=via_link)
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return node.name


def create_file(
    principals: Principals,
    parent: str,
    title: str,
    *,
    blob: str,
    size: int,
    mime: str,
    content_modified: datetime | int | float | str | None = None,
    _via_link: str | None = None,
) -> str:
    """Create one private blob-backed file and charge its root atomically."""
    _validate_title(title)
    savepoint = f"drive_create_file_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        parent_row = _lock_create_parent(parent)
        via_link = require(parent_row, UPLOAD, principals)
        if _via_link is not None:
            require_link(parent_row, UPLOAD, principals, _via_link)
            via_link = _via_link
        _validate_parent(parent_row, for_update=True)
        blob_row = _validated_blob(blob, size, mime)
        _refuse_sibling_collision(parent_row.name, title)
        root = root_for_node(parent_row).name
        path = "" if parent_row.kind == "root" else f"{parent_row.path or '/'}{parent_row.name}/"
        admit(root, blob_row.file_size)
        node = frappe.get_doc(
            {
                "doctype": "Drive Node",
                "title": title,
                "parent": parent_row.name,
                "root": root,
                "path": path,
                "kind": "file",
                "blob": blob_row.name,
                "size": blob_row.file_size,
                "mime": blob_row.mime_type,
                "state": "Active",
                "content_modified": _content_time(content_modified),
                "is_template": 0,
                "owner": principals.user,
            }
        ).insert(ignore_permissions=True)
        # Document.insert assigns the transport session user. Ownership is the
        # explicit Drive actor, including Guest/link attribution.
        frappe.db.set_value("Drive Node", node.name, "owner", principals.user, update_modified=False)
        node.owner = principals.user
        add_creator_grant(node, parent_row, principals, via_link=via_link)
        _record_activity(
            node.name,
            "create",
            principals,
            {"kind": "file", "title": title, "size": blob_row.file_size, "blob": blob_row.name},
            via_link=via_link,
        )
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return node.name


def update(
    principals: Principals,
    node: str,
    *,
    title: str | None = None,
    parent: str | None = None,
    state: str | None = None,
    blob: str | None = None,
    size: int | None = None,
    mime: str | None = None,
    content_modified: datetime | int | float | str | None = None,
    _via_link: str | None = None,
    _bound_parent: str | None = None,
) -> dict:
    """Apply one complete node mutation, or restore with an explicit parent."""
    replacing = any(value is not None for value in (blob, size, mime, content_modified))
    if replacing:
        if title is not None or parent is not None or state is not None:
            frappe.throw(_("A file replacement cannot include a tree mutation"), frappe.ValidationError)
        return _replace_file(
            principals,
            node,
            blob=blob,
            size=size,
            mime=mime,
            content_modified=content_modified,
            _via_link=_via_link,
            _bound_parent=_bound_parent,
        )

    if state is not None:
        if title is not None or state not in ("Active", "Trashed"):
            frappe.throw(_("The Drive node state mutation is invalid"), frappe.ValidationError)
        if state == "Trashed" and parent is not None:
            frappe.throw(_("Trashing cannot select a destination"), frappe.ValidationError)
        return _restore(principals, node, parent=parent) if state == "Active" else _trash(principals, node)

    if parent is not None:
        if title is not None:
            frappe.throw(_("Rename and move must be separate Drive writes"), frappe.ValidationError)
        return _move(principals, node, parent)
    if title is not None:
        return _rename(principals, node, title)
    frappe.throw(_("A Drive node mutation is required"), frappe.ValidationError)


def _replace_file(
    principals: Principals,
    node: str,
    *,
    blob: str | None = None,
    size: int | None = None,
    mime: str | None = None,
    content_modified: datetime | int | float | str | None = None,
    _via_link: str | None = None,
    _bound_parent: str | None = None,
) -> dict:
    """Replace a file head, preserving a nonempty old head as one auto version."""
    if blob is None or size is None or mime is None:
        frappe.throw(_("A file replacement requires blob, size, and MIME type"), frappe.ValidationError)

    savepoint = f"drive_replace_file_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        via_link = require(current, EDIT, principals)
        if _via_link is not None:
            # The exact link remains bound to the original upload parent. EDIT
            # on the replacement target is a separate, fresh authorization.
            via_link = _via_link
        if current.kind != "file" or current.state != "Active":
            raise DriveForbidden(_("Only an active Drive file can be replaced"))
        if _bound_parent is not None and current.parent != _bound_parent:
            raise DriveForbidden(_("The replacement moved outside the upload destination"))
        _validate_stored_position(current, for_update=True)
        blob_row = _validated_blob(blob, size, mime)
        _validate_existing_head(current)

        version = None
        if current.blob and int(current.size or 0) > 0:
            version = _preserve_head(current, principals)

        # The old head's existing charge becomes the version's charge. Only
        # the new head increases total logical usage, including same-blob edits.
        admit(current.root, blob_row.file_size)
        frappe.db.set_value(
            "Drive Node",
            current.name,
            {
                "blob": blob_row.name,
                "size": blob_row.file_size,
                "mime": blob_row.mime_type,
                "content_modified": _content_time(content_modified),
            },
        )
        _record_activity(
            current.name,
            "edit",
            principals,
            {"blob": blob_row.name, "size": blob_row.file_size, "version": version},
            via_link=via_link,
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)

    return frappe.db.get_value("Drive Node", current.name, NODE_FIELD_NAMES, as_dict=True)


def _rename(principals: Principals, node_id: str, title: str) -> dict:
    _validate_title(title)
    savepoint = f"drive_rename_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node_id, for_update=True)
        via_link = require(current, EDIT, principals)
        if current.state != "Active":
            raise DriveForbidden(_("A trashed Drive node cannot be renamed"))
        if current.kind == "root":
            root_for_node(current, for_update=True)
        else:
            _validate_stored_position(current, for_update=True)
            _node(current.parent, for_update=True)
            _refuse_sibling_collision(current.parent, title, exclude=current.name)
        old_title = current.title
        if title != old_title:
            frappe.db.set_value("Drive Node", current.name, "title", title)
            _record_activity(
                current.name,
                "rename",
                principals,
                {"old_title": old_title, "new_title": title},
                via_link=via_link,
            )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return _node(current.name)


def _move(principals: Principals, node_id: str, destination_id: str) -> dict:
    savepoint = f"drive_move_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current, destination, subtree = _lock_move_rows(node_id, destination_id)
        reject_illegal_root_operation(current, "move")
        source_link = require(current, EDIT, principals)
        if current.state != "Active":
            raise DriveForbidden(_("A trashed Drive node must be restored, not moved"))
        _validate_stored_position(current, for_update=True)
        destination_link = require(destination, UPLOAD, principals)
        _validate_generic_destination(current, destination, operation="move")
        _validate_subtree(current, subtree)
        _validate_move_depth(current, destination, subtree)
        _refuse_sibling_collision(destination.name, current.title, exclude=current.name)

        source_root = current.root
        destination_root = root_for_node(destination, for_update=True).name
        delta = _subtree_charge(current)
        if source_root != destination_root:
            admit(destination_root, delta)
        _rewrite_subtree(current, destination, destination_root, actor=principals.user)
        if source_root != destination_root:
            release(source_root, delta)

        moved = _node(current.name)
        activity_link = source_link or destination_link
        _add_mover_grant(moved, principals, destination_link=destination_link)
        _record_activity(
            moved.name,
            "move",
            principals,
            {
                "from": current.parent,
                "to": destination.name,
                "from_root": source_root,
                "to_root": destination_root,
            },
            via_link=activity_link,
        )
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return _node(current.name)


def _lock_move_rows(
    node_id: str, destination_id: str
) -> tuple[frappe._dict, frappe._dict, list[frappe._dict]]:
    """Lock both ancestry chains, the source subtree, then root metadata."""
    initial = {node_id: _node(node_id), destination_id: _node(destination_id)}
    root_ids = {root_id(row) for row in initial.values()}
    if None in root_ids:
        raise DriveConflict(_("The Drive move has an invalid root"))
    locked = _lock_tree_chains(initial)
    current = locked[node_id]
    destination = locked[destination_id]
    subtree = _subtree(current)
    for candidate_root in sorted(root_ids):
        validate_root_pair(candidate_root, for_update=True)
    return current, destination, subtree


def _add_mover_grant(node: dict, principals: Principals, *, destination_link: str | None) -> bool:
    """Keep a mover at EDIT only when their authority no longer travels."""
    if principals.user == "Guest" or destination_link or effective_role(node, principals) >= EDIT:
        return False
    frappe.get_doc(
        {
            "doctype": "Drive Grant",
            "node": node.get("name"),
            "principal": principals.user,
            "role": EDIT,
        }
    ).insert(ignore_permissions=True)
    return True


def _trash(principals: Principals, node_id: str) -> dict:
    savepoint = f"drive_trash_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node_id, for_update=True)
        reject_illegal_root_operation(current, "trash")
        via_link = require(current, EDIT, principals)
        if current.state != "Active":
            raise DriveConflict(_("The Drive node is already trashed"))
        # Lock every existing parent namespace before the bulk stamp. A
        # compliant concurrent create locks one of these same rows first.
        subtree = _subtree(current)
        _validate_subtree(current, subtree)
        _validate_stored_position(current, for_update=True)
        stamp = now_datetime()
        frappe.db.sql(
            """
            UPDATE `tabDrive Node`
            SET state = 'Trashed', trash_root = %(node)s, trashed_at = %(stamp)s
            WHERE kind <> 'root' AND state = 'Active' AND root = %(root)s
              AND (name = %(node)s OR path LIKE %(prefix)s)
            """,
            {
                "node": current.name,
                "root": current.root,
                "prefix": f"{child_path(current)}%",
                "stamp": stamp,
            },
        )
        changed = int(frappe.db.sql("SELECT ROW_COUNT()")[0][0])
        _record_activity(
            current.name,
            "trash",
            principals,
            {"trash_root": current.name, "nodes": changed},
            via_link=via_link,
            at=stamp,
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return _node(current.name)


def _restore(principals: Principals, node_id: str, *, parent: str | None) -> dict:
    savepoint = f"drive_restore_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node_id, for_update=True)
        reject_illegal_root_operation(current, "restore")
        if current.state != "Trashed" or current.trash_root != current.name or not current.trashed_at:
            raise DriveConflict(_("Only a trash root can be restored"))
        subtree = _subtree(current)
        _validate_subtree(current, subtree)
        via_link = require(current, EDIT, principals)
        _require_restore_actor(current, principals, via_link)

        original_available = _original_parent_available(current)
        if original_available:
            if parent is not None and parent != current.parent:
                raise DriveConflict(
                    _("A restore destination is only used when the original path is unavailable")
                )
            destination = _node(current.parent, for_update=True)
            reparented_to = None
        else:
            if parent is None:
                raise DriveConflict(_("Choose an active destination before restoring this node"))
            destination = _node(parent, for_update=True)
            reparented_to = destination.name

        if reparented_to is not None:
            require(destination, UPLOAD, principals)
        _validate_generic_destination(current, destination, operation="restore")
        if root_id(destination) != current.root:
            raise DriveConflict(_("A restored node must stay in its original Drive root"))

        _validate_move_depth(current, destination, subtree)
        restored_title = _deduplicated_title(destination.name, current.title, exclude=current.name)
        if destination.name != current.parent:
            _rewrite_subtree(current, destination, current.root, actor=principals.user)
        if restored_title != current.title:
            frappe.db.set_value("Drive Node", current.name, "title", restored_title, update_modified=False)

        frappe.db.sql(
            """
            UPDATE `tabDrive Node`
            SET state = 'Active', trash_root = NULL, trashed_at = NULL
            WHERE state = 'Trashed' AND trash_root = %(node)s AND trashed_at = %(stamp)s
            """,
            {"node": current.name, "stamp": current.trashed_at},
        )
        changed = int(frappe.db.sql("SELECT ROW_COUNT()")[0][0])
        if not changed:
            raise DriveConflict(_("The Drive trash state changed during restore"))
        _record_activity(
            current.name,
            "restore",
            principals,
            {"trash_root": current.name, "nodes": changed, "reparented_to": reparented_to},
            via_link=via_link,
        )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return _node(current.name)


def purge(principals: Principals, node: str) -> int:
    """Permanently remove a non-root subtree and release its logical bytes."""
    savepoint = f"drive_purge_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        reject_illegal_root_operation(current, "purge")
        via_link = require(current, MANAGE, principals)
        subtree = _subtree(current)
        _validate_purge_root(current)
        count = _purge_locked(current, principals, via_link=via_link, subtree=subtree)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return count


def purge_expired_trash_root(node: str, cutoff: datetime) -> int:
    """Purge one still-expired trash root under its row lock for the daily job."""
    savepoint = f"drive_expired_purge_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        if (
            current.state != "Trashed"
            or current.trash_root != current.name
            or not current.trashed_at
            or get_datetime(current.trashed_at) >= get_datetime(cutoff)
        ):
            frappe.db.release_savepoint(savepoint)
            return 0
        system = Principals("Administrator", ("Administrator",), (), is_admin=True)
        subtree = _subtree(current)
        _validate_purge_root(current)
        count = _purge_locked(current, system, via_link=None, subtree=subtree)
    except DriveNotFound:
        frappe.db.rollback(save_point=savepoint)
        return 0
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return count


def copy(principals: Principals, node: str, parent: str, *, title: str | None = None) -> str:
    """Copy one readable ordinary tree, sharing blobs but no authority or history."""
    if title is not None:
        _validate_title(title)
    savepoint = f"drive_copy_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        source, destination, physical_source_rows = _lock_move_rows(node, parent)
        reject_illegal_root_operation(source, "copy")
        source_link = require(source, READ, principals)
        if source.state != "Active":
            raise DriveForbidden(_("A trashed Drive node cannot be copied"))
        _validate_subtree(source, physical_source_rows)
        _validate_stored_position(source, for_update=True)
        destination_link = require(destination, UPLOAD, principals)
        activity_link = source_link or destination_link
        _validate_generic_destination(source, destination, operation="copy")

        source_rows = _copyable_subtree(source, principals, physical_rows=physical_source_rows)
        if any(row.kind == "document" for row in source_rows):
            raise DriveConflict(_("Content documents require their registered Drive copy workflow"))
        for source_row in source_rows:
            _validate_copy_source_row(source_row)
        _validate_move_depth(source, destination, source_rows)
        copied_title = _deduplicated_title(destination.name, title or source.title)
        destination_root = root_id(destination)
        admit(destination_root, sum(int(row.size or 0) for row in source_rows))

        by_source: dict[str, frappe._dict] = {}
        for source_row in source_rows:
            copied_parent = destination if source_row.name == source.name else by_source[source_row.parent]
            new_node = _insert_node(
                principals,
                copied_parent,
                title=copied_title if source_row.name == source.name else source_row.title,
                kind=source_row.kind,
                blob=source_row.blob,
                size=int(source_row.size or 0),
                mime=source_row.mime,
                url=source_row.url,
                content_modified=source_row.content_modified,
            )
            by_source[source_row.name] = new_node
            add_creator_grant(new_node, copied_parent, principals, via_link=destination_link)
            _record_activity(
                new_node.name,
                "create",
                principals,
                {"kind": new_node.kind, "title": new_node.title, "copied_from": source_row.name},
                via_link=activity_link,
            )
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return by_source[source.name].name


def root_id(node: dict) -> str:
    """Return the root-node id for either a root or ordinary node."""
    return node.get("name") if node.get("kind") == "root" else node.get("root")


def child_path(node: dict) -> str:
    """Return the root-relative path assigned to direct children of a node."""
    if node.get("kind") == "root":
        return ""
    return f"{node.get('path') or '/'}{node.get('name')}/"


def _insert_node(
    principals: Principals,
    parent: dict,
    *,
    title: str,
    kind: str,
    blob: str | None = None,
    size: int = 0,
    mime: str | None = None,
    url: str | None = None,
    content_modified=None,
) -> frappe._dict:
    values = {
        "doctype": "Drive Node",
        "title": title,
        "parent": parent.get("name"),
        "root": root_id(parent),
        "path": child_path(parent),
        "kind": kind,
        "blob": blob,
        "size": size,
        "mime": mime,
        "url": url,
        "state": "Active",
        "content_modified": content_modified,
        "is_template": 0,
        "owner": principals.user,
    }
    node = frappe.get_doc(values).insert(ignore_permissions=True)
    frappe.db.set_value("Drive Node", node.name, "owner", principals.user, update_modified=False)
    node.owner = principals.user
    return frappe._dict(node.as_dict())


def _subtree(node: dict) -> list[frappe._dict]:
    return frappe.db.sql(
        SUBTREE_SQL,
        {"root": node.get("root"), "node": node.get("name"), "prefix": f"{child_path(node)}%"},
        as_dict=True,
    )


def _copyable_subtree(
    source: dict,
    principals: Principals,
    *,
    physical_rows: list[frappe._dict] | None = None,
) -> list[frappe._dict]:
    if physical_rows is None:
        physical_rows = _subtree(source)
        _validate_subtree(source, physical_rows)
    rows = [row for row in physical_rows if row.state == "Active"]
    included = {source.get("name")}
    copyable = []
    for row in rows:
        if row.name == source.get("name"):
            copyable.append(row)
            continue
        if row.parent not in included or not check(row, READ, principals):
            continue
        included.add(row.name)
        copyable.append(row)
    return copyable


def _validate_generic_destination(source: dict, destination: dict, *, operation: str) -> None:
    if destination.get("kind") not in ("root", "folder") or destination.get("state") != "Active":
        raise DriveConflict(_("The destination must be an active Drive folder or root"))
    _validate_parent(destination, for_update=True, allow_document=False)
    if _has_document_ancestor(destination):
        raise DriveConflict(_("Generic tree writes cannot target media below a content document"))
    if source.get("name") == destination.get("name") or _is_descendant(destination, source.get("name")):
        raise DriveConflict(_("A Drive node cannot be placed inside itself"))
    if _has_document_ancestor(source):
        raise DriveConflict(
            _("Media below a content document requires the registered Drive content workflow")
        )
    if operation == "copy" and source.get("kind") == "document":
        raise DriveConflict(_("Content documents require their registered Drive copy workflow"))


def _validate_copy_source_row(node: dict) -> None:
    kind = node.get("kind")
    size = node.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise DriveConflict(_("The source Drive node has an invalid size"))
    if kind == "file":
        if (
            node.get("url")
            or node.get("content_doctype")
            or node.get("content_docname")
            or node.get("is_template")
        ):
            raise DriveConflict(_("The source Drive file shape is invalid"))
        try:
            _validate_existing_head(node)
        except frappe.ValidationError as exc:
            raise DriveConflict(_("The source Drive file head is invalid")) from exc
    elif kind == "folder":
        if any(
            (
                node.get("blob"),
                size,
                node.get("mime"),
                node.get("url"),
                node.get("content_doctype"),
                node.get("content_docname"),
                node.get("is_template"),
            )
        ):
            raise DriveConflict(_("The source Drive folder shape is invalid"))
    elif kind == "link":
        if not node.get("url") or any(
            (
                node.get("blob"),
                size,
                node.get("mime"),
                node.get("content_doctype"),
                node.get("content_docname"),
                node.get("is_template"),
            )
        ):
            raise DriveConflict(_("The source Drive link shape is invalid"))
    else:
        raise DriveConflict(_("The source Drive node kind cannot be copied"))


def _has_document_ancestor(node: dict) -> bool:
    ancestor_ids = chain_ids(node)[:-1]
    if not ancestor_ids:
        return False
    return bool(
        frappe.db.get_value(
            "Drive Node",
            {"name": ["in", tuple(ancestor_ids)], "kind": "document"},
            "name",
        )
    )


def _is_descendant(candidate: dict, ancestor: str) -> bool:
    return f"/{ancestor}/" in (candidate.get("path") or "")


def _depth(node: dict) -> int:
    if node.get("kind") == "root":
        return 0
    return len([part for part in (node.get("path") or "").split("/") if part]) + 1


def _validate_move_depth(source: dict, destination: dict, subtree: list[dict]) -> None:
    source_depth = _depth(source)
    height = max((_depth(row) - source_depth for row in subtree), default=0)
    if len(chain_ids(destination)) + height > 40:
        raise DriveConflict(_("A Drive tree cannot be deeper than 40 levels"))


def _subtree_charge(source: dict) -> int:
    """Return head and version bytes using the root-leading subtree index."""
    delta = frappe.db.sql(
        SUBTREE_CHARGE_SQL,
        {
            "root": source.get("root"),
            "node": source.get("name"),
            "prefix": f"{child_path(source)}%",
        },
    )[0][0]
    return int(delta or 0)


def _rewrite_subtree(source: dict, destination: dict, destination_root: str, *, actor: str) -> None:
    old_prefix = child_path(source)
    destination_child_path = child_path(destination)
    new_prefix = f"{destination_child_path or '/'}{source.get('name')}/"
    frappe.db.sql(
        MOVE_DESCENDANTS_SQL,
        {
            "old_prefix": old_prefix,
            "old_prefix_like": f"{old_prefix}%",
            "new_prefix": new_prefix,
            "src_root": source.get("root"),
            "dest_root": destination_root,
        },
    )
    frappe.db.sql(
        MOVE_NODE_SQL,
        {
            "dest": destination.get("name"),
            "dest_child_path": destination_child_path,
            "dest_root": destination_root,
            "now": now_datetime(),
            "actor": actor,
            "node": source.get("name"),
        },
    )


def _original_parent_available(node: dict) -> bool:
    try:
        _validate_stored_position(node, for_update=True)
    except (DriveConflict, DriveNotFound):
        return False
    return True


def _require_restore_actor(node: dict, principals: Principals, via_link: str | None) -> None:
    activity = frappe.db.get_value(
        "Drive Activity",
        {"node": node.get("name"), "action": "trash", "at": node.get("trashed_at")},
        ["actor", "via_link"],
        as_dict=True,
        order_by="creation desc",
    )
    same_actor = bool(activity and activity.actor == principals.user)
    if principals.user == "Guest":
        same_actor = same_actor and bool(via_link) and activity.via_link == via_link
    if not same_actor:
        require(node, MANAGE, principals)


def _deduplicated_title(parent: str, title: str, *, exclude: str | None = None) -> str:
    if not _title_exists(parent, title, exclude=exclude):
        return title
    stem, extension = os.path.splitext(title)
    suffix = 2
    while _title_exists(parent, f"{stem} ({suffix}){extension}", exclude=exclude):
        suffix += 1
    return f"{stem} ({suffix}){extension}"


def _title_exists(parent: str, title: str, *, exclude: str | None = None) -> bool:
    return bool(
        frappe.db.sql(
            """
            SELECT name
            FROM `tabDrive Node`
            WHERE parent = %(parent)s AND state = 'Active' AND title = %(title)s
              AND (%(exclude)s IS NULL OR name <> %(exclude)s)
            LIMIT 1
            FOR UPDATE
            """,
            {"parent": parent, "title": title, "exclude": exclude},
        )
    )


def _purge_locked(
    current: dict,
    principals: Principals,
    *,
    via_link: str | None,
    subtree: list[dict] | None = None,
) -> int:
    if subtree is None:
        subtree = _subtree(current)
    _validate_subtree(current, subtree)
    node_ids = tuple(row.name for row in subtree)
    callbacks = _content_purge_callbacks(subtree)
    charged = _subtree_charge(current)

    _record_activity(
        current.get("name"),
        "delete",
        principals,
        {"nodes": len(subtree), "bytes": charged},
        via_link=via_link,
    )
    activity_ids = tuple(frappe.get_all("Drive Activity", filters={"node": ["in", node_ids]}, pluck="name"))

    _delete_if_field("Drive Comment", "node", node_ids)
    _delete_if_field("Drive Comment Thread", "node", node_ids)
    if activity_ids:
        _delete_if_field("Drive Notification", "activity", activity_ids)
    _delete_if_field("Drive Activity", "node", node_ids)
    _delete_if_field("Drive Recent", "node", node_ids)
    _delete_if_field("Drive Favourite", "node", node_ids)
    _delete_if_field("Drive Node Preview", "node", node_ids)
    _delete_if_field("Drive Node Version", "node", node_ids)
    _delete_if_field("Drive Grant", "node", node_ids)
    _delete_if_field("Drive DAV Lock", "entity", node_ids, require_options="Drive Node")
    _delete_if_field("Drive DAV Property", "entity", node_ids, require_options="Drive Node")
    _delete_if_field("Drive Legacy Route", "entity", node_ids, require_options="Drive Node")

    for callback, docname in callbacks:
        callback(docname)
    frappe.db.delete("Drive Node", {"name": ["in", node_ids]})
    release(current.get("root"), charged)
    return len(subtree)


def _validate_purge_root(node: dict) -> None:
    if not node.get("parent") or not node.get("root"):
        raise DriveConflict(_("The Drive node has an invalid tree position"))
    root_for_node(node, for_update=True)
    cursor = node
    seen = {node.get("name")}
    for _depth_index in range(40):
        parent = _chain_node(cursor.get("parent"), for_update=True)
        if parent.name in seen:
            raise DriveConflict(_("The Drive node tree contains a cycle"))
        expected_root = parent.name if parent.kind == "root" else parent.root
        expected_path = child_path(parent)
        if (
            parent.kind not in ("root", "folder", "document")
            or cursor.get("root") != expected_root
            or cursor.get("path") != expected_path
        ):
            raise DriveConflict(_("The Drive node's parent, root, and path do not agree"))
        if parent.kind == "root":
            return
        seen.add(parent.name)
        cursor = parent
    raise DriveConflict(_("A Drive tree cannot be deeper than 40 levels"))


def _validate_subtree(current: dict, subtree: list[dict]) -> None:
    if not subtree or subtree[0].name != current.get("name"):
        raise DriveConflict(_("The Drive subtree is incomplete"))
    by_name = {row.name: row for row in subtree}
    if len(by_name) != len(subtree):
        raise DriveConflict(_("The Drive subtree contains duplicate nodes"))
    for row in subtree[1:]:
        parent = by_name.get(row.parent)
        if (
            parent is None
            or row.root != current.get("root")
            or row.path != child_path(parent)
            or parent.kind not in ("folder", "document")
        ):
            raise DriveConflict(_("The Drive subtree has an invalid tree position"))
    escaped_child = frappe.db.sql(
        """
        SELECT name
        FROM `tabDrive Node`
        WHERE parent IN %(parents)s AND name NOT IN %(nodes)s
        LIMIT 1
        FOR UPDATE
        """,
        {"parents": tuple(by_name), "nodes": tuple(by_name)},
    )
    if escaped_child:
        raise DriveConflict(_("The Drive subtree is incomplete"))


def _content_purge_callbacks(subtree: list[dict]) -> list[tuple]:
    documents = [row for row in subtree if row.kind == "document"]
    if not documents:
        return []

    registry = {}
    for path in frappe.get_hooks("drive_content_types") or ():
        spec = get_attr(path)
        doctype = getattr(spec, "doctype", None)
        if not isinstance(doctype, str) or not doctype or doctype in registry:
            raise DriveConflict(_("The Drive content registry is invalid"))
        callback = getattr(spec, "on_purge", None)
        if not callable(callback):
            raise DriveConflict(_("The Drive content type has no purge callback"))
        registry[doctype] = callback

    callbacks = []
    for row in sorted(documents, key=lambda item: (-_depth(item), item.name)):
        if not row.content_doctype or not row.content_docname:
            raise DriveConflict(_("The Drive content document link is incomplete"))
        callback = registry.get(row.content_doctype)
        if callback is None:
            raise DriveConflict(_("The Drive content type is not registered"))
        callbacks.append((callback, row.content_docname))
    return callbacks


def _delete_if_field(
    doctype: str,
    fieldname: str,
    values: tuple[str, ...],
    *,
    require_options: str | None = None,
) -> None:
    if not values or not frappe.db.exists("DocType", doctype) or not frappe.db.table_exists(doctype):
        return
    field = frappe.get_meta(doctype).get_field(fieldname)
    if not field or (require_options is not None and field.options != require_options):
        return
    frappe.db.delete(doctype, {fieldname: ["in", values]})


def _node(node_id: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Node",
        node_id,
        NODE_FIELD_NAMES,
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node_id))
    return row


def _lock_create_parent(parent_id: str) -> frappe._dict:
    """Lock one creation chain in the source-to-descendant move order."""
    snapshot = _node(parent_id)
    return _lock_tree_chains({parent_id: snapshot})[parent_id]


def _lock_tree_chains(snapshots: dict[str, frappe._dict]) -> dict[str, frappe._dict]:
    """Lock immutable snapshots by depth and id, with root nodes last.

    Create and move both use this order. It puts a move source before every
    descendant in its subtree without reversing the destination ancestry
    order used by a concurrent create.
    """
    expected = {}
    by_depth: dict[int, set[str]] = {}
    roots = set()
    for node_id, snapshot in snapshots.items():
        chain = chain_ids(snapshot)
        if (
            not chain
            or not all(isinstance(candidate, str) and candidate for candidate in chain)
            or chain[-1] != node_id
            or len(chain) != len(set(chain))
        ):
            raise DriveConflict(_("The Drive node has an invalid tree position"))
        expected[node_id] = tuple(chain)
        roots.add(chain[0])
        for depth, candidate in enumerate(chain[1:], start=1):
            by_depth.setdefault(depth, set()).add(candidate)

    for depth in sorted(by_depth):
        for candidate in sorted(by_depth[depth]):
            _chain_node(candidate, for_update=True)
    for root in sorted(roots):
        _chain_node(root, for_update=True)

    refreshed = {node_id: _chain_node(node_id, for_update=True) for node_id in sorted(snapshots)}
    if any(tuple(chain_ids(refreshed[node_id])) != chain for node_id, chain in expected.items()):
        raise DriveConflict(_("The Drive tree changed; retry the operation"))
    return refreshed


def _chain_node(node_id: str, *, for_update: bool = False) -> frappe._dict:
    """Read one node the stored tree reached, refusing a missing row as a conflict.

    Every id here comes from a stored parent, root, or path, or is a caller-named
    node this workflow already found. A row missing now is corrupt or concurrently
    removed structure, which the caller sees as a conflict, never as the node they
    named being absent.
    """
    try:
        return _node(node_id, for_update=for_update)
    except DriveNotFound as exc:
        raise DriveConflict(_("The Drive node has an invalid tree position")) from exc


def _rollback_savepoint(savepoint: str, error: Exception) -> None:
    """Rollback one workflow without masking MariaDB's original deadlock."""
    try:
        frappe.db.rollback(save_point=savepoint)
    except Exception:
        if not isinstance(error, frappe.QueryDeadlockError):
            raise
        # InnoDB has already rolled back the deadlock victim's transaction,
        # including its savepoints. A full rollback safely resets the handle.
        frappe.db.rollback()


def _validate_parent(
    parent: frappe._dict,
    *,
    for_update: bool = False,
    allow_document: bool = True,
) -> None:
    allowed_kinds = ("root", "folder", "document") if allow_document else ("root", "folder")
    if parent.state != "Active" or parent.kind not in allowed_kinds:
        raise DriveConflict(_("Files can only be created below an active Drive container"))
    if len(chain_ids(parent)) > 40:
        raise DriveConflict(_("A Drive tree cannot be deeper than 40 levels"))
    if parent.kind == "root":
        root_for_node(parent, for_update=for_update)
    else:
        _validate_stored_position(parent, for_update=for_update)


def _validate_stored_position(node: frappe._dict, *, for_update: bool = False) -> None:
    """Validate the materialized parent/root/path chain using current reads."""
    cursor = node
    seen = {cursor.name}
    for _depth in range(41):
        if cursor.kind == "root":
            root_for_node(cursor, for_update=for_update)
            return
        if not cursor.parent or not cursor.root:
            raise DriveConflict(_("The Drive node has an invalid tree position"))
        parent = _chain_node(cursor.parent, for_update=for_update)
        if parent.name in seen:
            raise DriveConflict(_("The Drive node tree contains a cycle"))
        if parent.state != "Active" or parent.kind not in ("root", "folder", "document"):
            raise DriveConflict(_("The Drive node's parent is not an active container"))
        effective_root = parent.name if parent.kind == "root" else parent.root
        expected_path = "" if parent.kind == "root" else f"{parent.path or '/'}{parent.name}/"
        if cursor.root != effective_root or cursor.path != expected_path:
            raise DriveConflict(_("The Drive node's parent, root, and path do not agree"))
        seen.add(parent.name)
        cursor = parent
    raise DriveConflict(_("A Drive tree cannot be deeper than 40 levels"))


def _validate_title(title: str) -> None:
    if not isinstance(title, str) or not title.strip():
        frappe.throw(_("A Drive file title is required"), frappe.ValidationError)


def _refuse_sibling_collision(parent: str, title: str, *, exclude: str | None = None) -> None:
    collision = frappe.db.sql(
        """
        SELECT name
        FROM `tabDrive Node`
        WHERE parent = %(parent)s AND title = %(title)s AND state = 'Active'
          AND (%(exclude)s IS NULL OR name <> %(exclude)s)
        LIMIT 1
        FOR UPDATE
        """,
        {"parent": parent, "title": title, "exclude": exclude},
    )
    if collision:
        raise DriveConflict(_("An active Drive node with this title already exists"))


def _validated_blob(blob: str, size: int, mime: str) -> frappe._dict:
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        frappe.throw(_("Drive file size must be a nonnegative integer"), frappe.ValidationError)
    if not revive_blob(blob):
        frappe.throw(_("Drive files require an existing private blob"), frappe.ValidationError)
    row = frappe.db.get_value(
        "File Blob",
        blob,
        ["name", "file_size", "mime_type", "is_private", "status"],
        as_dict=True,
    )
    if (
        not row
        or row.status != "Ready"
        or not row.is_private
        or row.file_size != size
        or row.mime_type != mime
    ):
        frappe.throw(_("Drive files require matching ready private blob metadata"), frappe.ValidationError)
    return row


def _validate_existing_head(node: frappe._dict) -> None:
    if not node.blob:
        if int(node.size or 0) != 0 or node.mime:
            frappe.throw(_("The existing Drive file head is inconsistent"), frappe.ValidationError)
        return
    row = frappe.db.get_value(
        "File Blob",
        node.blob,
        ["name", "file_size", "mime_type", "is_private", "status"],
        as_dict=True,
    )
    if (
        not row
        or row.status != "Ready"
        or not row.is_private
        or row.file_size != int(node.size or 0)
        or row.mime_type != node.mime
    ):
        frappe.throw(_("The existing Drive file head is inconsistent"), frappe.ValidationError)


def _preserve_head(node: frappe._dict, principals: Principals) -> int:
    seq = frappe.db.sql(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM `tabDrive Node Version` WHERE node = %s",
        node.name,
    )[0][0]
    frappe.get_doc(
        {
            "doctype": "Drive Node Version",
            "node": node.name,
            "seq": seq,
            "kind": "auto",
            "actor": principals.user,
            "size": node.size,
            "blob": node.blob,
        }
    ).insert(ignore_permissions=True)
    return seq


def _content_time(value: datetime | int | float | str | None) -> datetime:
    if value is None:
        return now_datetime()
    if isinstance(value, bool):
        frappe.throw(_("Drive content time is invalid"), frappe.ValidationError)
    try:
        if isinstance(value, int | float):
            if value < 0:
                raise ValueError
            stamp = datetime.fromtimestamp(value / 1000, tz=UTC)
            return convert_utc_to_system_timezone(stamp).replace(tzinfo=None)
        parsed = get_datetime(value)
        if parsed is None:
            raise ValueError
        return parsed
    except (OverflowError, OSError, TypeError, ValueError):
        frappe.throw(_("Drive content time is invalid"), frappe.ValidationError)


def _record_activity(
    node: str,
    action: str,
    principals: Principals,
    detail: dict,
    *,
    via_link: str | None,
    at: datetime | None = None,
) -> None:
    frappe.get_doc(
        {
            "doctype": "Drive Activity",
            "node": node,
            "action": action,
            "actor": principals.user,
            "at": at or now_datetime(),
            "via_link": via_link,
            "detail": detail,
        }
    ).insert(ignore_permissions=True)


def children(
    principals: Principals,
    parent: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
    order_by: str = "title",
    ascending: bool = True,
    mime_prefix: str | None = None,
) -> dict:
    """Return one three-query SQL window of readable, ordinary children."""
    page_size = _page_size(limit)
    offset = decode_cursor(cursor)
    order_column = _order_column(order_by)
    direction = "ASC" if ascending else "DESC"
    query = _folder_page_query(order_column, direction)
    result = frappe.db.sql(
        query,
        {"parent": parent, "limit": page_size, "offset": offset},
        as_dict=True,
    )
    return _folder_page_from_result(
        result,
        principals,
        parent,
        offset=offset,
        page_size=page_size,
        mime_prefix=mime_prefix,
    )


def _folder_page_query(order_column: str = "title", direction: str = "ASC") -> str:
    return FOLDER_PAGE_SQL.format(
        parent_fields=", ".join(f"parent_node.`{field}` AS `{field}`" for field in NODE_FIELD_NAMES),
        child_fields=", ".join(f"children.`{field}`" for field in NODE_FIELD_NAMES),
        node_fields=NODE_FIELDS,
        order_by=order_column,
        direction=direction,
    )


def _folder_page_from_result(
    result: list,
    principals: Principals,
    parent: str,
    *,
    offset: int,
    page_size: int,
    mime_prefix: str | None,
) -> dict:
    parent_row = None
    window = []
    for row in result:
        document_descendant = row.pop("_drive_document_descendant", 0)
        if row.pop("_drive_parent", 0):
            window.append(row)
        else:
            parent_row = row
            parent_row._drive_document_descendant = document_descendant
    if not parent_row:
        raise DriveNotFound(_("Drive node {0} was not found").format(parent))

    chain = chain_ids(parent_row)
    chain_rows = _grant_rows(chain, principals)
    child_ids = [row.name for row in window]
    own_rows = _grant_rows(child_ids, principals)
    by_child = collections.defaultdict(list)
    for row in own_rows:
        by_child[row.node].append(row)
    roles = effective_roles(chain, {row.name: by_child[row.name] for row in window}, chain_rows, principals)

    require_from_rows(parent_row, READ, principals, chain_rows)
    if parent_row.kind == "document" or parent_row.pop("_drive_document_descendant", 0):
        raise DriveConflict(_("A content document cannot be listed as a folder"))

    rows = [
        row
        for row in window
        if roles[row.name] >= READ and (not mime_prefix or (row.mime or "").startswith(mime_prefix))
    ]
    return _page(rows, offset, len(window), page_size)


def views(
    principals: Principals,
    name: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
    **filters,
) -> dict:
    """Return one SQL window of a frozen Drive discovery view."""
    page_size = _page_size(limit)
    offset = decode_cursor(cursor)
    values = {"limit": page_size, "offset": offset, "now": now(), "own": _sql_values(principals.own)}

    if name == "shared":
        values["personal_root"] = personal_root_for(principals.user)
        window = frappe.db.sql(SHARED_SQL, values, as_dict=True)
        rows = _readable_rows(window, principals)
    elif name == "archived-roots":
        query = ADMIN_ARCHIVED_SQL if principals.is_admin else ARCHIVED_SQL
        window = frappe.db.sql(query, values, as_dict=True)
        rows = window if principals.is_admin else _readable_archived_roots(window, principals, values)
    elif name == "trash":
        root = filters.get("root")
        if not isinstance(root, str) or not root:
            frappe.throw(_("The trash view requires a Drive root"), frappe.ValidationError)
        values["root"] = root
        window = frappe.db.sql(TRASH_SQL, values, as_dict=True)
        rows = _readable_rows(window, principals)
    elif name == "templates":
        content_doctype = filters.get("content_doctype")
        if content_doctype is not None and not isinstance(content_doctype, str):
            frappe.throw(_("The template content type is invalid"), frappe.ValidationError)
        values["content_doctype"] = content_doctype
        window = frappe.db.sql(TEMPLATES_SQL, values, as_dict=True)
        rows = _readable_rows(window, principals)
    elif name == "search":
        term = filters.get("term")
        if not isinstance(term, str) or not term:
            frappe.throw(_("The search term is required"), frappe.ValidationError)
        values["visible_roots"] = _sql_values(_visible_root_ids(principals))
        values["term"] = f"%{term}%"
        window = frappe.db.sql(SEARCH_SQL, values, as_dict=True)
        rows = _readable_rows(window, principals)
    else:
        frappe.throw(_("Drive view {0} is not supported").format(name), frappe.ValidationError)

    return _page(rows, offset, len(window), page_size)


def encode_cursor(offset: int) -> str:
    return base64.b64encode(f"offset:{offset}".encode()).decode()


def decode_cursor(cursor: str | None) -> int:
    if cursor is None:
        return 0
    if not isinstance(cursor, str):
        frappe.throw(_("The Drive cursor is invalid"), frappe.ValidationError)
    try:
        value = base64.b64decode(cursor, validate=True).decode()
        prefix, raw_offset = value.split(":", 1)
        offset = int(raw_offset)
        if prefix != "offset" or offset < 0 or str(offset) != raw_offset:
            raise ValueError
    except (binascii.Error, UnicodeDecodeError, ValueError):
        frappe.throw(_("The Drive cursor is invalid"), frappe.ValidationError)
    return offset


def _page(rows: list, offset: int, window_size: int, limit: int) -> dict:
    next_cursor = encode_cursor(offset + window_size) if window_size == limit else None
    return {"rows": rows, "next_cursor": next_cursor}


def _page_size(limit: int) -> int:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        frappe.throw(_("The Drive page size is invalid"), frappe.ValidationError)
    return min(limit, MAX_PAGE_SIZE)


def _order_column(order_by: str) -> str:
    columns = {
        "title": "title",
        "content_modified": "content_modified",
        "modified": "modified",
        "size": "size",
    }
    if order_by not in columns:
        frappe.throw(_("The Drive listing order is invalid"), frappe.ValidationError)
    return columns[order_by]


def _grant_rows(node_ids: list[str], principals: Principals) -> list:
    return frappe.db.sql(
        POINT_SQL,
        {
            "chain": _sql_values(node_ids),
            "principals": _sql_values(principals.all()),
            "now": now(),
        },
        as_dict=True,
    )


def _readable_rows(rows: list, principals: Principals) -> list:
    if principals.is_admin:
        return rows
    chains = {row.name: chain_ids(row) for row in rows}
    union = {node_id for chain in chains.values() for node_id in chain}
    grant_rows = _grant_rows(list(union), principals)
    by_node = collections.defaultdict(list)
    for grant_row in grant_rows:
        by_node[grant_row.node].append(grant_row)

    visible = []
    ticket_results = {}
    for row in rows:
        chain = chains[row.name]
        depth = {node_id: index for index, node_id in enumerate(chain)}
        candidate_rows = [grant_row for node_id in chain for grant_row in by_node[node_id]]
        if (
            _resolve_rows(
                candidate_rows,
                depth,
                principals,
                ticket_results=ticket_results,
            )
            >= READ
        ):
            visible.append(row)
    return visible


def _readable_archived_roots(rows: list, principals: Principals, values: dict) -> list:
    if not rows:
        return []
    candidates = frappe.db.sql(
        ARCHIVED_CANDIDATES_SQL,
        {
            "roots": tuple(row.root for row in rows),
            "own": values["own"],
            "now": values["now"],
        },
        as_dict=True,
    )
    readable = _readable_rows(candidates, principals)
    accessible_roots = {row.name if row.kind == "root" else row.root for row in readable}
    return [row for row in rows if row.root in accessible_roots]


def _visible_root_ids(principals: Principals) -> list[str]:
    if principals.is_admin:
        return frappe.get_all("Drive Root", pluck="name")
    return frappe.db.sql(
        VISIBLE_ROOTS_SQL,
        {
            "user": principals.user,
            "own": _sql_values(principals.own),
            "now": now(),
        },
        pluck=True,
    )


def _sql_values(values) -> tuple:
    values = tuple(values)
    return values or ("__drive_no_match__",)
