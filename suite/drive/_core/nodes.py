"""Permission-filtered Drive node listings and discovery views."""

import base64
import binascii
import collections

import frappe
from frappe import _
from frappe.utils import now

from suite.drive._core.access import (
    POINT_SQL,
    _resolve_rows,
    chain_ids,
    effective_roles,
    require_from_rows,
)
from suite.drive._core.errors import DriveConflict, DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import READ
from suite.drive._core.roots import personal_root_for

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
        parent_fields=", ".join(
            f"parent_node.`{field}` AS `{field}`" for field in NODE_FIELD_NAMES
        ),
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
    accessible_roots = {
        row.name if row.kind == "root" else row.root
        for row in readable
    }
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
