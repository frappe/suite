"""The one contract a Suite content app declares to live inside Drive.

Drive owns a content document's title, place, grants, lifecycle, versions,
comments, and byte charge. The app owns the body. Everything Drive needs from
the app is one `ContentTypeSpec` value, registered through the
`drive_content_types` hook, whose callables take and return names and never
documents (§10.1).

This module holds the registry, the `DriveContent` mixin, `touch`, the media
listing, and the daily unused-media sweep. `nodes.create_document`,
`nodes.copy`, and `versions` read the registry through `spec_for`.

## Layering

`content` sits below `nodes` so `nodes` can import it at the top. The two
functions that mutate nodes (`sweep_unused_media`, `copy_document_media`)
import `nodes` inside the function, the same one-way break `roots` uses.

## Transactions

`touch` is one UPDATE and joins the caller's transaction. `sweep_unused_media`
commits one document at a time and rolls a failing document back on its own,
so a bad `used_nodes` answer never stops the pass. Its own commit and rollback
sit outside `_sweep_document`, so the guard around `used_nodes` never disarms
them.

Every call into a `ContentTypeSpec` callback goes through `call_app` or
`call_app_stream`, so app code always runs with transaction control disabled
(§10.1). `nodes`, `roots`, and `versions` hold no unguarded call site.
"""

import functools
import re
import time
from collections.abc import Callable, Iterable, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from typing import IO
from uuid import uuid4

import frappe
from frappe import _
from frappe.model.base_document import get_controller
from frappe.storage.url import signed_url_for_blob
from frappe.utils import get_attr, now_datetime

from suite.drive._core.access import add_creator_grant, require
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roles import EDIT, READ, UPLOAD

# §6.8 and §10.6: one Read check on the document, then signed `/f/` URLs that
# live 15 minutes. The page re-requests at two thirds of the TTL.
MEDIA_TTL_SECONDS = 15 * 60
MEDIA_REFRESH_SECONDS = MEDIA_TTL_SECONDS * 2 // 3

# §10.6: a media node younger than this is never swept, so an upload that is
# still being placed into a body survives the next daily pass.
UNUSED_MEDIA_GRACE_DAYS = 7
MEDIA_SWEEP_BATCH = 200
# One daily pass keeps reading batches until it reaches the newest changed
# document. Without the loop a site that changes more than one batch a day
# never catches up and its unused media is never found. The bound stops one
# pass from running for ever.
MEDIA_SWEEP_BATCHES = 50
MEDIA_SWEEP_CURSOR_KEY = "drive:media-sweep-cursor"

REGISTRY_CACHE_ATTR = "drive_content_registry"

# §10.2 forbids three shapes on a content doctype. The title and the trash
# state live on the node with no mirror in either direction, and sharing has
# one home.
FORBIDDEN_FIELD_NAMES = frozenset({"title", "trashed", "trashed_at", "trashed_on", "trashed_by"})
FORBIDDEN_FIELD_PREFIXES = ("share_", "shared_")

# The node column a `DriveContent` controller uses unless it names another one.
DEFAULT_NODE_FIELD = "node"

# What every content workflow reads about the document node it acts on.
# `parent` is here for `nodes._validate_stored_position`, which walks the stored
# `parent` link upwards: a row read without it looks like a node with no parent,
# which the validator has to refuse as an invalid tree position.
DOCUMENT_NODE_FIELDS = (
    "name",
    "parent",
    "kind",
    "root",
    "path",
    "state",
    "title",
    "content_doctype",
    "content_docname",
)
MEDIA_ROW_FIELDS = ("name", "title", "kind", "blob", "size", "mime", "creation", "content_modified")
# What `adopt_media` reads about a media node it is asked to bring across.
# `parent`, `root`, and `path` are what `access.chain_ids` walks, so the READ
# check below costs one read and no extra tree query.
MEDIA_SOURCE_FIELDS = (
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
    "content_modified",
)


@dataclass(frozen=True)
class Satellite:
    """A doctype that takes its rights from a content document's node.

    Read to see, Edit to change. Drive supplies the per-row check and the list
    filter through `suite.drive.framework`; the app writes no permission code.
    """

    doctype: str
    link_field: str


@dataclass(frozen=True)
class ContentTypeSpec:
    """Everything one content app declares about its documents.

    `create_empty`, `duplicate`, and `on_purge` are required. Every other
    callable is optional and its absence removes one capability; it never
    breaks Drive.
    """

    # identity. Set once, never changes.
    doctype: str
    mime: str
    node_field: str
    default_export: str | None = None
    export_formats: tuple[str, ...] = ()

    # factories. Drive creates the node first, then calls these.
    create_empty: Callable[[str], str] = None
    """(node) -> docname. Insert an empty document bound to `node`."""
    duplicate: Callable[[str, str], str] = None
    """(source_docname, node) -> docname. Copy, duplicate, new-from-template."""
    import_from_file: Callable[[str, str], str] | None = None
    """(file_node, node) -> docname. An xlsx becoming a sheet."""

    # bytes. Both are invoked through `call_app_stream`, which guards the call
    # and the returned stream.
    export: Callable[[str, str], tuple[IO[bytes], str]] | None = None
    """(docname, format) -> (stream, mime). Streamed, never stored."""
    version_bytes: Callable[[str], tuple[IO[bytes], str]] | None = None
    """(docname) -> (stream, mime). The bytes Drive stores as a version."""
    restore_version: Callable[[str, IO[bytes]], None] | None = None
    """(docname, stream) -> None. Drive already took a version of the current
    state, so this call is not destructive."""

    # preview. True when the app calls push_preview; Drive never renders a
    # document and documents get no gap sweep.
    pushes_preview: bool = False

    # cleanup. (docname) -> None: delete the document and its app-owned rows.
    on_purge: Callable[[str], None] | None = None

    satellites: tuple[Satellite, ...] = ()

    # media sweep. (docname) -> the node ids the body still names. Only the
    # app can read its own body, so only the app can answer.
    used_nodes: Callable[[str], set[str]] | None = None

    # cleanup-pending columns. The names §10.2 forbids that this doctype still
    # owns because §14.7 read them at Build and §14.10 drops them at Cleanup,
    # one release later. Naming one here exempts it from the forbidden-field
    # check and freezes it: `refuse_legacy_field_write` refuses every write, so
    # "no mirror in either direction" holds while the value Build left stays
    # readable for the §14.11 post-Build rollback. `_validate_legacy_fields`
    # refuses a name the doctype no longer owns, so the exemption cannot
    # outlive the column it names.
    legacy_fields: tuple[str, ...] = ()

    # media remap. (docname, {old_node: new_node}) -> None. §8.9 copies a
    # document by calling `duplicate`, then copying the child media nodes,
    # then rewriting the app's own references to the new node ids. Only the
    # app can do that third step, so it is declared here. An app that does
    # not declare it gets no media copied, because copied media nothing
    # names would only charge the destination root and be swept in seven
    # days.
    remap_media: Callable[[str, dict[str, str]], None] | None = None


REQUIRED_CALLBACKS = ("create_empty", "duplicate", "on_purge")
OPTIONAL_CALLBACKS = (
    "import_from_file",
    "export",
    "version_bytes",
    "restore_version",
    "used_nodes",
    "remap_media",
)


@contextmanager
def app_callback():
    """Run one `ContentTypeSpec` callback without letting it end the transaction.

    Drive writes the node, the document, and the copied media inside one
    savepoint (§8.3, §8.9). An app factory that calls `frappe.db.commit()`
    would make the half-written node permanent and destroy the savepoint, so
    every refusal after it could no longer roll anything back. Frappe's own
    guard turns `commit` and a full `rollback` into a warning and leaves
    `rollback(save_point=...)` working, which is exactly the contract Drive
    needs from an app callback.
    """
    frappe.db._disable_transaction_control += 1
    try:
        yield
    finally:
        frappe.db._disable_transaction_control -= 1


def call_app(callback: Callable, /, *args, **kwargs):
    """Call one `ContentTypeSpec` callback inside `app_callback`.

    Every Drive call path into app code goes through here, so a callback can
    never be reached with the transaction unguarded. The guard nests by count,
    so a caller that already holds one loses nothing by using this.
    """
    with app_callback():
        return callback(*args, **kwargs)


def call_app_stream(callback: Callable, /, *args, **kwargs) -> tuple[IO[bytes], str]:
    """Call a `(stream, mime)` callback and guard the stream it answered.

    `version_bytes` and `export` hand Drive a stream that Drive reads after the
    callback has returned. A lazily produced stream runs app code on every
    `read`, so the guard has to travel with the stream instead of ending at the
    call. `GuardedStream` re-enters `app_callback` per operation rather than
    holding it open, so nothing Drive does between reads is guarded and the
    stream is never closed early.
    """
    result = call_app(callback, *args, **kwargs)
    if not isinstance(result, tuple) or len(result) != 2:
        raise DriveConflict(_("The Drive content callback returned invalid bytes"))
    stream, mime = result
    if not hasattr(stream, "read") or not isinstance(mime, str) or not mime:
        raise DriveConflict(_("The Drive content callback returned invalid bytes"))
    return GuardedStream(stream), mime


class GuardedStream:
    """An app-supplied byte stream whose every operation stays guarded.

    Delegates to the wrapped stream. A callable attribute is returned wrapped
    in `app_callback`, so `read`, `seek`, and `close` all run with transaction
    control disabled; a plain attribute is returned as it is.
    """

    def __init__(self, stream: IO[bytes]):
        self.stream = stream

    def read(self, *args, **kwargs):
        with app_callback():
            return self.stream.read(*args, **kwargs)

    def seek(self, *args, **kwargs):
        with app_callback():
            return self.stream.seek(*args, **kwargs)

    def close(self):
        with app_callback():
            return self.stream.close()

    def __iter__(self):
        # Delegate rather than re-implement: a file object iterates by line and
        # a raw stream by chunk, and the wrapper must not change which.
        iterator = iter(self.stream)
        while True:
            with app_callback():
                item = next(iterator, None)
            if item is None:
                return
            yield item

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()
        return False

    def __getattr__(self, name: str):
        attribute = getattr(self.stream, name)
        if not callable(attribute):
            return attribute

        @functools.wraps(attribute)
        def guarded(*args, **kwargs):
            with app_callback():
                return attribute(*args, **kwargs)

        return guarded


def registry() -> dict[str, ContentTypeSpec]:
    """Return every registered spec keyed by doctype, built once per request.

    The result is cached on `frappe.local`, which is per site and per request,
    so a hook change is picked up by the next request and no cross-process
    pickling of the declared callables is ever attempted. The structural
    checks below run on every build; the DocType checks that need a database
    live in `validate_registry`.
    """
    cached = getattr(frappe.local, REGISTRY_CACHE_ATTR, None)
    if cached is None:
        cached = _build_registry()
        setattr(frappe.local, REGISTRY_CACHE_ATTR, cached)
    return cached


def clear_registry_cache() -> None:
    """Drop this request's cached registry."""
    if hasattr(frappe.local, REGISTRY_CACHE_ATTR):
        delattr(frappe.local, REGISTRY_CACHE_ATTR)


def spec_for(doctype: str) -> ContentTypeSpec:
    """Return the registered spec for one content doctype, or refuse."""
    spec = registry().get(doctype)
    if spec is None:
        raise DriveConflict(_("The Drive content type is not registered"))
    return spec


def satellite_for(doctype: str) -> tuple[ContentTypeSpec, Satellite]:
    """Return the owning spec and declaration for one satellite doctype."""
    for spec in registry().values():
        for satellite in spec.satellites:
            if satellite.doctype == doctype:
                return spec, satellite
    raise DriveConflict(_("The Drive satellite type is not registered"))


def governs(doctype: str) -> bool:
    """Answer whether Drive decides who reads one doctype.

    True for a registered content doctype and for every satellite one of them
    declares. `suite.drive.framework` asks before it lets the framework widen
    an answer Drive gave.
    """
    registered = registry()
    if doctype in registered:
        return True
    return any(satellite.doctype == doctype for spec in registered.values() for satellite in spec.satellites)


def governed_doctypes() -> tuple[str, ...]:
    """Return every doctype Drive governs, content types and satellites."""
    registered = registry()
    names = set(registered)
    names.update(satellite.doctype for spec in registered.values() for satellite in spec.satellites)
    return tuple(sorted(names))


def validate_registry() -> None:
    """Prove every declaration against the doctype it names.

    Run after a migration and by the contract test. It repeats the structural
    checks and adds the ones that need a database: the node link field, the
    mixin, the satellite link fields, and the fields §10.2 forbids.
    """
    clear_registry_cache()
    for doctype, spec in _build_registry().items():
        meta = _meta_or_refuse(doctype)
        _validate_node_field(meta, spec)
        _validate_mixin(doctype, spec)
        _validate_forbidden_fields(meta, spec)
        _validate_legacy_fields(meta, spec)
        for satellite in spec.satellites:
            _validate_satellite(satellite, doctype)


def _build_registry() -> dict[str, ContentTypeSpec]:
    built: dict[str, ContentTypeSpec] = {}
    satellites: dict[str, str] = {}
    for path in frappe.get_hooks("drive_content_types") or ():
        spec = get_attr(path)
        if not isinstance(spec, ContentTypeSpec):
            raise DriveConflict(_("The Drive content registry is invalid"))
        _validate_shape(spec)
        if spec.doctype in built:
            raise DriveConflict(_("The Drive content type is registered more than once"))
        built[spec.doctype] = spec
        for satellite in spec.satellites:
            if satellite.doctype in satellites or satellite.doctype in built:
                raise DriveConflict(_("The Drive satellite type is registered more than once"))
            satellites[satellite.doctype] = spec.doctype
    if satellites.keys() & built.keys():
        raise DriveConflict(_("The Drive satellite type is registered more than once"))
    return built


def _validate_shape(spec: ContentTypeSpec) -> None:
    for field in ("doctype", "mime", "node_field"):
        if not isinstance(getattr(spec, field), str) or not getattr(spec, field):
            raise DriveConflict(_("The Drive content registry is invalid"))
    # `doctype` and `node_field` are interpolated into the list predicate as
    # SQL identifiers, so they are checked here, on every registry build, not
    # only at migrate time.
    _validate_identifier(spec.doctype)
    _validate_identifier(spec.node_field)
    for name in REQUIRED_CALLBACKS:
        if not callable(getattr(spec, name, None)):
            raise DriveConflict(
                _("The Drive content type {0} declares no {1} callback").format(spec.doctype, name)
            )
    for name in OPTIONAL_CALLBACKS:
        declared = getattr(spec, name, None)
        if declared is not None and not callable(declared):
            raise DriveConflict(
                _("The Drive content type {0} declares an invalid {1} callback").format(spec.doctype, name)
            )
    if not isinstance(spec.export_formats, tuple) or any(
        not isinstance(item, str) or not item for item in spec.export_formats
    ):
        raise DriveConflict(_("The Drive content export formats are invalid"))
    if spec.default_export is not None and spec.default_export not in spec.export_formats:
        raise DriveConflict(_("The Drive content default export is not an offered format"))
    if not isinstance(spec.legacy_fields, tuple) or any(
        not isinstance(item, str) or not item for item in spec.legacy_fields
    ):
        raise DriveConflict(_("The Drive content legacy fields are invalid"))
    for name in spec.legacy_fields:
        # The exemption only reaches a field §10.2 already forbids. It is not a
        # way to keep an arbitrary column out of a later check.
        if name not in FORBIDDEN_FIELD_NAMES and not name.startswith(FORBIDDEN_FIELD_PREFIXES):
            raise DriveConflict(
                _("The Drive content legacy field {0} is not a field Drive owns").format(name)
            )
    if not isinstance(spec.satellites, tuple) or any(
        not isinstance(item, Satellite) for item in spec.satellites
    ):
        raise DriveConflict(_("The Drive content satellites are invalid"))
    for satellite in spec.satellites:
        if not satellite.doctype or not satellite.link_field:
            raise DriveConflict(_("The Drive content satellites are invalid"))
        _validate_identifier(satellite.doctype)
        _validate_identifier(satellite.link_field)


IDENTIFIER = re.compile(r"[A-Za-z][A-Za-z0-9_ ]*")


def _validate_identifier(value: str) -> None:
    """Refuse a name that cannot be quoted as one SQL identifier."""
    if not IDENTIFIER.fullmatch(value):
        raise DriveConflict(_("The Drive content name {0} is not a valid identifier").format(value))


def _meta_or_refuse(doctype: str):
    if not frappe.db.exists("DocType", doctype):
        raise DriveConflict(_("The Drive content doctype {0} does not exist").format(doctype))
    return frappe.get_meta(doctype)


def _validate_node_field(meta, spec: ContentTypeSpec) -> None:
    field = meta.get_field(spec.node_field)
    if not field or field.fieldtype != "Link" or field.options != "Drive Node":
        raise DriveConflict(
            _("The Drive content type {0} needs a {1} Link to Drive Node").format(
                spec.doctype, spec.node_field
            )
        )


def _validate_mixin(doctype: str, spec: ContentTypeSpec) -> None:
    # `frappe.model.base_document.get_controller`, not a `Meta` method: `Meta`
    # has none, so reading it through the meta made every declaration fail.
    controller = get_controller(doctype)
    if not issubclass(controller, DriveContent):
        raise DriveConflict(
            _("The Drive content doctype {0} does not use the DriveContent mixin").format(doctype)
        )
    # The mixin reads the node column from the controller and the list
    # predicate reads it from the declaration, because the mixin has to work
    # before the doctype is registered. Two names that disagree would put the
    # row check and the list filter on different columns, so activation
    # refuses it.
    if getattr(controller, "drive_node_field", DEFAULT_NODE_FIELD) != spec.node_field:
        raise DriveConflict(
            _("The Drive content doctype {0} and its declaration name different node fields").format(doctype)
        )


def _validate_forbidden_fields(meta, spec: ContentTypeSpec) -> None:
    """Refuse a title mirror, a trash mirror, and an app-owned share field.

    The title check asks `meta.get_title_field()`, not the raw `title_field`
    attribute. Frappe resolves an absent attribute to a field literally called
    `title` and only then to `name` (`frappe/model/meta.py:373-384`), so
    reading the attribute alone passes every doctype that owns a `title`
    column and declares no `title_field` — which is the exact shape §10.2
    forbids. A declared `legacy_fields` name is the one exemption, and it is
    frozen rather than absent: see `refuse_legacy_field_write`.
    """
    display = meta.get_title_field()
    if display != "name" and display not in spec.legacy_fields:
        raise DriveConflict(
            _("The Drive content doctype {0} must not mirror the node title").format(spec.doctype)
        )
    for field in meta.fields:
        name = field.fieldname or ""
        if name in spec.legacy_fields:
            # Declared, frozen, and dropped at Cleanup. §10.2's rule is "no
            # mirror in either direction". The column survives until §14.10
            # drops it, so what holds the rule meanwhile is the freeze:
            # `refuse_legacy_field_write` refuses every write, in either
            # direction, so the value cannot diverge from what Build left.
            continue
        if name in FORBIDDEN_FIELD_NAMES or name.startswith(FORBIDDEN_FIELD_PREFIXES):
            raise DriveConflict(
                _("The Drive content doctype {0} must not own the field {1}").format(spec.doctype, name)
            )


def _validate_legacy_fields(meta, spec: ContentTypeSpec) -> None:
    """Refuse a legacy exemption for a column the doctype no longer owns.

    `legacy_fields` is the one way past §10.2, so it has to expire with the
    column it names. Once §14.10 drops `title`, this refuses the next migration
    until the declaration drops the entry too. The escape hatch cannot be left
    open by accident.
    """
    for name in spec.legacy_fields:
        if not meta.get_field(name):
            raise DriveConflict(
                _("The Drive content doctype {0} no longer owns the legacy field {1}").format(
                    spec.doctype, name
                )
            )


def _validate_satellite(satellite: Satellite, content_doctype: str) -> None:
    if satellite.link_field == "parent":
        # A child table names its parent through the framework's own columns,
        # which carry no fieldname of their own on the child doctype. Frappe
        # answers a child row's permission through its parent doctype, so the
        # declaration is only sound when this table is a Table field on the
        # content doctype itself.
        meta = _meta_or_refuse(satellite.doctype)
        if not meta.istable:
            raise DriveConflict(_("The Drive satellite {0} is not a child table").format(satellite.doctype))
        parent_meta = _meta_or_refuse(content_doctype)
        if not any(
            field.fieldtype in ("Table", "Table MultiSelect") and field.options == satellite.doctype
            for field in parent_meta.fields
        ):
            raise DriveConflict(
                _("The Drive satellite {0} is not a child table of {1}").format(
                    satellite.doctype, content_doctype
                )
            )
        return
    meta = _meta_or_refuse(satellite.doctype)
    field = meta.get_field(satellite.link_field)
    if not field or field.fieldtype != "Link" or field.options != content_doctype:
        raise DriveConflict(
            _("The Drive satellite {0} needs a {1} Link to {2}").format(
                satellite.doctype, satellite.link_field, content_doctype
            )
        )


class DriveContent:
    """Mixin for a content doctype: four calls, and no field Drive owns.

    A content doctype's controller inherits this. It provides the node id, the
    node title as a read-only property, the point permission check, `touch`,
    and `take_version`, and it registers the `before_insert` guard that
    refuses a document with no node. The guard runs even when the controller
    declares its own `before_insert`, because `__init_subclass__` wraps it.

    §10.3 stages registration: a controller carries this mixin from its
    adoption ticket, and the doctype joins `drive_content_types` only once
    every row of it carries a node link. So the mixin has to work before it is
    registered, and `drive_node_field` is what names the node column until the
    declaration does. `_validate_mixin` refuses an activation where the two
    disagree.
    """

    drive_node_field: str = DEFAULT_NODE_FIELD

    def __init_subclass__(cls, **kwargs) -> None:
        super().__init_subclass__(**kwargs)
        _guard_hook(cls, "before_insert", DriveContent.before_insert)
        _guard_hook(cls, "validate", DriveContent.validate)

    def before_insert(self) -> None:
        require_node(self)

    def validate(self) -> None:
        refuse_node_change(self)
        refuse_legacy_field_write(self)

    @property
    def node(self) -> str:
        node = self.get(node_field_of(self))
        if not node:
            raise DriveConflict(_("A Drive content document has no node"))
        return node

    @node.setter
    def node(self, value: str) -> None:
        """Accept the write-back Frappe does for every Link field.

        `_validate_links` assigns each Link field the name it just read
        (`frappe/model/base_document.py:1159`). A read-only property there
        makes every insert and save of a content doctype whose node field is
        called `node` die with an AttributeError. `refuse_node_change` is what
        holds the node still, not a missing setter.
        """
        self.set(node_field_of(self), value)

    @property
    def node_title(self) -> str:
        """Read the title from the node. There is no mirror in either direction."""
        return frappe.db.get_value("Drive Node", self.node, "title")

    def drive_check(self, role: int) -> None:
        """Raise unless the caller holds `role` at this document's node."""
        from suite.drive.framework import principals_for

        node = _document_node(self.node)
        require(node, role, principals_for())
        _refuse_trashed_write(node, role)

    def drive_touch(self) -> None:
        """Record that this body changed now, at most once per request."""
        touched = getattr(frappe.local, "drive_touched_documents", None)
        if touched is None:
            touched = set()
            frappe.local.drive_touched_documents = touched
        key = (self.doctype, self.name)
        if key in touched:
            return
        touch_node(self.node)
        touched.add(key)

    def drive_take_version(self, *, kind: str = "auto", label: str | None = None) -> int:
        """Store the current body as an immutable version and return its seq."""
        from suite.drive._core.versions import take_version
        from suite.drive.framework import principals_for

        return take_version(principals_for(), self.node, kind=kind, label=label)


def _guard_hook(cls, name: str, guard) -> None:
    """Make `cls.name` run Drive's guard first, whoever declares it.

    The resolved attribute is what Frappe's `run_method` calls, so reading the
    subclass `__dict__` alone would miss a `before_insert` or `validate`
    inherited from another base that sits before `DriveContent` in the MRO.
    """
    declared = getattr(cls, name, None)
    if declared is None or declared is guard or getattr(declared, "_drive_node_guard", False):
        return

    @functools.wraps(declared)
    def guarded(self) -> None:
        guard(self)
        declared(self)

    guarded._drive_node_guard = True
    setattr(cls, name, guarded)


def node_field_of(doc) -> str:
    """Name the node column of one content document, registered or not.

    The registry decides while the doctype is registered, because the list
    predicate reads the same declaration. Before activation there is no
    declaration to read, so the controller's own `drive_node_field` answers;
    `_validate_mixin` refuses an activation where the two disagree.
    """
    spec = registry().get(doc.doctype)
    if spec is not None:
        return spec.node_field
    return getattr(doc, "drive_node_field", None) or DEFAULT_NODE_FIELD


def refuse_node_change(doc) -> None:
    """Refuse a saved content document that repoints itself at another node.

    §8.3: both sides of the link are set once and never change. The Drive side
    is held by `nodes._link_document` and the `Drive Node` controller; this is
    the app side. It holds on both sides of activation: a row that has a node
    keeps it, and a legacy row that acquires one during the expand phase is
    held to the same link rules an insert is.
    """
    if doc.get("__islocal") or not doc.get("name"):
        return
    field = node_field_of(doc)
    stored = frappe.db.get_value(doc.doctype, doc.name, field)
    if stored and stored != doc.get(field):
        raise DriveConflict(_("A Drive content document identity cannot change"))
    if not stored and doc.get(field) and not governs(doc.doctype):
        # A legacy row acquiring a node during the expand phase, which is the
        # one window where a stored row can have no node. `require_node` only
        # runs before an insert, so the same link rules are applied here: a
        # node that is not a document node, or one that already names another
        # document, is refused rather than silently accepted. A registered
        # doctype cannot reach this, because no row of it exists without a node.
        require_node(doc)


def refuse_legacy_field_write(doc) -> None:
    """Freeze the columns §14.10 drops at Cleanup.

    §10.2 forbids a content doctype owning a title or trash column because the
    node is the only truth, "with no mirror in either direction". §14.7 reads
    `Presentation.title` at Build and §14.10 drops it one release later, so
    between the two there is a window where the column has to exist and must
    not be a mirror. A declaration names it in `legacy_fields`; this refuses
    every write to it.

    Drive never writes it, the app cannot write it, and the value Build left is
    still there for the §14.11 post-Build rollback. Nothing is reset silently:
    a caller that tries to mirror the node title is told it cannot.

    Only a registered doctype is frozen. Before activation the column is the
    live legacy title and the app still owns it.
    """
    spec = registry().get(doc.doctype)
    if spec is None or not spec.legacy_fields:
        return
    if doc.get("__islocal") or not doc.get("name"):
        offered = next((field for field in spec.legacy_fields if doc.get(field)), None)
        if offered is not None:
            raise DriveConflict(_("A Drive content document cannot set {0}; Drive owns it").format(offered))
        return
    stored = frappe.db.get_value(doc.doctype, doc.name, spec.legacy_fields, as_dict=True) or {}
    for field in spec.legacy_fields:
        # An empty string and NULL are the same absence here, so a reload that
        # normalises one into the other is not read as a write.
        if (doc.get(field) or None) != (stored.get(field) or None):
            raise DriveConflict(_("A Drive content document cannot change {0}; Drive owns it").format(field))


def require_node(doc) -> None:
    """Refuse a content document that names the wrong node, or none at all.

    §5.13 and §10.2: a Drive-native document without a node cannot exist, so
    it is an error, not a case Drive handles. Registration is what makes the
    node mandatory: while the doctype is still in the expand phase its legacy
    rows carry no node and keep working, and Build (§14) is what links them.
    A row that does carry one is held to the whole rule either way, so no
    document can name a node that is not its own.
    """
    field = node_field_of(doc)
    node = doc.get(field)
    if not node:
        if governs(doc.doctype):
            raise DriveConflict(_("A Drive content document requires its node"))
        return
    row = frappe.db.get_value("Drive Node", node, ("kind", "content_docname"), as_dict=True)
    if not row or row.kind != "document":
        raise DriveConflict(_("A Drive content document requires a document node"))
    if row.content_docname and row.content_docname != doc.name:
        raise DriveConflict(_("That Drive node already names another content document"))


def touch(principals: Principals, doctype: str, docname: str) -> None:
    """Record that one content document's body changed now (§8.11).

    One indexed read of the document's node field, one point check, and one
    UPDATE. No document load and no doc events: the events this replaces
    mirrored the title and the trash state, and both now live only on the node.
    """
    spec = spec_for(doctype)
    node = frappe.db.get_value(doctype, docname, spec.node_field)
    if not node:
        raise DriveConflict(_("A Drive content document requires its node"))
    current = _document_node(node)
    require(current, EDIT, principals)
    _refuse_trashed_write(current, EDIT)
    touch_node(node)


def _refuse_trashed_write(node: Mapping, role: int) -> None:
    """§8.8: a trashed document node opens read-only.

    The point check answers who the caller is, not what state the node is in,
    because Drive's own restore and purge workflows must still act on a
    trashed node. The app-facing calls are the ones that must refuse, the same
    way `versions._require_content_version_node` refuses a capture or a
    restore on one.
    """
    if role > READ and node.get("state") != "Active":
        raise DriveForbidden(_("Trashed Drive nodes are read-only"))


def touch_node(node: str) -> None:
    """Stamp `content_modified` without loading or versioning the node."""
    frappe.db.set_value("Drive Node", node, "content_modified", now_datetime(), update_modified=False)


def list_media(principals: Principals, node: str) -> list[dict]:
    """List one readable document's media with signed, 15-minute `/f/` URLs.

    One Read check on the document answers for every picture below it, which
    is the per-picture permission cost §6.8 removes. The caller refreshes at
    `MEDIA_REFRESH_SECONDS`, two thirds of the TTL.
    """
    current = _document_node(node)
    require(current, READ, principals)
    expires = int(time.time()) + MEDIA_TTL_SECONDS
    return [
        {
            "node": row.name,
            "title": row.title,
            "mime": row.mime,
            "size": int(row.size or 0),
            "url": signed_url_for_blob(row.blob, row.title, MEDIA_TTL_SECONDS),
            "expires": expires,
        }
        for row in media_rows(current.name)
    ]


def export_document(principals: Principals, node: str, fmt: str | None = None) -> tuple[IO[bytes], str, str]:
    """Stream one readable document in a declared format, and name the file.

    §10.1's `export` is the only way a document's bytes leave Drive, and only
    the app can produce them. Drive authorizes the node, refuses a format the
    app did not offer, and hands back the guarded stream: nothing is stored,
    so nothing is charged.
    """
    current = _document_node(node)
    require(current, READ, principals)
    spec = spec_for(current.content_doctype)
    if not spec.export or not spec.export_formats:
        raise DriveConflict(_("This Drive content type cannot be exported"))
    chosen = fmt or spec.default_export
    if chosen is None:
        raise DriveConflict(_("This Drive content type has no default export format"))
    if not isinstance(chosen, str) or chosen not in spec.export_formats:
        frappe.throw(
            _("Drive export format {0} is not offered for {1}").format(chosen, spec.doctype),
            frappe.ValidationError,
        )
    stream, mime = call_app_stream(spec.export, current.content_docname, chosen)
    return stream, mime, f"{current.title}.{chosen}"


def media_rows(node: str, *, for_update: bool = False) -> list[frappe._dict]:
    """Return the Active blob-backed children of one document node."""
    return frappe.db.sql(
        f"""
        SELECT {", ".join(f"`{field}`" for field in MEDIA_ROW_FIELDS)}
        FROM `tabDrive Node`
        WHERE parent = %(node)s AND state = 'Active' AND kind = 'file' AND `blob` IS NOT NULL
        ORDER BY creation, name
        {"FOR UPDATE" if for_update else ""}
        """,
        {"node": node},
        as_dict=True,
    )


def sweep_unused_media() -> dict:
    """Trash media a content document has not named for seven days (§10.6).

    Drive owns the whole mechanism and the app answers one question. A content
    type that declares no `used_nodes` is skipped and its media is never
    swept. What is found is trashed, never purged: it lands in the owner's bin
    and follows the ordinary 30-day clock, so nothing removes a person's
    content without showing it to them first.

    One document per transaction. A failing `used_nodes` answer is logged and
    skipped, never the whole pass. One pass reads batches until it reaches the
    newest changed document, so a busy site never falls behind the cursor.
    """
    declared = tuple(sorted(doctype for doctype, spec in registry().items() if spec.used_nodes))
    if not declared:
        return {"documents": 0, "trashed": 0, "skipped": 0, "failed": 0, "cursor": None}

    after_modified, after_name = _sweep_cursor()
    documents = trashed = skipped = failed = 0
    cursor = None
    for _batch in range(MEDIA_SWEEP_BATCHES):
        rows = _swept_documents(declared, after_modified, after_name)
        if not rows:
            break
        for row in rows:
            spec = registry().get(row.content_doctype)
            if spec is None or not spec.used_nodes:
                skipped += 1
                continue
            try:
                count = _sweep_document(spec, row)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                failed += 1
                frappe.log_error("Drive: could not sweep one document's media", frappe.get_traceback())
                continue
            documents += 1
            trashed += count

        last = rows[-1]
        after_modified, after_name = str(last.content_modified), last.name
        cursor = last.name
        frappe.cache().set_value(
            _sweep_cursor_key(),
            frappe.as_json({"content_modified": after_modified, "name": after_name}),
        )
        if len(rows) < MEDIA_SWEEP_BATCH:
            break
    return {
        "documents": documents,
        "trashed": trashed,
        "skipped": skipped,
        "failed": failed,
        "cursor": cursor,
    }


def copy_document_media(
    principals: Principals,
    source_document: str,
    target_document: Mapping,
    *,
    destination_link: str | None,
) -> dict[str, str]:
    """Copy one document's media under its copy and answer the id remapping.

    Inside one document, one media node per blob: the same picture pasted
    twice reuses the node, so a logo on twenty slides is one node and one
    charge. Every source node id maps to the reused node, so the app's own
    references all resolve.

    The caller has already admitted the bytes and holds the destination's
    locks. It calls this before the app's `remap_media`.
    """
    # Imported here, not at the top: `previews` pulls in PIL, and importing
    # `suite.drive` for byte accounting alone must not load it.
    from suite.drive._core.nodes import _insert_node
    from suite.drive._core.previews import copy_preview

    remapped: dict[str, str] = {}
    by_blob: dict[str, str] = {}
    for row in media_rows(source_document):
        reused = by_blob.get(row.blob)
        if reused is not None:
            remapped[row.name] = reused
            continue
        copied = _insert_node(
            principals,
            target_document,
            title=row.title,
            kind="file",
            blob=row.blob,
            size=int(row.size or 0),
            mime=row.mime,
            content_modified=row.content_modified,
        )
        add_creator_grant(copied, target_document, principals, via_link=destination_link)
        # §8.9: a preview row is copied against the same blob, so the copy
        # looks right at once instead of waiting for the daily gap sweep.
        copy_preview(row.name, copied.name)
        by_blob[row.blob] = copied.name
        remapped[row.name] = copied.name
    return remapped


def reuse_media(document_node: str, blob: str, *, for_update: bool = False) -> str | None:
    """Answer the media node already holding one blob under a document (§8.9).

    "Inside one document, one media node per blob" is the rule the copy path has
    always kept. Upload and cross-deck paste land on the same document, so they
    answer through here rather than adding a second node and a second charge for
    bytes the deck already pays for.
    """
    for row in media_rows(document_node, for_update=for_update):
        if row.blob == blob:
            return row.name
    return None


def adopt_media(principals: Principals, document_node: str, media_nodes: Iterable[str]) -> dict[str, str]:
    """Bring media from other content documents under this one (§8.9).

    This is the workflow `nodes._validate_generic_destination` names when it
    refuses an ordinary copy of media below a content document: pasting a slide
    from another deck has to carry that slide's pictures, and an ordinary copy
    would put them somewhere no document owns.

    Blobs are shared and no byte is copied. Every reference still pays (§7.1),
    so the destination root is charged once per blob it did not already hold.
    Inside the destination, one media node per blob: pasting the same picture
    twice reuses the node.

    Answers `{source_node: node_under_this_document}` for every id it resolved,
    including an identity mapping for a source that already lives here. Two ids
    are left out of the answer rather than refusing the whole paste:

    - one that names no node, because an app body holds colours and legacy URLs
      beside node ids and a paste must not die on one;
    - one the caller cannot read, because §8.9 skips unreadable children.

    An id that names a node which is not active media below a content document
    is a caller error, not a body value, and is refused.
    """
    from suite.drive._core.nodes import _insert_node, _rollback_savepoint, _validate_stored_position
    from suite.drive._core.previews import copy_preview
    from suite.drive._core.quota import admit

    # The gate runs even for a paste that names no media. Returning early
    # before it would leave the caller's endpoint with no check of its own, and
    # answer a stranger where a refusal belongs. §8.8's trash rule is part of
    # the gate for the same reason: a bin opens read-only, and a paste of
    # nothing is still a paste.
    gate = _document_node(document_node)
    require(gate, UPLOAD, principals)
    _refuse_trashed_write(gate, UPLOAD)

    requested = tuple(dict.fromkeys(node for node in media_nodes if isinstance(node, str) and node))
    if not requested:
        return {}

    savepoint = f"drive_adopt_media_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        target = _document_node(document_node, for_update=True)
        via_link = require(target, UPLOAD, principals)
        _refuse_trashed_write(target, UPLOAD)
        _validate_stored_position(target, for_update=True)

        by_blob = {row.blob: row.name for row in media_rows(target.name, for_update=True)}
        remapped: dict[str, str] = {}
        for node in requested:
            source = frappe.db.get_value("Drive Node", node, MEDIA_SOURCE_FIELDS, as_dict=True)
            if not source:
                continue
            try:
                require(source, READ, principals)
            except (DriveNotFound, DriveForbidden, DriveLocked, DriveLinkExpired):
                # Every "you cannot read this" answer skips the id. `require`
                # raises `DriveLocked` and `DriveLinkExpired` before it decides
                # the role, so catching `DriveNotFound` alone let one expired
                # link in the chain refuse a whole paste.
                continue
            # After the read check, never before it. A caller with no grant must
            # not learn from the refusal that the id names a folder rather than
            # nothing at all (§5.4). Only a node the caller can already see is
            # answered as a caller error.
            if source.state != "Active":
                continue
            _validate_adoptable_media(source)
            reused = by_blob.get(source.blob)
            if reused is not None:
                remapped[node] = reused
                continue
            admit(target.root, int(source.size or 0))
            copied = _insert_node(
                principals,
                target,
                title=source.title,
                kind="file",
                blob=source.blob,
                size=int(source.size or 0),
                mime=source.mime,
                content_modified=source.content_modified,
            )
            add_creator_grant(copied, target, principals, via_link=via_link)
            copy_preview(source.name, copied.name)
            by_blob[source.blob] = copied.name
            remapped[node] = copied.name
    except Exception as exc:
        _rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return remapped


def _validate_adoptable_media(source: Mapping) -> None:
    """Refuse an id that names a node no document may adopt.

    A missing id is a body value, not an error, and is skipped by the caller. An
    id that resolves to a folder, a document, or a file with no blob is a caller
    error: node names are opaque hashes, so a colour or a URL never reaches here.

    The ancestor check is what makes the message true. Without it an ordinary
    file anywhere in the caller's Drive could enter a deck as media, which is
    the move `_validate_generic_destination` refuses in the other direction.
    """
    from suite.drive._core.nodes import _has_document_ancestor

    if source.get("kind") != "file" or not source.get("blob") or not _has_document_ancestor(source):
        raise DriveConflict(_("Only media below a Drive content document can be adopted"))


def copyable_media_bytes(document_nodes: Iterable[str]) -> int:
    """Return the bytes one copy owes for the media it will reuse per blob."""
    total = 0
    for node in document_nodes:
        seen: set[str] = set()
        for row in media_rows(node):
            if row.blob in seen:
                continue
            seen.add(row.blob)
            total += int(row.size or 0)
    return total


def _sweep_document(spec: ContentTypeSpec, row: frappe._dict) -> int:
    from suite.drive._core.nodes import _trash

    answer = call_app(spec.used_nodes, row.content_docname)
    used = _validated_used_nodes(answer)
    cutoff = now_datetime() - timedelta(days=UNUSED_MEDIA_GRACE_DAYS)
    system = Principals("Administrator", ("Administrator",), (), is_admin=True)
    trashed = 0
    for media in media_rows(row.name):
        if media.name in used or media.creation >= cutoff:
            continue
        _trash(system, media.name)
        trashed += 1
    return trashed


def _validated_used_nodes(answer) -> set[str]:
    if not isinstance(answer, set | frozenset | tuple | list):
        raise DriveConflict(_("The Drive content used_nodes callback returned an invalid answer"))
    used = set(answer)
    if any(not isinstance(item, str) or not item for item in used):
        raise DriveConflict(_("The Drive content used_nodes callback returned an invalid answer"))
    return used


def _swept_documents(declared: tuple[str, ...], after_modified, after_name) -> list[frappe._dict]:
    return frappe.db.sql(
        """
        SELECT name, content_doctype, content_docname, content_modified
        FROM `tabDrive Node`
        WHERE kind = 'document'
          AND state = 'Active'
          AND content_doctype IN %(declared)s
          AND content_docname IS NOT NULL
          AND content_modified IS NOT NULL
          AND (
              %(after_modified)s IS NULL
              OR content_modified > %(after_modified)s
              OR (content_modified = %(after_modified)s AND name > %(after_name)s)
          )
        ORDER BY content_modified, name
        LIMIT %(batch)s
        """,
        {
            "declared": declared,
            "after_modified": after_modified,
            "after_name": after_name,
            "batch": MEDIA_SWEEP_BATCH,
        },
        as_dict=True,
    )


def _sweep_cursor() -> tuple[str | None, str | None]:
    raw = frappe.cache().get_value(_sweep_cursor_key())
    if not raw:
        return None, None
    try:
        value = frappe.parse_json(raw)
    except (TypeError, ValueError):
        return None, None
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("content_modified"), str)
        or not isinstance(value.get("name"), str)
    ):
        return None, None
    return value["content_modified"], value["name"]


def _sweep_cursor_key() -> str:
    site = getattr(frappe.local, "site", None) or "no-site"
    return f"{MEDIA_SWEEP_CURSOR_KEY}:{site}"


def _document_node(node: str, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Node",
        node,
        DOCUMENT_NODE_FIELDS,
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive node {0} was not found").format(node))
    if row.kind != "document":
        raise DriveConflict(_("That Drive node is not a content document"))
    return row
