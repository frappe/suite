"""Writer's one declaration to Drive (§10.7).

Drive owns a Writer document's title, place, grants, lifecycle, versions,
comments, and byte charge. Writer owns the body: the Yjs update in `content`,
its rendered mirror in `html`, and the editor `settings`. Everything Drive
needs is the `SPEC` below, registered through the `drive_content_types` hook.

Every callable here takes and returns names, never documents, and reaches
Drive only through `from suite import drive` (ARCHITECTURE.md, rule 2.2).

## The body, and the two places a media id lives

The editor binds Tiptap's `Collaboration` extension to the Yjs root fragment
`default` (`frontend/src/apps/writer/components/TextEditor.vue`), so `content`
is one base64 Yjs update of that fragment. A picture is an element attribute
holding a Drive node id, written either as the embed URL Writer has always
produced or as a plain `data-node` attribute.

`used_nodes` and `remap_media` therefore read both `content` and `html`.
`content` is read through pycrdt, which answers the live element attributes
exactly. A raw byte scan of the update would instead match every id-shaped run
of text in it, including deleted content Yjs has not collected yet, so a
removed picture could stay charged to somebody for ever. `html` is read as
text, because the non-collaborative editor writes it alone.

## Versions

`version_bytes` writes one `writer-document/1` JSON envelope carrying both the
Yjs body and its HTML. `restore_version` reads the same envelope back. A bare
HTML payload is refused: a Yjs body cannot be rebuilt from HTML outside the
editor, so restoring one would leave the collaborative body and the rendered
HTML disagreeing. §14.6 migrates `Writer Version` rows as snapshot HTML, so
that Build (ticket 28) owes the envelope; see the ticket 17 handoffs.

## Transactions

Drive calls every callback inside its own savepoint, through
`content.app_callback()`, so none of them commits and any refusal rolls the
node, the document, and the copied media back together. A callback that
cannot honour its contract raises rather than half-writing.
"""

import base64
import binascii
import io
import json
import re

import frappe
import pycrdt
from frappe import _

from suite import drive

DOCTYPE = "Writer Document"
MIME = "frappe/writer"
NODE_FIELD = "node"

# The Yjs root fragment the editor binds to.
BODY_FRAGMENT = "default"

# `Writer Document.content`'s own default: one empty Yjs update, base64.
EMPTY_BODY = "AAA="

HTML_FORMAT = "html"
HTML_MIME = "text/html"

VERSION_SCHEMA = "writer-document/1"
VERSION_MIME = "application/json"

# A media reference inside a body is a node id carried in an attribute value.
# Both spellings are read: the embed URL Writer has always written, with and
# without the `suite.` prefix the standalone app used, and the plain node
# attribute the Drive media route uses.
MEDIA_PATTERNS = (
    re.compile(r"(?:suite\.)?writer\.api\.embed\.get\?id=([A-Za-z0-9_-]{1,140})"),
    re.compile(r"data-node=\"([A-Za-z0-9_-]{1,140})\""),
)

DEFAULT_SETTINGS = '{"collab": true}'


class UnreadableBody(frappe.ValidationError):
    """One Writer body pycrdt refused to read."""


def create_empty(node: str) -> str:
    """Insert one empty Writer document bound to `node`."""
    document = frappe.new_doc(DOCTYPE)
    document.node = node
    document.content = EMPTY_BODY
    document.html = ""
    document.settings = DEFAULT_SETTINGS
    document.collab = 1
    document.insert(ignore_permissions=True)
    return document.name


def duplicate(source_docname: str, node: str) -> str:
    """Copy one Writer body under a new node, for copy and new-from-template.

    The body, its HTML mirror, and the editor settings are carried. The
    comment blob is not: §8.9 gives a copy no history and no comments.
    """
    source = frappe.db.get_value(
        DOCTYPE, source_docname, ("content", "html", "settings", "collab"), as_dict=True
    )
    if not source:
        frappe.throw(_("The Writer document to copy was not found"), frappe.DoesNotExistError)
    document = frappe.new_doc(DOCTYPE)
    document.node = node
    document.content = source.content or EMPTY_BODY
    document.html = source.html or ""
    document.settings = source.settings or DEFAULT_SETTINGS
    document.collab = source.collab
    document.insert(ignore_permissions=True)
    return document.name


def export(docname: str, format: str) -> tuple[io.BytesIO, str]:
    """Stream one document as HTML. `default_export` is None, so DAV never asks."""
    if format != HTML_FORMAT:
        frappe.throw(_("Writer exports {0} only").format(HTML_FORMAT), frappe.ValidationError)
    html = frappe.db.get_value(DOCTYPE, docname, "html")
    if html is None and not frappe.db.exists(DOCTYPE, docname):
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)
    return io.BytesIO((html or "").encode("utf-8")), HTML_MIME


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    """Return the bytes Drive stores as one immutable version."""
    row = frappe.db.get_value(DOCTYPE, docname, ("content", "html"), as_dict=True)
    if not row:
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)
    payload = {
        "schema": VERSION_SCHEMA,
        "content": row.content or EMPTY_BODY,
        "html": row.html or "",
    }
    return io.BytesIO(json.dumps(payload).encode("utf-8")), VERSION_MIME


def restore_version(docname: str, stream) -> None:
    """Put one stored version back into the body.

    Drive has already taken a version of the current state, so this is not
    destructive. A payload that is not a `writer-document/1` envelope is
    refused rather than half-applied.
    """
    payload = _version_payload(stream.read())
    frappe.db.set_value(
        DOCTYPE,
        docname,
        {"content": payload["content"], "html": payload["html"]},
    )


def on_purge(docname: str) -> None:
    """Delete the document and the app-owned rows behind it.

    `delete_doc` runs the controller's `on_trash`, which clears the legacy
    `Writer Version` rows whose link would otherwise refuse the delete.
    """
    frappe.delete_doc(DOCTYPE, docname, force=1, ignore_permissions=True, ignore_missing=True)


def used_nodes(docname: str) -> set[str]:
    """Answer the media node ids this body still names (§10.6)."""
    row = frappe.db.get_value(DOCTYPE, docname, ("content", "html"), as_dict=True)
    if not row:
        return set()
    return _ids_in(row.html or "") | _body_ids(row.content)


def remap_media(docname: str, mapping: dict[str, str]) -> None:
    """Repoint this body at the media nodes Drive copied for it (§8.9)."""
    if not mapping:
        return
    row = frappe.db.get_value(DOCTYPE, docname, ("content", "html"), as_dict=True)
    if not row:
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)
    values = {"html": _remap_text(row.html or "", mapping)}
    body = _remap_body(row.content, mapping)
    if body is not None:
        values["content"] = body
    frappe.db.set_value(DOCTYPE, docname, values, update_modified=False)


SPEC = drive.ContentTypeSpec(
    doctype=DOCTYPE,
    mime=MIME,
    node_field=NODE_FIELD,
    # §10.7, accepted 2026-09-05: Writer stays hidden over WebDAV, and the
    # explicit HTML export stays available through the content API's format.
    default_export=None,
    export_formats=(HTML_FORMAT,),
    create_empty=create_empty,
    duplicate=duplicate,
    export=export,
    version_bytes=version_bytes,
    restore_version=restore_version,
    pushes_preview=False,
    on_purge=on_purge,
    satellites=(),
    used_nodes=used_nodes,
    remap_media=remap_media,
)


def _version_payload(raw: bytes) -> dict:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        payload = None
    if not isinstance(payload, dict) or payload.get("schema") != VERSION_SCHEMA:
        frappe.throw(
            _("This Writer version predates Drive history and cannot be restored"),
            frappe.ValidationError,
        )
    content = payload.get("content")
    html = payload.get("html")
    if not isinstance(content, str) or not content or not isinstance(html, str):
        frappe.throw(_("This Writer version cannot be read"), frappe.ValidationError)
    return {"content": content, "html": html}


def _ids_in(text: str) -> set[str]:
    return {match.group(1) for pattern in MEDIA_PATTERNS for match in pattern.finditer(text)}


def _remap_text(text: str, mapping: dict[str, str]) -> str:
    def swap(match: re.Match) -> str:
        found = match.group(1)
        replacement = mapping.get(found)
        return match.group(0) if replacement is None else match.group(0).replace(found, replacement)

    for pattern in MEDIA_PATTERNS:
        text = pattern.sub(swap, text)
    return text


def _body_ids(content: str | None) -> set[str]:
    """Read the live attributes of one Yjs body, never its tombstones."""
    raw = _decoded_body(content)
    if raw is None:
        return set()
    try:
        _, fragment = _loaded_body(raw)
    except UnreadableBody:
        # An unreadable body must never cost somebody a picture, so fall back
        # to a raw scan. It over-reports, which only keeps media alive.
        frappe.log_error("Writer: could not read a document body for the media sweep", frappe.get_traceback())
        return _ids_in(raw.decode("utf-8", "ignore"))
    found: set[str] = set()
    for element in _elements(fragment):
        for value in dict(element.attributes).values():
            if isinstance(value, str):
                found |= _ids_in(value)
    return found


def _remap_body(content: str | None, mapping: dict[str, str]) -> str | None:
    """Rewrite one Yjs body's media attributes, or answer None when there is nothing to do.

    An unreadable body raises `UnreadableBody` rather than being skipped: Drive calls this
    inside the copy's savepoint, and a copy whose pictures still point at the
    source's nodes is worse than a refused copy.
    """
    raw = _decoded_body(content)
    if raw is None:
        return None
    document, fragment = _loaded_body(raw)
    changed = False
    with document.transaction():
        for element in _elements(fragment):
            for key, value in dict(element.attributes).items():
                if not isinstance(value, str):
                    continue
                rewritten = _remap_text(value, mapping)
                if rewritten != value:
                    element.attributes[key] = rewritten
                    changed = True
    if not changed:
        return None
    return base64.b64encode(document.get_update()).decode("ascii")


def _decoded_body(content: str | None) -> bytes | None:
    if not content:
        return None
    try:
        raw = base64.b64decode(content, validate=True)
    except (ValueError, binascii.Error):
        return None
    return raw or None


def _loaded_body(raw: bytes):
    document = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[BODY_FRAGMENT] = fragment
    try:
        document.apply_update(raw)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as unreadable:
        # pycrdt is a Rust extension, and a malformed update raises
        # `pyo3_runtime.PanicException`. That derives from `BaseException`, so
        # left alone it passes straight through every `except Exception`
        # between here and the request, including the rollback that closes
        # Drive's savepoint. It is converted here and nowhere else.
        raise UnreadableBody(_("This Writer document body cannot be read")) from unreadable
    return document, fragment


def _elements(fragment):
    stack = list(fragment.children)
    while stack:
        node = stack.pop()
        if isinstance(node, pycrdt.XmlElement):
            yield node
            stack.extend(node.children)
