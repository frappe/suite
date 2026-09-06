"""URL path to `Drive Node` resolution, and the WebDAV naming policy.

The DAV namespace has one mount: the caller's own Personal Root, at `/dav/`
itself (§12). There is no `Everyone` mount, no `Shared with me` collection,
and no admin mount of somebody else's root; content shared from elsewhere is
not reachable over this protocol.

Below the mount the tree is walked one indexed point query per segment on the
frozen `node_parent_page (parent, state, title)` index: exact (BINARY) match
first, one case-insensitive fallback when it is unambiguous, oldest row winning
an exact duplicate. Resolution answers about existence and shape only; the
READ check belongs to the caller, which is what keeps an unreadable node a 404
rather than a 403 (§12.1).
"""

from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urlsplit

import frappe
from werkzeug.wrappers import Request

from suite.drive._core.nodes import NODE_FIELDS
from suite.drive._core.roots import personal_root_for
from suite.drive.webdav import DAV_PREFIX
from suite.drive.webdav.context import validate_segments
from suite.drive.webdav.errors import BadGateway, BadRequest, Forbidden

MAX_NAME_LENGTH = 140

# The kinds WebDAV can represent, and the whole of §12.2's hiding rule.
#
# A `document` node is a Writer document, a deck, or a sheet. All three are
# hidden in this release, and hiding them here hides their child media too:
# the media hang below the document, so the document segment 404s before the
# walk can reach them [012 §1]. The test is the node's kind, never the title's
# extension, so an uploaded .docx stays an ordinary visible file, and never the
# content registry, which is still dormant.
#
# A `link` node is a bookmark holding a URL and no bytes. The legacy adapter
# hid it and this keeps that: shown, it would sync as an empty file and the
# client's write-back would turn the bookmark into one.
VISIBLE_KINDS = ("folder", "file")

_VISIBLE = "state = 'Active' AND kind IN ('folder', 'file') AND is_template = 0"


@dataclass
class ResolvedPath:
    segments: list[str] = field(default_factory=list)  # decoded, below /dav
    node: frappe._dict | None = None  # the leaf row (the root node when is_mount)
    parent: frappe._dict | None = None  # the parent row when only the leaf is missing
    missing_intermediate: bool = False
    is_mount: bool = False

    @property
    def exists(self) -> bool:
        return self.node is not None

    @property
    def is_collection(self) -> bool:
        return bool(self.node is not None and self.node.kind in ("root", "folder"))

    @property
    def entity(self) -> frappe._dict | None:
        """The leaf row under its pre-relink name, for the verbs ticket 25 owns."""
        return self.node


def resolve(segments: list[str], user: str) -> ResolvedPath:
    """Walk one DAV path inside the caller's Personal Root.

    A user with no Active Personal Root has no mount at all, so every path
    under `/dav/` is unmapped for them rather than an error naming a root they
    do not have.
    """
    root_id = personal_root_for(user)
    if not root_id:
        return ResolvedPath(segments=list(segments), missing_intermediate=bool(segments))

    root_row = _fetch(root_id)
    if root_row is None:
        return ResolvedPath(segments=list(segments), missing_intermediate=bool(segments))
    if not segments:
        return ResolvedPath(segments=[], node=root_row, is_mount=True)

    current = root_row
    for segment in segments[:-1]:
        current = _child(current.name, segment)
        if current is None or current.kind != "folder":
            return ResolvedPath(segments=list(segments), missing_intermediate=True)

    leaf = _child(current.name, segments[-1])
    return ResolvedPath(segments=list(segments), node=leaf, parent=current)


def addressable(row: frappe._dict) -> bool:
    """Whether a listed row can be named by a URL under this mount.

    A title holding a path separator, or one of the relative names, has no
    spelling in a DAV URL: the client would build a href the server could not
    parse back to this row. Drive itself accepts such titles, so a listing
    drops them rather than publishing something unreachable.
    """
    title = row.get("title") or ""
    return bool(
        title
        and title not in (".", "..")
        and "/" not in title
        and "\\" not in title
        and not any(ord(character) < 0x20 for character in title)
    )


def visible(row: frappe._dict) -> bool:
    """Whether a node is reachable over DAV at all (§12.2).

    The same test `_VISIBLE` makes in SQL, so a row filtered here and a row
    filtered by a path lookup answer alike. Callers feed it rows that are
    already Active, and it checks that anyway: the day one does not, a trashed
    node must not appear in a listing.
    """
    return (
        row.get("state") == "Active"
        and row.get("kind") in VISIBLE_KINDS
        and not row.get("is_template")
        and addressable(row)
    )


def validate_dav_name(name: str, parent: frappe._dict) -> None:
    """The naming policy WebDAV enforces on create (Drive itself is laxer)."""
    if not name or len(name) > MAX_NAME_LENGTH:
        raise BadRequest(f"Name must be between 1 and {MAX_NAME_LENGTH} characters.")
    if "/" in name or "\\" in name or any(ord(c) < 0x20 for c in name) or name in (".", ".."):
        raise BadRequest("Name contains unsupported characters.")
    if name.lower() in _reserved_names(parent):
        raise Forbidden(f'The name "{name}" is reserved.')


def parse_destination(request: Request) -> tuple[list[str], bool]:
    """Decode the Destination header into path segments below /dav."""
    header = request.headers.get("Destination")
    if not header:
        raise BadRequest("Destination header is required.")

    parts = urlsplit(header)
    if parts.netloc and not _same_host(parts.netloc, request.host):
        raise BadGateway("Destination is on another host.")
    raw_path = parts.path
    if raw_path != DAV_PREFIX and not raw_path.startswith(DAV_PREFIX + "/"):
        raise BadGateway("Destination is outside the WebDAV namespace.")

    try:
        segments = [
            unquote(segment, errors="strict") for segment in raw_path[len(DAV_PREFIX) :].split("/") if segment
        ]
    except UnicodeDecodeError as e:
        raise BadRequest("Malformed Destination header.") from e
    return validate_segments(segments), raw_path.endswith("/")


def href_for(segments: list[str], is_collection: bool) -> str:
    href = DAV_PREFIX + "/" + "/".join(quote(segment, safe="") for segment in segments)
    if is_collection and not href.endswith("/"):
        href += "/"
    return href if segments else DAV_PREFIX + "/"


def fetch(name: str) -> frappe._dict | None:
    return _fetch(name)


def reset_memo() -> None:
    """Per-request memo; only long-lived contexts (tests, console) need to reset it."""
    frappe.local._webdav_path_memo = {}


def _fetch(name: str) -> frappe._dict | None:
    rows = frappe.db.sql(
        f"SELECT {NODE_FIELDS} FROM `tabDrive Node` WHERE `name` = %(name)s LIMIT 1",
        values={"name": name},
        as_dict=True,
    )
    return rows[0] if rows else None


def _child(parent_name: str, segment: str) -> frappe._dict | None:
    memo = getattr(frappe.local, "_webdav_path_memo", None)
    if memo is None:
        memo = frappe.local._webdav_path_memo = {}
    key = (parent_name, segment)
    if key in memo:
        return memo[key]

    base = f"SELECT {NODE_FIELDS} FROM `tabDrive Node` WHERE parent = %(parent)s AND {_VISIBLE}"
    values = {"parent": parent_name, "segment": segment}

    rows = frappe.db.sql(
        base + " AND title = BINARY %(segment)s ORDER BY creation ASC LIMIT 1",
        values=values,
        as_dict=True,
    )
    if not rows:
        # tolerate case-sloppy clients, but only when unambiguous
        rows = frappe.db.sql(
            base + " AND title = %(segment)s ORDER BY creation ASC LIMIT 2",
            values=values,
            as_dict=True,
        )
        if len(rows) != 1:
            rows = []

    memo[key] = rows[0] if rows else None
    return memo[key]


def _reserved_names(parent: frappe._dict) -> set[str]:
    """Names a client may not create.

    The legacy list named the on-disk layout - `.trash`, `.uploads`, the
    thumbnail prefix - which the node tree no longer has: a blob is addressed
    by its content and no title maps to a storage location (§3.1). What is left
    is the embed folder name, kept because a client that writes one would be
    naming a place Drive means to own.
    """
    return {".embeds"}


def _same_host(destination: str, request_host: str) -> bool:
    """Hostnames must match; ports only when both sides state a non-default
    one - a proxy rewriting Host with nginx's $host drops the port, which
    must not fail every MOVE/COPY on a non-standard port."""
    try:
        dest, req = urlsplit("//" + destination), urlsplit("//" + request_host)
        ports = {port for port in (dest.port, req.port) if port not in (None, 80, 443)}
    except ValueError:
        return False
    return bool(dest.hostname) and dest.hostname == req.hostname and len(ports) <= 1
