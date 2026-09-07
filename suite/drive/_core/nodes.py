"""Permission-filtered Drive node listings and discovery views."""

import base64
import binascii
import collections
import io
import os
import time
from datetime import UTC, datetime
from typing import IO
from uuid import uuid4

import frappe
from frappe import _
from frappe.storage.blob import revive_blob
from frappe.storage.driver import get_driver
from frappe.storage.url import signed_url_for_blob
from frappe.utils import convert_utc_to_system_timezone, get_datetime, now, now_datetime

from suite.drive._core import activity, content, previews
from suite.drive._core.access import (
    POINT_SQL,
    _resolve_rows,
    add_creator_grant,
    chain_ids,
    chain_roles,
    check,
    describe_page,
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
# The furthest a cursor may seek. Offset paging past this is not a page a
# client reached by walking; it is a forged cursor (§11.4).
MAX_PAGE_OFFSET = 10_000_000

# §6.8 signs previews and media for fifteen minutes. A file download is the
# same kind of grant: short enough that a leaked URL dies before it travels.
CONTENT_TTL_SECONDS = 15 * 60

# sha256 of zero bytes. §8.5 keeps a head of size 0 without a blob, and a
# validator for those bytes is still the checksum they would have.
EMPTY_BLOB_CHECKSUM = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

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
# The same projection qualified for a joined query. §11.3 makes a list row and
# a detail fetch the same shape, so a view that selected a subset published a
# node whose `state`, `url`, or `creation` was silently null.
NODE_FIELDS_N = ", ".join(f"n.`{field}`" for field in NODE_FIELD_NAMES)

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
        ORDER BY {inner_order} {direction}
        LIMIT %(limit)s OFFSET %(offset)s
    ) children
) page
ORDER BY page._drive_parent, {outer_order} {direction}
"""

SHARED_SQL = """
SELECT DISTINCT {node_fields}
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
""".format(node_fields=NODE_FIELDS_N)

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
SELECT {node_fields}
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
""".format(node_fields=NODE_FIELDS_N)

TEMPLATES_SQL = """
SELECT {node_fields}
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
""".format(node_fields=NODE_FIELDS_N)

SEARCH_SQL = """
SELECT {node_fields}
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
""".format(node_fields=NODE_FIELDS_N)

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


CLIENT_CREATE_KINDS = ("folder", "file", "link", "document")


def get(principals: Principals, node: str) -> frappe._dict:
    """Return one node's stored row after a single READ point check (§8.1)."""
    row = _node(node)
    require(row, READ, principals)
    return row


def stored(node: str) -> frappe._dict:
    """Return one node's row with no check, for a caller that just wrote it.

    A create authorizes the parent, not the node it made, and §4.5 writes no
    creator grant when the right came from a link: an uploader working through
    an UPLOAD link can create a node they cannot read. An adapter that owes the
    caller the node shape reads it here. It is never a substitute for `get`.
    """
    return _node(node)


def create(
    principals: Principals,
    parent: str,
    title: str,
    *,
    kind: str,
    blob: str | None = None,
    size: int | None = None,
    mime: str | None = None,
    content_modified: datetime | int | float | str | None = None,
    url: str | None = None,
    content_doctype: str | None = None,
    from_node: str | None = None,
    is_template: bool = False,
) -> str:
    """Create one node of every kind a client may create, and return its id.

    §8.3's create shapes plus §10.1's import, behind one authorized entry so
    an adapter never chooses a workflow from an unauthorized read.

    A file names a stored blob, and the caller's `size` and `mime` are proof
    obligations, not data: `create_file` re-reads the blob row, refuses unless
    the declared pair matches it exactly, writes the node from the stored
    values, and charges the root the stored size. What the client says can
    therefore fail the create, and can never change what is written or billed.
    """
    if kind not in CLIENT_CREATE_KINDS:
        frappe.throw(_("Drive node kind {0} cannot be created").format(kind), frappe.ValidationError)

    if kind != "file":
        _refuse_create_extras(blob=blob, size=size, mime=mime, content_modified=content_modified)
    if kind == "folder":
        _refuse_create_extras(url=url, content_doctype=content_doctype, from_node=from_node)
        return create_folder(principals, parent, title)
    if kind == "file":
        _refuse_create_extras(url=url, content_doctype=content_doctype, from_node=from_node)
        if blob is None or size is None or mime is None:
            frappe.throw(
                _("A Drive file requires blob, size, and MIME type"),
                frappe.ValidationError,
            )
        return create_file(
            principals,
            parent,
            title,
            blob=blob,
            size=size,
            mime=mime,
            content_modified=content_modified,
        )
    if kind == "link":
        _refuse_create_extras(content_doctype=content_doctype, from_node=from_node)
        if not isinstance(url, str) or not url.strip():
            frappe.throw(_("A Drive link requires a URL"), frappe.ValidationError)
        return create_link(principals, parent, title, url=url)

    _refuse_create_extras(url=url)
    if not isinstance(content_doctype, str) or not content_doctype.strip():
        frappe.throw(_("A Drive document requires a content type"), frappe.ValidationError)
    if from_node is not None and _authorized_source_kind(principals, from_node) == "file":
        if is_template:
            frappe.throw(_("An imported Drive document cannot be a template"), frappe.ValidationError)
        return import_document(
            principals,
            parent,
            title,
            content_doctype=content_doctype,
            from_node=from_node,
        )
    return create_document(
        principals,
        parent,
        title,
        content_doctype=content_doctype,
        from_node=from_node,
        is_template=is_template,
    )


def _refuse_create_extras(**arguments) -> None:
    named = sorted(name for name, value in arguments.items() if value is not None)
    if named:
        frappe.throw(
            _("A Drive create of this kind does not take {0}").format(", ".join(named)),
            frappe.ValidationError,
        )


def _authorized_source_kind(principals: Principals, from_node: str) -> str:
    """Read one create source's kind only after the caller proves READ on it."""
    source = _node(from_node)
    require(source, READ, principals)
    return source.kind


def breadcrumbs(row: frappe._dict, principals: Principals) -> list[dict]:
    """Return §11.3's trail from the highest visible ancestor down to the parent.

    The chain above a shared folder is not the caller's to see: §5.2 hides an
    unreadable node behind 404 on every surface, and a title is content. The
    trail therefore restarts below the deepest ancestor the caller cannot read,
    which for a caller reading from their own root is the whole chain.
    """
    chain = chain_ids(row)[:-1]
    if not chain:
        return []
    roles = chain_roles(row, principals)
    titles = {
        ancestor.name: ancestor.title
        for ancestor in frappe.get_all(
            "Drive Node",
            filters={"name": ["in", chain]},
            fields=["name", "title"],
        )
    }
    trail: list[dict] = []
    for node_id in chain:
        if roles.get(node_id, 0) < READ or node_id not in titles:
            trail = []
            continue
        trail.append({"name": node_id, "title": titles[node_id]})
    return trail


def content_url(principals: Principals, node: str, *, expires_in: int = CONTENT_TTL_SECONDS) -> dict:
    """Mint one readable file node's signed `/f/` URL after a READ check (§6.8).

    Every byte that leaves Drive by URL leaves through here or through the
    preview and media expansions, and all three check first. The signature
    names the blob and the filename, so a minted URL cannot be widened into
    another node's bytes.
    """
    row = _node(node)
    require(row, READ, principals)
    return signed_content_url(row, expires_in=expires_in)


def signed_content_url(row: frappe._dict, *, expires_in: int = CONTENT_TTL_SECONDS) -> dict:
    """Mint the signed URL for a file node the caller is already READ on.

    §2.3 budgets the byte path at one point check. A caller that read the row
    through `get` has spent it, so it mints from that row instead of reading
    and checking the same node again.
    """
    if row.kind != "file":
        raise DriveConflict(_("Only a Drive file has bytes to download"))
    if not row.blob:
        # §8.4's empty head: a zero-byte file has no blob to sign.
        raise DriveConflict(_("This Drive file has no stored bytes"))
    blob = frappe.db.get_value(
        "File Blob",
        row.blob,
        ["name", "file_size", "is_private", "status"],
        as_dict=True,
    )
    if not blob or blob.status != "Ready" or not blob.is_private:
        raise DriveConflict(_("The Drive file bytes are unavailable"))
    return {
        "url": signed_url_for_blob(row.blob, content.download_filename(row.title), expires_in),
        "expires": int(time.time()) + expires_in,
    }


def stream_content(row: frappe._dict, *, environ: dict | None = None, as_attachment: bool = True):
    """Stream one file node's bytes to the current request, Range and all.

    The caller has already spent §2.3's point check on `row`; this adds no
    second one, exactly as `signed_content_url` adds none. It exists beside
    that function because a signed `/f/` redirect is not usable everywhere a
    byte path is: WebDAV's Windows client drops credentials across a redirect
    (§12.3), so DAV needs the bytes on the same response.

    Conditional requests, `Range`, `206`, `416`, and the strong `ETag` are the
    framework's (§13.5). What Drive owns here is the refusal: a node with no
    bytes to send is a conflict, not an empty body, and an unreachable blob is
    never reported as a zero-length file. Drive also owns `If-Range`, because
    the framework's remote-driver path does not read it and a Range spliced
    onto a replaced blob is a silently corrupt download.
    """
    from frappe.storage.serve import stream_blob
    from werkzeug.wrappers import Response

    if row.kind != "file":
        raise DriveConflict(_("Only a Drive file has bytes to download"))
    if environ is None:
        environ = frappe.local.request.environ
    if not row.blob:
        # §8.4's empty head. A zero-byte file is a file: it answers 200 with no
        # body rather than the 409 a node that never had bytes gets. It carries
        # the same validator a listing publishes for it, so it answers 304 to a
        # client holding that validator like any other file.
        answer = Response(b"", status=200, mimetype=row.mime or "application/octet-stream")
        answer.set_etag(EMPTY_BLOB_CHECKSUM)
        # werkzeug skips range handling, and the header with it, at length 0
        answer.headers["Accept-Ranges"] = "bytes"
        return answer.make_conditional(environ, accept_ranges=True, complete_length=0)
    try:
        blob = frappe.get_doc("File Blob", row.blob)
    except frappe.DoesNotExistError:
        raise DriveConflict(_("The Drive file bytes are unavailable")) from None
    if blob.status != "Ready" or not blob.is_private:
        raise DriveConflict(_("The Drive file bytes are unavailable"))
    return stream_blob(
        blob,
        content.download_filename(row.title),
        as_attachment=as_attachment,
        environ=_range_honouring_environ(environ, blob.checksum),
    )


def _range_honouring_environ(environ: dict, checksum: str | None) -> dict:
    """Drop `Range` when `If-Range` names a validator this blob no longer has.

    RFC 7233 §3.2: an `If-Range` that does not match means send the whole
    representation, not a slice of a different one. Only the entity-tag form is
    decided here; the date form is left to the driver path that already reads
    `Last-Modified`. A weak tag never satisfies a Range request, so it counts
    as a miss.
    """
    if "HTTP_RANGE" not in environ:
        return environ
    presented = (environ.get("HTTP_IF_RANGE") or "").strip()
    if not presented or not presented.startswith(('"', "W/")):
        return environ
    if checksum and presented == f'"{checksum}"':
        return environ
    stripped = dict(environ)
    stripped.pop("HTTP_RANGE", None)
    return stripped


def blob_checksums(blobs: list[str]) -> dict[str, str]:
    """Answer the content checksum of many blobs in one read.

    A listing that publishes a validator for every row needs the checksums of
    the whole page, and `Drive Node` does not carry one: the checksum belongs
    to the blob, which two nodes may share. One `IN` read keeps a page's cost
    flat in the number of rows.
    """
    wanted = sorted({blob for blob in blobs if blob})
    if not wanted:
        return {}
    rows = frappe.get_all(
        "File Blob",
        filters={"name": ("in", wanted)},
        fields=["name", "checksum"],
    )
    return {row.name: row.checksum for row in rows if row.checksum}


def title_taken(principals: Principals, parent: str, title: str) -> bool:
    """Answer whether an active child of `parent` already carries `title`.

    The one question §11.7's legacy `does_entity_exist` asks and no §11.2 route
    answers: a folder page is by id, not by title. It is answered here rather
    than in the adapter because the answer is derived from names the caller may
    not be entitled to see, so the check that guards it is Drive policy.

    UPLOAD, not READ, and deliberately: the reply is a fact about siblings, and
    the only caller is a client naming a file it is about to write. `create`
    resolves the same parent at the same level, so a caller who may not write
    here learns nothing they could not already learn by trying.
    """
    parent_row = _node(parent)
    require(parent_row, UPLOAD, principals)
    _validate_parent(parent_row)
    if not isinstance(title, str) or not title.strip():
        frappe.throw(_("A Drive node title is required"), frappe.ValidationError)
    return bool(
        frappe.db.exists("Drive Node", {"parent": parent_row.name, "title": title, "state": "Active"})
    )


def readable_child_counts(principals: Principals, parents: list[str]) -> dict[str, int]:
    """Count each named folder's Active children that the caller may read.

    The third question §11.2 does not answer: a folder page returns rows, and a
    legacy list row carries a count of what is inside each of them. It is a
    permission answer, so it is decided here.

    Counting the rows outright reports what the caller cannot open, which is
    the leak `api/list._get_children_count` was written to close - a shared
    `Previous Teams` reporting all 512 migrated teams to someone who can open
    three. Resolving all of them instead would read every child of the page.

    Neither is needed. A child with no local grant has the same nearest
    decision its parent has, and the parent is a row the caller was already
    shown. Only a child carrying its own grant can differ, so only those are
    resolved, and only the unreadable ones are subtracted.

    The caller must have been given `parents` by an authorized listing.
    """
    if not parents:
        return {}
    counts = {
        row["parent"]: int(row["total"] or 0)
        for row in frappe.db.sql(
            """
            SELECT parent, COUNT(name) AS total
            FROM `tabDrive Node`
            WHERE parent IN %(parents)s AND state = 'Active'
            GROUP BY parent
            """,
            {"parents": _sql_values(parents)},
            as_dict=True,
        )
    }
    if principals.is_admin:
        return counts

    decided = frappe.db.sql(
        """
        SELECT DISTINCT child.name
        FROM `tabDrive Node` child
        JOIN `tabDrive Grant` grants ON grants.node = child.name
        WHERE child.parent IN %(parents)s AND child.state = 'Active'
        """,
        {"parents": _sql_values(parents)},
        pluck=True,
    )
    if not decided:
        return counts

    rows = frappe.get_all("Drive Node", filters={"name": ("in", decided)}, fields=list(NODE_FIELD_NAMES))
    readable = {row.name for row in _readable_rows(rows, principals)}
    for row in rows:
        if row.name not in readable and row.parent in counts:
            counts[row.parent] -= 1
    return counts


def available_title(principals: Principals, parent: str, title: str) -> str:
    """Answer the title `title` becomes below `parent` when a sibling holds it.

    §8.6's dedupe rule, read rather than written: the oldest keeps the plain
    title and later ones get ` (2)`, ` (3)`. The rule is stated there for the
    paths that create a node with no user in the loop, and this read is how the
    §11.7 compatibility layer keeps that promise for a legacy client that has
    no dialog to ask a new title with.

    The gate is UPLOAD, the one the retired `get_new_title` carried, and for
    its reason: the suffix counts the siblings, so it says more than
    `title_taken` does. It reads without `FOR UPDATE`, unlike
    `_deduplicated_title`, because the answer is advisory and no write follows
    it here; `create_file` still refuses a collision under its own lock.
    """
    parent_row = _node(parent)
    require(parent_row, UPLOAD, principals)
    _validate_parent(parent_row)
    if not isinstance(title, str) or not title.strip():
        frappe.throw(_("A Drive node title is required"), frappe.ValidationError)

    def taken(candidate: str) -> bool:
        return bool(
            frappe.db.exists("Drive Node", {"parent": parent_row.name, "title": candidate, "state": "Active"})
        )

    if not taken(title):
        return title
    stem, extension = os.path.splitext(title)
    suffix = 2
    while taken(f"{stem} ({suffix}){extension}"):
        suffix += 1
    return f"{stem} ({suffix}){extension}"


def create_folder(principals: Principals, parent: str, title: str) -> str:
    """Create an empty folder below an authorized active container."""
    return _create_empty_node(principals, parent, title, kind="folder")


def create_link(principals: Principals, parent: str, title: str, *, url: str) -> str:
    """Create a URL link below an authorized active container."""
    if not isinstance(url, str) or not url.strip():
        frappe.throw(_("A Drive link URL is required"), frappe.ValidationError)
    return _create_empty_node(principals, parent, title, kind="link", url=url)


def create_empty_file(principals: Principals, parent: str, title: str) -> str:
    """Create a file node with §8.5's empty head: no blob, size 0, no MIME.

    WebDAV LOCK on an unmapped URL is the caller (§12.3). RFC 4918 §7.3
    replaced lock-null resources with "create the resource, then lock it", and
    the resource a client is about to PUT into holds no bytes yet. No blob is
    stored, so nothing is charged and the framework GC has nothing to reap if
    the lock expires unused.

    A later PUT is an ordinary replace, and §8.5 keeps no version of a head of
    size 0, so the empty head leaves no trace once the bytes arrive.
    """
    return _create_empty_node(principals, parent, title, kind="file")


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
        if kind == "file":
            # §8.2's create detail for a file, with the empty head it has
            detail.update({"size": 0, "blob": None})
        _record_activity(node.name, "create", principals, detail, via_link=via_link)
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return node.name


def create_document(
    principals: Principals,
    parent: str,
    title: str,
    *,
    content_doctype: str,
    from_node: str | None = None,
    is_template: bool = False,
) -> str:
    """Create one content node and its document in a single transaction (§8.3).

    The node is inserted first with no content link, the app's factory is
    called with the node id, and only then is the reciprocal link written.
    Both sides are set once and never change. Any refusal rolls the node, the
    document, and the copied media back together, so a document with no node
    cannot exist.

    `from_node` names an ordinary document or a template of the same content
    type. There is no template verb: new-from-template is this call.
    """
    _validate_title(title)
    spec = content.spec_for(content_doctype)
    savepoint = f"drive_create_document_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        if from_node is None:
            source = None
            parent_row = _lock_create_parent(parent)
        else:
            # `copy`'s lock order, so a template and a destination never
            # deadlock, and the source body and media cannot move, be trashed,
            # or be purged between the read and the factory call.
            source_row, parent_row, source_subtree = _lock_move_rows(from_node, parent)
            _validate_subtree(source_row, source_subtree)
            source = _copyable_document_source(principals, source_row, content_doctype)
        via_link = require(parent_row, UPLOAD, principals)
        _validate_parent(parent_row, for_update=True, allow_document=False)
        _refuse_sibling_collision(parent_row.name, title)
        node = _insert_node(
            principals,
            parent_row,
            title=title,
            kind="document",
            mime=spec.mime,
            content_modified=now_datetime(),
            is_template=is_template,
        )
        docname = _content_factory(spec, node.name, source)
        _link_document(node.name, spec, docname)
        # The creator grant lands on the document before its media exist, so a
        # copied picture inherits it instead of carrying a grant of its own.
        add_creator_grant(node, parent_row, principals, via_link=via_link)
        if source is not None:
            _admit_document_media(spec, source, node.root)
            _copy_document_media(principals, spec, source, node, docname, destination_link=via_link)
            previews.copy_preview(source.name, node.name)
        _record_activity(
            node.name,
            "create",
            principals,
            {"kind": "document", "title": title, "content_doctype": content_doctype},
            via_link=via_link,
        )
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return node.name


def import_document(
    principals: Principals,
    parent: str,
    title: str,
    *,
    content_doctype: str,
    from_node: str,
) -> str:
    """Create one content document from an ordinary file's bytes (§10.1).

    `create_document` covers new, duplicate, and new-from-template. This is the
    fourth shape §10.1 names and the only one that reads a foreign body: an
    xlsx becoming a sheet. The app's `import_from_file` factory receives both
    node ids and reads the source bytes back through `read_file`, because only
    the app can parse its own format and no app may read a `Drive Node` blob.

    The source file is left exactly as it was. An import is not a move and not
    a copy: nothing is trashed, no blob is shared, and the new document's body
    is the app's own, charged by whatever the app stores.
    """
    _validate_title(title)
    spec = content.spec_for(content_doctype)
    if spec.import_from_file is None:
        raise DriveConflict(_("A {0} cannot be imported from a file").format(content_doctype))
    savepoint = f"drive_import_document_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        # `copy`'s lock order, so an import and a concurrent move of the same
        # source cannot deadlock and the source bytes cannot be replaced,
        # trashed, or purged between the check and the factory call.
        source_row, parent_row, source_subtree = _lock_move_rows(from_node, parent)
        _validate_subtree(source_row, source_subtree)
        _importable_file_source(principals, source_row)
        via_link = require(parent_row, UPLOAD, principals)
        _validate_parent(parent_row, for_update=True, allow_document=False)
        _refuse_sibling_collision(parent_row.name, title)
        node = _insert_node(
            principals,
            parent_row,
            title=title,
            kind="document",
            mime=spec.mime,
            content_modified=now_datetime(),
        )
        docname = _import_factory(spec, source_row.name, node.name)
        _link_document(node.name, spec, docname)
        add_creator_grant(node, parent_row, principals, via_link=via_link)
        _record_activity(
            node.name,
            "create",
            principals,
            {
                "kind": "document",
                "title": title,
                "content_doctype": content_doctype,
                "imported_from": source_row.name,
            },
            via_link=via_link,
        )
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return node.name


def _importable_file_source(principals: Principals, source: frappe._dict) -> None:
    """Validate the locked file row an import names.

    READ first, then state, then kind, so a caller with no grant learns that
    the id names nothing rather than what it is (§5.4).
    """
    require(source, READ, principals)
    if source.state != "Active":
        raise DriveConflict(_("A Drive import source must be an active file"))
    if source.kind != "file":
        raise DriveConflict(_("A Drive document can only be imported from a file"))
    if not source.blob:
        raise DriveConflict(_("The Drive import source has no stored bytes"))


def _import_factory(spec, file_node: str, node: str) -> str:
    """Call the app's import factory with both node ids and validate the answer."""
    docname = content.call_app(spec.import_from_file, file_node, node)
    if not isinstance(docname, str) or not docname:
        raise DriveConflict(_("The Drive content factory returned no document"))
    return docname


def read_file(principals: Principals, node: str) -> tuple[IO[bytes], str]:
    """Answer one readable file node's bytes as a stream and its mime type.

    One READ point check, then the driver's own stream. Python never holds the
    whole body: the caller reads and closes it. This is what lets a content app
    parse a foreign file it was handed by `import_document` without reaching
    into `Drive Node` or `File Blob` itself (ARCHITECTURE.md, rule 2.2).

    A trashed file still answers. §8.8 opens a trashed node read-only, and an
    import out of the bin is a read.
    """
    row = _node(node)
    require(row, READ, principals)
    if row.kind != "file":
        raise DriveConflict(_("Only a Drive file has bytes to read"))
    mime = row.mime or "application/octet-stream"
    if not row.blob:
        # §8.4's empty head. A zero-byte file is a file, not a missing one.
        return io.BytesIO(b""), mime
    blob = frappe.db.get_value(
        "File Blob",
        row.blob,
        ["name", "key", "file_size", "driver", "is_private", "status"],
        as_dict=True,
    )
    if not blob or blob.status != "Ready" or not blob.is_private:
        raise DriveConflict(_("The Drive file bytes are unavailable"))
    if int(blob.file_size or 0) != int(row.size or 0):
        raise DriveConflict(_("The Drive file bytes are inconsistent"))
    return get_driver(blob.driver).read(blob.key, is_private=bool(blob.is_private)), mime


def _copyable_document_source(
    principals: Principals,
    source: frappe._dict,
    content_doctype: str,
) -> frappe._dict:
    """Validate the locked source row a new-from-template create names."""
    require(source, READ, principals)
    if source.kind != "document" or source.state != "Active":
        raise DriveConflict(_("A Drive document can only be created from a content document"))
    if source.content_doctype != content_doctype:
        raise DriveConflict(_("A Drive document copy keeps its content type"))
    if not source.content_docname:
        raise DriveConflict(_("The Drive content document link is incomplete"))
    return source


def _content_factory(spec, node: str, source: frappe._dict | None) -> str:
    """Call the app's factory with the node id and validate the docname."""
    if source is None:
        docname = content.call_app(spec.create_empty, node)
    else:
        docname = content.call_app(spec.duplicate, source.content_docname, node)
    if not isinstance(docname, str) or not docname:
        raise DriveConflict(_("The Drive content factory returned no document"))
    return docname


def _link_document(node: str, spec, docname: str) -> None:
    """Write the reciprocal node and document link once, or refuse (§8.3).

    The node UPDATE matches only a document row that is still unlinked, so a
    second attempt changes nothing and raises. The document side is written
    only when the app left it empty; an app that already bound a different
    node is refused.
    """
    if not frappe.db.exists(spec.doctype, docname):
        raise DriveConflict(_("The Drive content factory returned no document"))
    frappe.db.sql(
        """
        UPDATE `tabDrive Node`
        SET content_doctype = %(doctype)s, content_docname = %(docname)s
        WHERE name = %(node)s
          AND kind = 'document'
          AND COALESCE(content_doctype, '') = ''
          AND COALESCE(content_docname, '') = ''
        """,
        {"doctype": spec.doctype, "docname": docname, "node": node},
    )
    if int(frappe.db.sql("SELECT ROW_COUNT()")[0][0]) != 1:
        raise DriveConflict(_("A Drive content document identity cannot change"))
    linked = frappe.db.get_value(spec.doctype, docname, spec.node_field, for_update=True)
    if linked and linked != node:
        raise DriveConflict(_("That content document already names another Drive node"))
    if not linked:
        frappe.db.set_value(spec.doctype, docname, spec.node_field, node, update_modified=False)


def _admit_document_media(spec, source: frappe._dict, root: str) -> None:
    """Charge the destination root for the media one document copy will hold."""
    charge = content.copyable_media_bytes((source.name,)) if spec.remap_media else 0
    if charge:
        admit(root, charge)


def _copy_document_media(
    principals: Principals,
    spec,
    source: frappe._dict,
    target: frappe._dict,
    target_docname: str,
    *,
    destination_link: str | None,
) -> None:
    """Copy one document's media, then let the app repoint its own references.

    An app that declares no `remap_media` gets no media copied: nodes nothing
    names would only charge the destination root and be swept in seven days.
    """
    if not spec.remap_media:
        return
    remapped = content.copy_document_media(
        principals,
        source.name,
        target,
        destination_link=destination_link,
    )
    if remapped:
        content.call_app(spec.remap_media, target_docname, remapped)


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
        if parent_row.kind == "document":
            # §8.9: inside one document, one media node per blob. Uploading the
            # same picture twice reuses the node, so a logo on twenty slides is
            # one node and one charge. The blob the caller just stored is left
            # for the framework GC; nothing here points at it.
            reused = content.reuse_media(parent_row.name, blob_row.name, for_update=True)
            if reused is not None:
                frappe.db.release_savepoint(savepoint)
                return reused
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
        previews.enqueue_render(node.name)
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
    if any(value is not None for value in (blob, size, mime)):
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

    if content_modified is not None:
        if title is not None or parent is not None or state is not None:
            frappe.throw(_("A content time cannot be set with a tree mutation"), frappe.ValidationError)
        return _stamp_content_time(principals, node, content_modified)

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


def _stamp_content_time(
    principals: Principals,
    node_id: str,
    content_modified: datetime | int | float | str | None,
) -> dict:
    """Write one node's declared content time, alone (§8.11).

    §11.2 makes `{content_modified}` a whole `PATCH /nodes/<id>` body, so the
    client that already holds the bytes can hand back the mtime the file had
    before it travelled. It is `content.touch` with the time supplied instead
    of taken: EDIT on the node, one indexed UPDATE, no head, no version, no
    charge, and no activity row (§9.4).
    """
    current = _node(node_id, for_update=True)
    require(current, EDIT, principals)
    if current.kind == "root":
        raise DriveConflict(_("A Drive root holds no content to stamp"))
    if current.state != "Active":
        raise DriveForbidden(_("A trashed Drive node cannot be stamped"))
    frappe.db.set_value(
        "Drive Node",
        current.name,
        "content_modified",
        _content_time(content_modified),
        update_modified=False,
    )
    return _node(current.name)


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
        frappe.db.delete("Drive Node Preview", {"node": current.name})
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
        previews.enqueue_render(current.name)
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
        if reparented_to is None and destination.kind == "document":
            # Media the §10.6 sweep trashed goes back to the document it came
            # from. The generic destination rules cannot describe a document
            # parent, and a bin the owner cannot restore from is not a bin.
            _validate_parent(destination, for_update=True)
        else:
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
        for source_row in source_rows:
            _validate_copy_source_row(source_row)
        _validate_move_depth(source, destination, source_rows)
        copied_title = _deduplicated_title(destination.name, title or source.title)
        destination_root = root_id(destination)
        specs = {
            row.name: content.spec_for(row.content_doctype) for row in source_rows if row.kind == "document"
        }
        media_sources = tuple(node for node, spec in specs.items() if spec.remap_media)
        admit(
            destination_root,
            sum(int(row.size or 0) for row in source_rows) + content.copyable_media_bytes(media_sources),
        )

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
            # The creator grant lands on the copied node before its media
            # exist, so a copied picture inherits it instead of carrying a
            # grant of its own, exactly as an ordinary copied child does.
            add_creator_grant(new_node, copied_parent, principals, via_link=destination_link)
            if source_row.kind == "document":
                spec = specs[source_row.name]
                docname = _content_factory(spec, new_node.name, source_row)
                _link_document(new_node.name, spec, docname)
                _copy_document_media(
                    principals,
                    spec,
                    source_row,
                    new_node,
                    docname,
                    destination_link=destination_link,
                )
            _record_activity(
                new_node.name,
                "create",
                principals,
                {"kind": new_node.kind, "title": new_node.title, "copied_from": source_row.name},
                via_link=activity_link,
            )
            previews.copy_preview(source_row.name, new_node.name)

        # one query for the whole subtree, inside the savepoint the loop runs in
        _copy_dav_properties({original: made.name for original, made in by_source.items()})
    except Exception as exc:
        # `copy` now holds both root rows, both chains, and the whole source
        # subtree while app factories run, so a deadlock is a live outcome and
        # InnoDB has already discarded this savepoint when it is.
        _rollback_savepoint(savepoint, exc)
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
    is_template: bool = False,
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
        "is_template": 1 if is_template else 0,
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
    by_name = {row.name: row for row in rows}
    included = {source.get("name")}
    copyable = []
    for row in rows:
        if row.name == source.get("name"):
            copyable.append(row)
            continue
        parent = by_name.get(row.parent)
        if row.parent not in included or not check(row, READ, principals):
            continue
        if parent is not None and parent.kind == "document":
            # Media below a content document is copied per blob by the content
            # workflow, never as an ordinary child (§8.9).
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
    # A content document is a legal source for both operations. A move keeps
    # the same node; a copy runs the app's `duplicate` factory (§8.9).


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
    elif kind == "document":
        if (
            node.get("blob")
            or size
            or node.get("url")
            or not node.get("content_doctype")
            or not node.get("content_docname")
        ):
            raise DriveConflict(_("The source Drive document shape is invalid"))
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
        content.call_app(callback, docname)
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

    callbacks = []
    for row in sorted(documents, key=lambda item: (-_depth(item), item.name)):
        if not row.content_doctype or not row.content_docname:
            raise DriveConflict(_("The Drive content document link is incomplete"))
        callbacks.append((content.spec_for(row.content_doctype).on_purge, row.content_docname))
    return callbacks


def _copy_dav_properties(pairs: dict[str, str]) -> None:
    """Clone dead WebDAV properties across a whole copied subtree (§8.9).

    Copy is the one primitive behind WebDAV COPY, and RFC 4918 §9.8.2 makes
    dead properties part of what a COPY carries. It belongs here rather than in
    the adapter because `copy` walks the subtree and only it holds the
    source-to-copy pairing for every node below the one the client named.

    `pairs` maps every source id to its copy, and the whole subtree is read in
    one query. Per-node it cost a readiness check (two `exists` calls and a
    `get_meta`) plus a `get_all` for every node, whether or not any node in the
    tree had a single dead property: about four queries per node on a table
    almost every site leaves empty.

    Guarded on the field's declared target the same way the purge cascade is
    (§3.15): on a site whose `Drive DAV Property.entity` still names `File`,
    the table is keyed in the old namespace and node ids do not belong in it.
    """
    if not pairs or not _dav_property_table_ready():
        return
    rows = frappe.get_all(
        "Drive DAV Property",
        filters={"entity": ["in", list(pairs)]},
        fields=["entity", "ns", "prop_name", "value_xml"],
    )
    for row in rows:
        frappe.get_doc(
            {
                "doctype": "Drive DAV Property",
                "entity": pairs[row.entity],
                "ns": row.ns,
                "prop_name": row.prop_name,
                "value_xml": row.value_xml,
            }
        ).insert(ignore_permissions=True)


def _dav_property_table_ready() -> bool:
    if not frappe.db.exists("DocType", "Drive DAV Property") or not frappe.db.table_exists(
        "Drive DAV Property"
    ):
        return False
    field = frappe.get_meta("Drive DAV Property").get_field("entity")
    return bool(field and field.options == "Drive Node")


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
    # Imported lazily because versions use the node loader and activity helper.
    from suite.drive._core.versions import preserve_file_head

    return preserve_file_head(node, principals)


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
            # §9.4: the adapter names its client once per request; on an
            # unnamed one (every HTTP route) this is None.
            "client": activity.current_client(),
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
    with_access: bool = False,
) -> dict:
    """Return one three-query SQL window of readable, ordinary children.

    `with_access` adds §11.3's access detail to every row from the grant rows
    this page already read, so an expanded listing costs no extra query.
    """
    page_size = page_limit(limit)
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
        with_access=with_access,
    )


def _folder_page_query(order_column: str = "title", direction: str = "ASC") -> str:
    return FOLDER_PAGE_SQL.format(
        parent_fields=", ".join(f"parent_node.`{field}` AS `{field}`" for field in NODE_FIELD_NAMES),
        child_fields=", ".join(f"children.`{field}`" for field in NODE_FIELD_NAMES),
        node_fields=NODE_FIELDS,
        inner_order=ORDER_TERMS[order_column].format(p=""),
        outer_order=ORDER_TERMS[order_column].format(p="page."),
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
    with_access: bool = False,
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
    if with_access:
        detail = describe_page(chain, {row.name: by_child[row.name] for row in rows}, chain_rows, principals)
        for row in rows:
            row.access = detail[row.name]
    page = page_of(rows, offset, len(window), page_size)
    # The listed folder, already read and authorized here. An adapter that owes
    # the caller a breadcrumb trail takes it from this row instead of spending
    # a second read and a second point check on the node it just listed.
    page["parent"] = parent_row
    return page


def views(
    principals: Principals,
    name: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
    **filters,
) -> dict:
    """Return one SQL window of a frozen Drive discovery view.

    §11.2 freezes seven names behind one address, `GET /views/<name>`, so they
    are dispatched here rather than at the adapter: the two personal lists are
    kept by `_core.activity` and answer in their own row shape, and unwrapping
    them here is what lets every view page answer in node shapes.
    """
    if name in ("recents", "favourites"):
        return _personal_view(principals, name, cursor=cursor, limit=limit)

    page_size = page_limit(limit)
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

    return page_of(rows, offset, len(window), page_size)


def _personal_view(principals: Principals, name: str, *, cursor: str | None, limit: int) -> dict:
    """Answer a personal list as node rows, keeping its own cursor."""
    from suite.drive._core import activity

    reader = activity.recents if name == "recents" else activity.favourites
    result = reader(principals, cursor=cursor, limit=limit)
    rows = _view_eligible([row.node for row in result["rows"]])
    return {"rows": rows, "next_cursor": result["next_cursor"]}


def _view_eligible(rows: list) -> list:
    """Apply §11.2's three exclusions to rows a personal list produced.

    "Every view excludes `is_template` nodes except `templates`. Root nodes
    appear only through explicit root entry points... No view returns the
    children of a document node." The five SQL views carry all three as
    predicates; `Drive Recent` and `Drive Favourite` are written by a plain
    READ check, so a starred template, a visited root, or a deck's own media
    child would otherwise arrive in a general node view through this door.
    """
    kept = [row for row in rows if row.get("kind") != "root" and not row.get("is_template")]
    if not kept:
        return kept
    ancestors = {
        ancestor for row in kept for ancestor in (row.get("path") or "").strip("/").split("/") if ancestor
    }
    documents = (
        set(
            frappe.get_all(
                "Drive Node",
                filters={"name": ("in", sorted(ancestors)), "kind": "document"},
                pluck="name",
            )
        )
        if ancestors
        else set()
    )
    if not documents:
        return kept
    return [row for row in kept if not documents.intersection((row.get("path") or "").strip("/").split("/"))]


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
        # An offset above the bound is refused rather than passed on. MariaDB
        # parses OFFSET as an unsigned bigint and fails the statement outright
        # on a larger literal, and that failure is neither a Drive refusal nor
        # anything §11.6 maps: the caller would get a 500 with a database
        # traceback where a forged cursor deserves a 400.
        if prefix != "offset" or offset < 0 or offset > MAX_PAGE_OFFSET:
            raise ValueError
        if str(offset) != raw_offset:
            raise ValueError
    except (binascii.Error, UnicodeDecodeError, ValueError):
        frappe.throw(_("The Drive cursor is invalid"), frappe.ValidationError)
    return offset


def page_of(rows: list, offset: int, window_size: int, limit: int) -> dict:
    """Wrap already-filtered rows in §11.4's page.

    `next_cursor` advances by the raw SQL window, never by the rows that
    survived the permission filter, and is null when the window came back
    short. Public inside `_core` because every listing §11.2 pages - children,
    the views, versions, activity, and the notification inbox - has to answer
    with one cursor the client never parses.
    """
    next_cursor = encode_cursor(offset + window_size) if window_size == limit else None
    return {"rows": rows, "next_cursor": next_cursor}


def page_limit(limit: int) -> int:
    """Bound one requested page size. Over the cap is clamped, not refused."""
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        frappe.throw(_("The Drive page size is invalid"), frappe.ValidationError)
    return min(limit, MAX_PAGE_SIZE)


# One ordering term per §11.4 sort column, written twice because the folder
# page sorts the inner window and the union around it. `{p}` is the table
# prefix each level needs.
#
# `content_modified` is null until something writes the content, and a null is
# not "before every time there is": it means the node has never been edited
# apart from its own row, so the row's time is the answer. Sorting the raw
# column instead clumps every never-edited node at one end of the list.
ORDER_TERMS = {
    "title": "{p}title",
    "content_modified": "COALESCE({p}content_modified, {p}modified)",
    "modified": "{p}modified",
    "size": "{p}size",
}


def _order_column(order_by: str) -> str:
    if order_by not in ORDER_TERMS:
        frappe.throw(_("The Drive listing order is invalid"), frappe.ValidationError)
    return order_by


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
