"""Writer's one declaration to Drive (§10.7).

Drive owns a Writer document's title, place, grants, lifecycle, versions,
comments, and byte charge. Writer owns the body: the Yjs update in `content`,
its rendered mirror in `html`, and the editor `settings`. Everything Drive
needs is the `SPEC` below, registered through the `drive_content_types` hook.

Every callable here takes and returns names, never documents, and reaches
Drive only through `from suite import drive` (ARCHITECTURE.md, rule 2.2).

## The body, and the two places a media id lives

The editor binds Tiptap's `Collaboration` extension to the Yjs root fragment
`default` (`frontend/src/apps/writer/collab/field.ts`), so `content`
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

`version_bytes` writes one `writer-document/1` JSON envelope carrying the Yjs
body, its HTML mirror, and the collaboration mode. `restore_version` also
accepts the exact UTF-8 HTML bytes §14.6 copies from a legacy `Writer Version`.
That legacy form becomes a non-collaborative body: Writer cannot reconstruct a
historical Yjs document from HTML, and leaving the current Yjs state behind
would make the two editors disagree.

The two forms are told apart by shape, not by a key: JSON object means native
envelope and owes a known schema, anything else is the migrated HTML. Bytes
that are not UTF-8, or larger than `MAX_VERSION_BYTES`, are refused before the
body is touched.

## Transactions

Drive runs every callback inside the savepoint of the workflow that calls it,
so any refusal rolls the node, the document, and the copied media back
together. A callback that cannot honour its contract raises rather than
half-writing, and none of them commits.

`content.call_app` enforces that last part. Every callback below reaches Drive
through it, and the two that answer a stream through `content.call_app_stream`,
so a commit added to one of them becomes a warning instead of destroying the
caller's savepoint. Nothing here commits either way.

## Collab documents

These callbacks read and write the row only. `with_content` wraps them with
the content layer's branch for a document in a log, and `SPEC` is that wrapped
declaration.
"""

import base64
import binascii
import io
import json
from contextlib import contextmanager

import frappe
import pycrdt
from frappe import _

from suite import drive
from suite.content import with_content
from suite.writer.content.files import (
    BODY_FRAGMENT,
    elements,
    ids_in,
    load,
    node_ids,
    remap_text,
    remapped_attribute,
)

DOCTYPE = "Writer Document"
MIME = "frappe/writer"
NODE_FIELD = "node"

# `Writer Document.content`'s own default: one empty Yjs update, base64.
EMPTY_BODY = "AAA="

HTML_FORMAT = "html"
HTML_MIME = "text/html"

VERSION_SCHEMA = "writer-document/1"
# The bytes every envelope `version_bytes` writes starts with
VERSION_PREFIX = json.dumps({"schema": VERSION_SCHEMA})[:-1].encode("utf-8")
VERSION_MIME = "application/json"

# One version is one body plus its HTML mirror plus JSON framing. Drive wrote
# every native envelope, but a §14.6 migrated `Writer Version` is raw snapshot
# HTML that never passed through Writer's editor, so the read is bounded before the
# bytes are held rather than after, exactly as `suite.sheets.drive` bounds its
# own. `Writer Document.content` and `.html` are both LONGTEXT.
MAX_VERSION_BYTES = 64 * 1024 * 1024

DEFAULT_SETTINGS = '{"collab": true}'


class UnreadableBody(frappe.ValidationError):
    """One Writer body pycrdt refused to read."""


class VersionTooLarge(frappe.ValidationError):
    """One Writer version past `MAX_VERSION_BYTES`, refused before it is held."""


def create_empty(node: str) -> str:
    """Insert one empty Writer document bound to `node`."""
    document = frappe.new_doc(DOCTYPE)
    document.node = node
    document.content = EMPTY_BODY
    document.html = ""
    document.settings = DEFAULT_SETTINGS
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
    """Stream one document as HTML, which Drive's Download asks for by default."""
    if format != HTML_FORMAT:
        frappe.throw(_("Writer exports {0} only").format(HTML_FORMAT), frappe.ValidationError)
    row = frappe.db.get_value(DOCTYPE, docname, ("html",), as_dict=True)
    if not row:
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)

    html_bytes = (row.html or "").encode("utf-8")
    return io.BytesIO(html_bytes), HTML_MIME


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    """Return the bytes Drive stores as one immutable version."""
    row = frappe.db.get_value(DOCTYPE, docname, ("content", "html", "collab"), as_dict=True)
    if not row:
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)

    payload = {
        "schema": VERSION_SCHEMA,
        "content": row.content or EMPTY_BODY,
        "html": row.html or "",
        "collab": int(bool(row.collab)),
    }
    return io.BytesIO(json.dumps(payload).encode("utf-8")), VERSION_MIME


def restore_version(docname: str, stream) -> None:
    """Put one stored version back into the body.

    Drive has already taken a version of the current state, so this is not
    destructive. Native envelopes restore every body field. Exact legacy HTML
    bytes restore as a non-collaborative document with an empty Yjs body.
    """
    payload = _version_payload(_read_bounded(stream))
    frappe.db.set_value(
        DOCTYPE,
        docname,
        {
            "content": payload["content"],
            "html": payload["html"],
            "collab": payload["collab"],
        },
    )


def on_purge(docname: str) -> None:
    """Delete the document and the app-owned rows behind it.

    §9.1 sends a purged node's history (`Drive Node Version`) with it, so
    there is nothing of the document's own to cascade; `force=1` skips the
    link check because Drive has already decided the purge.

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

    return ids_in(row.html or "") | _body_ids(row.content)


def remap_media(docname: str, mapping: dict[str, str]) -> None:
    """Repoint this body at the media nodes Drive copied for it (§8.9)."""
    if not mapping:
        return
    row = frappe.db.get_value(DOCTYPE, docname, ("content", "html"), as_dict=True)
    if not row:
        frappe.throw(_("That Writer document was not found"), frappe.DoesNotExistError)

    values = {"html": remap_text(row.html or "", mapping)}
    body = _remap_body(row.content, mapping)
    if body is not None:
        values["content"] = body
    frappe.db.set_value(DOCTYPE, docname, values, update_modified=False)


SPEC = with_content(
    drive.ContentTypeSpec(
        doctype=DOCTYPE,
        mime=MIME,
        node_field=NODE_FIELD,
        listing_type="document",
        # Drive's Download sends no format; WebDAV hides documents by their node kind
        default_export=HTML_FORMAT,
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
)


def _read_bounded(stream) -> bytes:
    """Read one version stream, refusing at the bound rather than after it.

    One byte past the bound is enough to know, so nothing larger is ever held.
    """
    raw = stream.read(MAX_VERSION_BYTES + 1)
    if len(raw) > MAX_VERSION_BYTES:
        frappe.throw(
            _("That Writer version is larger than {0} MB and cannot be read").format(
                MAX_VERSION_BYTES // (1024 * 1024)
            ),
            VersionTooLarge,
        )
    return raw


def _version_payload(raw: bytes) -> dict:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as invalid:
        # `text` is unbound on this arm, so the rest of the function must not
        # be reachable from it. Every other refusal here leaves its subject
        # bound and can lean on `frappe.throw` raising; this one cannot, so the
        # raise is written out. `throw` still runs, for the message log.
        message = _("This Writer version is not valid UTF-8")
        frappe.throw(message, frappe.ValidationError)
        raise frappe.ValidationError(message) from invalid

    try:
        payload = json.loads(text)
    except ValueError:
        payload = None

    # A legacy `Writer Version.snapshot` is rendered Tiptap HTML, and HTML never
    # parses as a JSON object. So the fork is the shape, not a key spelling: a
    # JSON object is a native envelope and owes a schema, and everything else is
    # the migrated form. Forking on `"schema" in payload` instead would read a
    # truncated envelope, or one whose key is misspelled, as a document body and
    # restore its own source text as HTML.
    if not isinstance(payload, dict):
        return {"content": EMPTY_BODY, "html": text, "collab": 0}

    if payload.get("schema") != VERSION_SCHEMA:
        frappe.throw(
            _("This Writer version declares an unknown schema"),
            frappe.ValidationError,
        )
    content = payload.get("content")
    html = payload.get("html")
    collab = payload.get("collab", 1)
    if (
        not isinstance(content, str)
        or not content
        or not isinstance(html, str)
        or type(collab) not in (bool, int)
        or collab not in (0, 1)
    ):
        frappe.throw(_("This Writer version cannot be read"), frappe.ValidationError)
    return {"content": content, "html": html, "collab": int(collab)}


def _body_ids(content: str | None) -> set[str]:
    """Read the live attributes of one Yjs body, never its tombstones."""
    try:
        raw = _decoded_body(content)
        if raw is None:
            return set()
        with _readable_body():
            found = node_ids(raw)
    except UnreadableBody:
        # An unreadable body must never cost somebody a picture, so fall back
        # to a raw scan. It over-reports, which only keeps media alive.
        frappe.log_error("Writer: could not read a document body for the media sweep", frappe.get_traceback())
        return ids_in(_raw_text(content))
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
    with _readable_body():
        document, fragment = load(raw)
        changed = False
        with document.transaction():
            for element in elements(fragment):
                for key, value in dict(element.attributes).items():
                    if not isinstance(value, str):
                        continue
                    rewritten = remapped_attribute(key, value, mapping)
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
    except ValueError, binascii.Error:
        return content
    return f"{content}{decoded}"


@contextmanager
def _readable_body():
    """Turn any pycrdt refusal into an ordinary `frappe.ValidationError`.

    pycrdt is a Rust extension, and a body it cannot read raises
    `pyo3_runtime.PanicException`. That derives from `BaseException`, so left
    alone it passes straight through every `except Exception` between here and
    the request, including the rollback that closes Drive's copy savepoint.

    `apply_update` is not the only call that can panic, so the traversal and
    the rewrite are guarded too. Every pycrdt call this module makes runs
    inside this block. A body whose root fragment was written as a `Text` or
    an `Array` applies cleanly and reads as a fragment with no children; it is
    refused here rather than read as empty.
    """
    try:
        yield
    except KeyboardInterrupt, SystemExit, UnreadableBody:
        raise
    except BaseException as unreadable:
        raise UnreadableBody(_("This Writer document body cannot be read")) from unreadable
