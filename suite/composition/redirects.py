"""Send old page URLs to their new routes (unified frontend spec §14.3).

One table, one row per old path. `handle_before_request` applies it to every
cold load, email link and bookmark, so an old Drive, Writer, Sheets or Slides
URL keeps working after the old pages are gone.

Rules:

- A pattern segment `:name` matches exactly one path segment. Rows of the
  request's own length match first, exact rows before parameter rows. So
  `/sheets/new` matches its own row, never `/sheets/:docname`.
- Every row accepts one optional trailing `/<slug>` and a trailing `/`, and
  drops both. A slug is tried only when no row matches the whole path.
- The query string passes through unchanged. A target with its own query
  keeps it; the old query's other keys follow, and the target's keys win.
- A row with a `lookup` reads the node at request time, and redirects only
  when the caller may READ it. A node that does not exist and one the caller
  may not read both fall through to normal routing, so the answer never says
  which, and never shows a node id the caller could not already open.
- A path whose raw form holds an encoded `/` or `\\` falls through. Werkzeug
  decodes `%2F` into the path, so `view%2Fsecret` would otherwise match as two
  segments.
- A row with neither `new` nor `lookup` is a stop: the path stays where it
  is, and no shorter row may swallow it as a slug.
- Every redirect is a 302, never a 301. Browsers cache a 301 forever, and it
  would hide any later page at an old path.
- A redirect never creates a document.

`frontend/src/composition/redirects.json` is the client copy of this table,
for old links clicked inside the app. `write_client_table` regenerates it.
For a row with a lookup, the client does a full page load, so the server does
the read.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote_plus

import frappe
from werkzeug.exceptions import HTTPException
from werkzeug.utils import redirect

from suite import drive

CLIENT_TABLE = Path(__file__).resolve().parents[2] / "frontend/src/composition/redirects.json"

# How a row finds its target when the path alone does not say it:
# - `node`: the node's address by kind, from `drive.node_url`;
# - `legacy`: a pre-migration Drive id, through `drive.legacy_node`;
# - `sheet`, `presentation`: the product document's `node` field.
Lookup = Literal["node", "legacy", "sheet", "presentation"]


@dataclass(frozen=True)
class Row:
    old: str
    new: str | None = None
    lookup: Lookup | None = None

    @cached_property
    def segments(self) -> tuple[str, ...]:
        return tuple(self.old.strip("/").split("/"))

    @cached_property
    def exact(self) -> bool:
        return not any(segment.startswith(":") for segment in self.segments)


ROWS: tuple[Row, ...] = (
    # Old Drive listings. The Attachments view has no successor.
    Row("/drive/inbox", "/drive"),
    Row("/drive/attachments", "/drive"),
    Row("/drive/attachments/:doctype", "/drive"),
    Row("/drive/attachments/:doctype/:docname", "/drive"),
    # Old per-type lists go to Recent, filtered by type.
    Row("/drive/documents", "/drive/recent?type=document"),
    Row("/drive/presentations", "/drive/recent?type=presentation"),
    Row("/writer", "/drive/recent?type=document"),
    Row("/sheets", "/drive/recent?type=spreadsheet"),
    Row("/slides", "/drive/recent?type=presentation"),
    # Old saved views.
    Row("/drive/recents", "/drive/recent"),
    Row("/drive/favourites", "/drive/starred"),
    Row("/drive/shared", "/drive/shared-with-me"),
    Row("/sheets/trash", "/drive/trash"),
    # Old node addresses. An old `/drive/f/<id>` meant a file; it needs no row,
    # because the new folder route sends a non-folder id to `/d/<id>`.
    Row("/drive/d/:id", "/drive/f/:id"),
    Row("/drive/w/:id", "/d/:id"),
    Row("/writer/w/:id", "/d/:id"),
    Row("/drive/g/:id", lookup="node"),
    Row("/drive/t/:team/:letter/:id", lookup="node"),
    Row("/drive/folder/:id", lookup="legacy"),
    Row("/drive/document/:id", lookup="legacy"),
    Row("/drive/file/:id", lookup="legacy"),
    Row("/drive/t/:team", lookup="legacy"),
    Row("/drive/l/:token", "/l/:token"),
    # Old document pages, by the product document's node.
    Row("/sheets/:docname", lookup="sheet"),
    Row("/slides/presentation/:docname", lookup="presentation"),
    Row("/slides/presentation/view/:docname", lookup="presentation"),
    Row("/slides/slideshow/:docname", lookup="presentation"),
    # Old utility pages go to Home, whose New menu and Recent cover them.
    Row("/sheets/new", "/home"),
    Row("/slides/presentation/new", "/home"),
    Row("/slides/not-permitted", "/home"),
    Row("/suite", "/home"),
    # The PWA start path (spec §14.9).
    Row("/suite/start", "/home"),
    # Stops: these stay, and `/suite` must not take them as a slug.
    Row("/suite/setup"),
    Row("/suite/load-error"),
)

# The first path segment of every row. Any other request leaves on one set
# lookup, before the table is read.
PREFIXES = frozenset(row.segments[0] for row in ROWS)


def _by_length(rows: tuple[Row, ...]) -> dict[int, tuple[Row, ...]]:
    table: dict[int, list[Row]] = {}
    for row in sorted(rows, key=lambda row: not row.exact):
        table.setdefault(len(row.segments), []).append(row)
    return {length: tuple(rows) for length, rows in table.items()}


_ROWS_BY_LENGTH = _by_length(ROWS)


def handle_before_request() -> None:
    """Answer 302 for an old page URL."""
    request = getattr(frappe.local, "request", None)
    if request is None or request.method not in ("GET", "HEAD"):
        return
    path = request.path
    if path[1:].split("/", 1)[0] not in PREFIXES:
        return
    if _has_encoded_separator(request.environ):
        return
    address = resolve(path, request.query_string.decode("latin-1"))
    if address is not None:
        raise HTTPException(response=redirect(address, code=302))


# Every WSGI server this app runs on (werkzeug, gunicorn) passes the undecoded
# request target in one of these.
RAW_PATH_KEYS = ("RAW_URI", "REQUEST_URI")
ENCODED_SEPARATORS = ("%2f", "%5c", "\\")


def _has_encoded_separator(environ) -> bool:
    raw = next((environ[key] for key in RAW_PATH_KEYS if environ.get(key)), "")
    raw_path = raw.split("?", 1)[0].lower()
    return any(separator in raw_path for separator in ENCODED_SEPARATORS)


def resolve(path: str, query: str = "") -> str | None:
    """Answer the new address for an old `path`, or None to fall through."""
    segments = path.strip("/").split("/")
    for candidate in (segments, segments[:-1]):
        for row in _ROWS_BY_LENGTH.get(len(candidate), ()) if candidate else ():
            params = _match(row, candidate)
            if params is not None:
                address = _target(row, params)
                return None if address is None else _with_query(address, query)
    return None


def _match(row: Row, segments: list[str]) -> dict[str, str] | None:
    params: dict[str, str] = {}
    for pattern, segment in zip(row.segments, segments, strict=True):
        if pattern.startswith(":"):
            if not segment:
                return None
            params[pattern[1:]] = segment
        elif pattern != segment:
            return None
    return params


def _target(row: Row, params: dict[str, str]) -> str | None:
    if row.lookup is not None:
        # every lookup row reads its last parameter
        return LOOKUPS[row.lookup](params[row.segments[-1][1:]])
    if row.new is None:
        return None
    return "/".join(
        quote(params[segment[1:]], safe="") if segment.startswith(":") else segment
        for segment in row.new.split("/")
    )


def _with_query(address: str, query: str) -> str:
    if not query:
        return address
    base, _, own = address.partition("?")
    if not own:
        return f"{address}?{query}"
    own_keys = {_key(pair) for pair in own.split("&")}
    carried = [pair for pair in query.split("&") if pair and _key(pair) not in own_keys]
    return f"{base}?{'&'.join([own, *carried])}"


def _key(pair: str) -> str:
    return unquote_plus(pair.split("=", 1)[0])


def _readable(node: str | None) -> bool:
    """Whether the caller may READ `node`. A missing node answers False too."""
    if not node:
        return False
    try:
        drive.check(node, drive.READ)
    except drive.DriveError:
        return False
    return True


def _node_address(node: str | None) -> str | None:
    if not _readable(node):
        return None
    try:
        return drive.node_url(node)
    except drive.DriveNotFound:
        return None


def _document_address(doctype: str, docname: str) -> str | None:
    # Drive's grants govern a Sheet or a Presentation, so READ on its node is
    # the product's own read check. The document always opens in the document
    # host, so its kind needs no read.
    node = frappe.db.get_value(doctype, docname, "node")
    return f"/d/{quote(node, safe='')}" if _readable(node) else None


LOOKUPS: dict[Lookup, Callable[[str], str | None]] = {
    "node": _node_address,
    "legacy": lambda old_id: _node_address(drive.legacy_node(old_id)),
    "sheet": lambda docname: _document_address("Sheet", docname),
    "presentation": lambda docname: _document_address("Presentation", docname),
}


def client_table() -> dict:
    """The table as the client guard reads it."""
    return {"rows": [{"old": row.old, "new": row.new, "lookup": row.lookup} for row in ROWS]}


def write_client_table() -> str:
    """Write the committed client copy. `bench execute` this after a row changes."""
    CLIENT_TABLE.write_text(json.dumps(client_table(), indent=2) + "\n")
    return str(CLIENT_TABLE)
