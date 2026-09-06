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

The two spellings are not read the same way. Inside `html` an attribute is
text and the patterns read it whole. Inside `content` an attribute is a name
and a value held apart, so the plain `data-node` spelling puts a bare id in
the value with nothing for a pattern to anchor on; the attribute name is read
as well, which is what keeps the two bodies in agreement.

Every pycrdt call runs inside `_readable_body()`. A body pycrdt cannot read
raises `pyo3_runtime.PanicException`, which derives from `BaseException` and
would otherwise pass straight through the `except Exception` that rolls
Drive's savepoint back. `apply_update` is not the only call that panics: a
body whose root fragment was written as a `Text` or an `Array` applies
cleanly and panics on the first child read.

## Versions

`version_bytes` writes one `writer-document/1` JSON envelope carrying both the
Yjs body and its HTML. `restore_version` reads the same envelope back. A bare
HTML payload is refused: a Yjs body cannot be rebuilt from HTML outside the
editor, so restoring one would leave the collaborative body and the rendered
HTML disagreeing. §14.6 migrates `Writer Version` rows as snapshot HTML, so
that Build (ticket 28) owes the envelope; see the ticket 17 handoffs.

## Transactions

Drive runs every callback inside the savepoint of the workflow that calls it,
so any refusal rolls the node, the document, and the copied media back
together. A callback that cannot honour its contract raises rather than
half-writing, and none of them commits.

`content.app_callback()`, which enforces that last part, currently wraps only
`create_empty`, `duplicate`, and `remap_media` (`nodes.py:446`, `:513`).
`on_purge`, `restore_version`, `version_bytes`, `export`, and `used_nodes` run
unguarded, so a commit added to one of them would destroy the caller's
savepoint. Nothing here commits. Recorded for Drive, not worked around here.
"""

import base64
import binascii
import io
import json
import re
from contextlib import contextmanager

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

# A media reference inside a body is a node id carried in an attribute. Both
# spellings are read: the embed URL Writer has always written, with and without
# the `suite.` prefix the standalone app used, and the plain node attribute the
# Drive media route uses.
#
# The two spellings are not symmetrical. In `html` an attribute is text, so
# both patterns read it. In the Yjs body an attribute is a name and a value
# held apart, and the plain spelling puts the bare id in the value with
# `data-node` nowhere in it, so the pattern alone would never see it. That is
# what `_attribute_ids` and `_remapped_attribute` are for.
NODE_ATTRIBUTE = "data-node"
MEDIA_ID = r"[A-Za-z0-9_-]{1,140}"
MEDIA_PATTERNS = (
    re.compile(rf"(?:suite\.)?writer\.api\.embed\.get\?id=({MEDIA_ID})"),
    re.compile(rf'{NODE_ATTRIBUTE}="({MEDIA_ID})"'),
)
BARE_MEDIA_ID = re.compile(MEDIA_ID)

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
    `Writer Version` rows. §9.1 sends a purged node's history with it, and
    `force=1` already skips the link check, so the cascade is what the rows
    are for, not a way around a refusal.

    `delete_permanently` is what makes a purge a purge. Without it Frappe keeps
    the whole row as JSON in `Deleted Document`
    (`frappe/model/delete_doc.py:add_to_deleted_document`), so the body, its
    HTML, and the comment blob would all outlive the §8.8 purge that was meant
    to remove them.
    """
    frappe.delete_doc(
        DOCTYPE,
        docname,
        force=1,
        ignore_permissions=True,
        ignore_missing=True,
        delete_permanently=True,
    )


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


def _attribute_ids(key: str, value: str) -> set[str]:
    """Answer the media node ids one live element attribute names.

    `data-node` holds the bare id, with the attribute name held apart from it,
    so the text patterns never see it inside a Yjs body. Reading the name is
    what makes the two spellings symmetrical between `html` and `content`.
    """
    if key == NODE_ATTRIBUTE and BARE_MEDIA_ID.fullmatch(value):
        return {value}
    return _ids_in(value)


def _remapped_attribute(key: str, value: str, mapping: dict[str, str]) -> str:
    """Rewrite one live element attribute, in whichever spelling it uses."""
    if key == NODE_ATTRIBUTE:
        return mapping.get(value, value)
    return _remap_text(value, mapping)


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
    try:
        raw = _decoded_body(content)
        if raw is None:
            return set()
        _, fragment = _loaded_body(raw)
        with _readable_body():
            found = _fragment_ids(fragment)
    except UnreadableBody:
        # An unreadable body must never cost somebody a picture, so fall back
        # to a raw scan. It over-reports, which only keeps media alive.
        frappe.log_error("Writer: could not read a document body for the media sweep", frappe.get_traceback())
        return _ids_in(_raw_text(content))
    return found


def _fragment_ids(fragment) -> set[str]:
    found: set[str] = set()
    for element in _elements(fragment):
        for key, value in dict(element.attributes).items():
            if isinstance(value, str):
                found |= _attribute_ids(key, value)
    return found


def _remap_body(content: str | None, mapping: dict[str, str]) -> str | None:
    """Rewrite one Yjs body's media attributes, or answer None for no rewrite.

    None means one of two things and neither loses a reference: there is no
    body at all, or nothing in it named an id the mapping carries.

    A body that will not decode and a body pycrdt cannot read both raise
    `UnreadableBody` rather than being skipped. Drive calls this inside the
    copy's savepoint, and a copy whose pictures still point at the source's
    nodes is worse than a refused copy.
    """
    raw = _decoded_body(content)
    if raw is None:
        return None
    document, fragment = _loaded_body(raw)
    with _readable_body():
        changed = False
        with document.transaction():
            for element in _elements(fragment):
                for key, value in dict(element.attributes).items():
                    if not isinstance(value, str):
                        continue
                    rewritten = _remapped_attribute(key, value, mapping)
                    if rewritten != value:
                        element.attributes[key] = rewritten
                        changed = True
        if not changed:
            return None
        return base64.b64encode(document.get_update()).decode("ascii")


def _decoded_body(content: str | None) -> bytes | None:
    """Answer the update bytes, None for no body at all, or refuse.

    An empty column is a document nobody has typed in, and it names nothing.
    A column that holds something base64 will not decode is still a body; it
    is one this module cannot read, which is a different answer. Folding the
    two together made an undecodable body say "I use no pictures", so the
    sweep trashed its media, and made a copy of it keep the source's ids.
    """
    if not content:
        return None
    try:
        raw = base64.b64decode(content, validate=True)
    except (ValueError, binascii.Error) as undecodable:
        raise UnreadableBody(_("This Writer document body cannot be read")) from undecodable
    return raw or None


def _raw_text(content: str | None) -> str:
    """Everything a raw scan of an unreadable body may look at."""
    if not content:
        return ""
    try:
        decoded = base64.b64decode(content, validate=True).decode("utf-8", "ignore")
    except (ValueError, binascii.Error):
        return content
    return f"{content}{decoded}"


@contextmanager
def _readable_body():
    """Turn any pycrdt refusal into an ordinary `frappe.ValidationError`.

    pycrdt is a Rust extension, and a body it cannot read raises
    `pyo3_runtime.PanicException`. That derives from `BaseException`, so left
    alone it passes straight through every `except Exception` between here and
    the request, including the rollback that closes Drive's copy savepoint.

    `apply_update` is not the only call that panics. A body whose root
    fragment was written as a `Text` or an `Array` applies cleanly and panics
    on the first child read instead, so the traversal and the rewrite are
    guarded too. Every pycrdt call this module makes runs inside this block.
    """
    try:
        yield
    except (KeyboardInterrupt, SystemExit, UnreadableBody):
        raise
    except BaseException as unreadable:
        raise UnreadableBody(_("This Writer document body cannot be read")) from unreadable


def _loaded_body(raw: bytes):
    document = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[BODY_FRAGMENT] = fragment
    with _readable_body():
        document.apply_update(raw)
    return document, fragment


def _elements(fragment):
    stack = list(fragment.children)
    while stack:
        node = stack.pop()
        if isinstance(node, pycrdt.XmlElement):
            yield node
            stack.extend(node.children)
