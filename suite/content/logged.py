"""What a document in a log gives Drive's callbacks, the same for every app: `with_content` calls these
around the app's own callbacks, which keep only the app's row."""

import base64
import dataclasses
import gzip
import io
import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import IO, cast

import frappe
import pycrdt
from frappe import _

from suite import drive
from suite.content import (
    capacity,
    compaction,
    copies,
    jobs,
    live,
    log,
    scheduling,
    tables,
    updates,
)
from suite.content.app_row import forget_cached, locked_app_row, write_copy
from suite.content.backfill import backfill_clocks
from suite.content.checkpoints import replace_start
from suite.content.editors import editors, for_type, spec_of, wrapped
from suite.content.snapshot import Snapshot, read

# The update format of every state the layer keeps
CODEC = "yjs1"

HTML_FORMAT = "html"
HTML_MIME = "text/html"
VERSION_MIME = "application/json"


class NotReady(Exception):
    """The document's log can't answer now; what stopped it is the cause."""


class UnreadableBody(frappe.ValidationError):
    """A state the app's media functions refused to read."""


def version_record(app: str, snapshot: Snapshot, state: bytes) -> dict:
    """`state` as an `{app}-document/2` version; `html` stays null."""
    compressed = gzip.compress(state)
    encoded_state = base64.b64encode(compressed).decode("ascii")
    return {
        "schema": f"{app}-document/2",
        "codec": CODEC,
        "lineage": snapshot.lineage,
        "through_rev": snapshot.head_rev,
        "chain": snapshot.head_chain.hex(),
        "state": encoded_state,
        "html": None,
    }


def record_prefix(app: str) -> bytes:
    """Return the bytes every version `version` answers for `app` starts with."""
    schema_only = json.dumps({"schema": f"{app}-document/2"})
    return schema_only[:-1].encode("utf-8")


def ensure_tables() -> None:
    """Make every app's tables, and give the documents in them their clocks; on install and migrate."""
    for spec in editors().values():
        tables.ensure_tables(spec.app)
        backfill_clocks(spec.app)


def start(app: str, node: str) -> None:
    """Make a new document collaborative from its first edit, while collaboration is on."""
    if log.enabled(app):
        log.create(app, node)


def copy(app: str, source_node: str, node: str) -> None:
    """Start `node`'s log from `source_node`'s state now, under a new lineage, when the source is in a log."""
    try:
        source_checkpoint = live_checkpoint(app, source_node)
    except (log.ChainBroken, compaction.CompactionFailed) as unready:
        raise NotReady() from unready

    if source_checkpoint is None:
        return

    log_read, state = source_checkpoint
    doc_id = log.create(app, node)
    replace_start(app, doc_id, state, log_read.schema)


def html(app: str, node: str) -> str | None:
    """Return `node`'s readable copy, or None without a log; `NotReady` while no copy covers its head."""
    doc = log.find(app, node)
    if not doc:
        return None

    readable_copy = copies.readable_copy(app, doc.id)
    if readable_copy is None:
        raise NotReady()

    return readable_copy


def version(app: str, node: str) -> bytes | None:
    """`node`'s log now as a version, with the pictures it shows, or None when it has none."""
    try:
        checkpoint = live_checkpoint(app, node)
    except (log.ChainBroken, compaction.CompactionFailed) as unready:
        raise NotReady() from unready

    if checkpoint is None:
        return None

    snapshot, state = checkpoint
    record = version_record(app, snapshot, state)
    media = spec_of(app).media
    if media is not None:
        with readable_state():
            record["media"] = sorted(media.node_ids(state))

    return json.dumps(record).encode("utf-8")


def media_ids(app: str, node: str) -> set[str]:
    """Load the pictures `node`'s log names; an unreadable log raises, and Drive's sweep skips it."""
    media = spec_of(app).media
    if media is None:
        return set()

    with readable_state():
        state = live_state(app, node)
        if state is None:
            return set()

        return set(media.node_ids(state.get_update()))


def remap(app: str, node: str, mapping: dict[str, str]) -> bool:
    """Point a copied log and its readable copy at Drive's new pictures, row locked first; False if none."""
    doc = log.find(app, node)
    if not doc:
        return False

    spec = spec_of(app)
    if spec.media is None:
        return True

    with readable_state():
        rewrite = spec.media.value_rewriter(mapping)

    def guarded_rewrite(value: str) -> str:
        with readable_state():
            return rewrite(value)

    html_copy = spec.readable_copy
    if html_copy is not None:
        app_row = locked_app_row(app, doc.id, html_copy)
        if app_row is not None:
            rewritten = {key: guarded_rewrite(value) for key, value in app_row.written.items()}
            changed = {key: value for key, value in rewritten.items() if value != app_row.written[key]}
            if changed:
                write_copy(app, app_row.name, changed, html_copy)

            forget_cached(app, app_row.name)

    try:
        remap_log(app, node, guarded_rewrite)
    except (ValueError, log.ChainBroken, compaction.CompactionFailed) as refused:
        raise NotReady() from refused

    return True


def purge(app: str, node: str) -> None:
    """Mark `node`'s log purged in Drive's transaction, for a job to delete its rows once that commits."""
    # A refused conversion leaves a record and no log, so the record goes by node
    conversion_table = tables.table(app, "conversion")
    frappe.db.sql(f"DELETE FROM `{conversion_table}` WHERE `node` = %s", node)
    doc_id = log.mark_purged(app, node)
    if doc_id:
        scheduling.enqueue(
            jobs.DELETE_PURGED,
            f"suite-collab-purge-{app}-{doc_id}",
            app=app,
            doc_id=doc_id,
            enqueue_after_commit=True,
        )


def threads_changed(app: str, node: str) -> None:
    """Tell the document's open tabs to read its comment threads again."""
    doc = log.find(app, node)
    if doc:
        live.publish_control(app, doc.id, doc.lineage, kind="threads")


def live_state(app: str, node: str) -> pycrdt.Doc | None:
    """Load the log as the caller's transaction sees it, on or off, so the media sweep keeps its pictures."""
    doc = log.find(app, node)
    if not doc:
        return None

    log_read = read(app, doc.id, own_snapshot=False)
    if log_read is None:
        return None

    checkpoint_part: list[bytes] = []
    if log_read.checkpoint:
        checkpoint_part = [log_read.checkpoint]

    row_parts = log_read.payloads()
    parts = checkpoint_part + row_parts
    return compaction.load_doc(parts)


def live_checkpoint(app: str, node: str) -> tuple[Snapshot, bytes] | None:
    """Compact the log's state now, on or off, refusing a fallback and what a compaction job wouldn't take."""
    doc = log.find(app, node)
    if not doc:
        return None

    log_read = read(app, doc.id, integrated=True, own_snapshot=False)
    if log_read is None:
        return None

    rows = log_read.payloads()
    if not rows:
        return log_read, log_read.checkpoint or pycrdt.Doc().get_update()

    # pycrdt cannot be interrupted, so a web worker only takes on what a compaction job would
    total_bytes = len(log_read.checkpoint or b"") + sum(len(row) for row in rows)
    too_big = total_bytes > capacity.STATE_MAX
    too_many_rows = len(rows) > scheduling.TAIL_ROWS
    if too_big or too_many_rows:
        raise compaction.CompactionFailed("too_large")

    part_map = spec_of(app).part_map
    compacted = compaction.compact(log_read.checkpoint, rows, part_map)
    if not compacted.integrated:
        raise compaction.CompactionFailed("fallback")

    return log_read, compacted.state


def remap_log(app: str, node: str, rewrite: Callable[[str], str]) -> None:
    """Rewrite the values a copied log starts from, refusing a result that isn't the rewritten copy."""
    doc = log.find(app, node)
    if not doc:
        return

    log_read = read(app, doc.id, own_snapshot=False)
    if log_read is None:
        return

    part_map = spec_of(app).part_map
    state = log_read.checkpoint
    # `copy` starts every copied log from a body
    assert state is not None

    remapped = updates.rewrite_values(state, rewrite)
    if remapped == state:
        return

    original_doc = compaction.load_doc([state])
    remapped_doc = compaction.load_doc([remapped])
    if (
        compaction.vector_and_deletes(remapped_doc) != compaction.vector_and_deletes(original_doc)
        or compaction.content_json(remapped_doc, part_map)
        != compaction.content_json(original_doc, part_map, rewrite)
        or updates.rewrite_values(remapped, rewrite) != remapped
    ):
        raise compaction.CompactionFailed("remap_mismatch")

    replace_start(app, doc.id, remapped, log_read.schema)


@contextmanager
def readable_state() -> Iterator[None]:
    """Raise what the app's media functions raise as `UnreadableBody`, as pycrdt's panics pass `Exception`."""
    try:
        yield
    except (KeyboardInterrupt, SystemExit, UnreadableBody):
        raise
    except BaseException as unreadable:
        raise UnreadableBody(_("This document body cannot be read")) from unreadable


class ContentCallbacks:
    """A spec's row-only callbacks, each with the content layer's branch for a document in a log around it."""

    def __init__(self, spec: drive.ContentTypeSpec) -> None:
        self.spec = spec
        self.base_export = declared(spec.export, "export")
        self.base_version_bytes = declared(spec.version_bytes, "version_bytes")
        self.base_restore_version = declared(spec.restore_version, "restore_version")
        self.base_on_purge = declared(spec.on_purge, "on_purge")
        self.base_used_nodes = declared(spec.used_nodes, "used_nodes")
        self.base_remap_media = declared(spec.remap_media, "remap_media")

    def app(self) -> str:
        """Return the app whose editor keeps the spec's doctype."""
        found = for_type(self.spec.doctype)
        if found is None:
            raise frappe.DoesNotExistError(f"No editor for the content type {self.spec.doctype}")

        return found.app

    def node_of(self, docname: str, *, lock: bool = False) -> str | None:
        """Load the node the app's row `docname` belongs to; `lock` locks the row first, before its log's."""
        return frappe.db.get_value(self.spec.doctype, docname, self.spec.node_field, for_update=lock)

    def create_empty(self, node: str) -> str:
        """Create the app's row, and the document's log while collaboration is on."""
        docname = self.spec.create_empty(node)
        start(self.app(), node)
        return docname

    def duplicate(self, source_docname: str, node: str) -> str:
        """Copy the app's row, and the source's log when it has one."""
        docname = self.spec.duplicate(source_docname, node)
        source_node = self.node_of(source_docname)
        try:
            if source_node:
                copy(self.app(), source_node, node)
        except NotReady as unready:
            raise drive.DriveConflict(_("This document cannot be copied right now")) from unready

        return docname

    def export(self, docname: str, file_format: str) -> tuple[IO[bytes], str]:
        """Export the document, as its log's readable copy when it is HTML from a log."""
        node = self.node_of(docname)
        if file_format != HTML_FORMAT or not node:
            return self.base_export(docname, file_format)

        try:
            exported = html(self.app(), node)
        except NotReady as stale:
            raise drive.DriveConflict(_("Open the document to refresh its export")) from stale

        if exported is None:
            return self.base_export(docname, file_format)

        return io.BytesIO(exported.encode("utf-8")), HTML_MIME

    def version_bytes(self, docname: str) -> tuple[IO[bytes], str]:
        """Answer the document as a version, from its log when it has one."""
        node = self.node_of(docname)
        try:
            if node:
                record = version(self.app(), node)
            else:
                record = None
        except NotReady as unready:
            raise drive.DriveConflict(
                _("Version history is not available for this document right now")
            ) from unready

        if record is None:
            return self.base_version_bytes(docname)

        return io.BytesIO(record), VERSION_MIME

    def restore_version(self, docname: str, stream: IO[bytes]) -> None:
        """Restore a version into the app's row, refusing a document in a log and a log's version."""
        node = self.node_of(docname, lock=True)
        if node and log.find(self.app(), node, for_update=True):
            raise drive.DriveConflict(_("Open the document to restore this version"))

        prefix = record_prefix(self.app())
        head = read_head(stream, len(prefix))
        if head == prefix:
            raise drive.DriveConflict(_("This version can be restored once the document is converted"))

        self.base_restore_version(docname, cast(IO[bytes], ReplayedStream(head, stream)))

    def on_purge(self, docname: str) -> None:
        """Mark the document's log purged, then purge the app's row."""
        # No waiting app-row lock: delete_doc takes it NOWAIT, so a purge stays refusable
        node = self.node_of(docname)
        if node:
            purge(self.app(), node)

        self.base_on_purge(docname)

    def used_nodes(self, docname: str) -> set[str]:
        """Return the nodes the app's row uses, with the pictures its log names."""
        row_ids = self.base_used_nodes(docname)
        node = self.node_of(docname)
        if not node:
            return row_ids

        return row_ids | media_ids(self.app(), node)

    def remap_media(self, docname: str, mapping: dict[str, str]) -> None:
        """Point the document at Drive's new pictures, in its log or else in the app's row."""
        if not mapping:
            return

        node = self.node_of(docname)
        try:
            if node:
                remapped = remap(self.app(), node, mapping)
            else:
                remapped = False
        except NotReady as refused:
            raise drive.DriveConflict(_("The copy's pictures could not be moved to it")) from refused

        if not remapped:
            self.base_remap_media(docname, mapping)

    def on_threads_changed(self, node: str) -> None:
        """Tell the document's open tabs its comment threads changed."""
        threads_changed(self.app(), node)


def with_content(spec: drive.ContentTypeSpec) -> drive.ContentTypeSpec:
    """`spec` with the content layer's branch for a document in a log around each row-only callback."""
    callbacks = ContentCallbacks(spec)
    wrapped.add(spec.doctype)
    return dataclasses.replace(
        spec,
        create_empty=callbacks.create_empty,
        duplicate=callbacks.duplicate,
        export=callbacks.export,
        version_bytes=callbacks.version_bytes,
        restore_version=callbacks.restore_version,
        on_purge=callbacks.on_purge,
        used_nodes=callbacks.used_nodes,
        remap_media=callbacks.remap_media,
        threads_changed=callbacks.on_threads_changed,
    )


def declared[T](callback: T | None, name: str) -> T:
    """Return `callback`, which a spec wrapped for the content layer must declare."""
    if callback is None:
        raise ValueError(f"A spec wrapped for the content layer must declare {name}")

    return callback


def read_head(stream: IO[bytes], size: int) -> bytes:
    """Up to the first `size` bytes of `stream`, fewer only at its end."""
    head = b""
    for _attempt in range(size):
        part = stream.read(size - len(head))
        head += part
        if not part or len(head) == size:
            break

    return head


class ReplayedStream:
    """`stream` read again from its start: the `head` already read from it, then the rest."""

    def __init__(self, head: bytes, stream: IO[bytes]) -> None:
        self.head = head
        self.stream = stream

    def read(self, size: int = -1) -> bytes:
        """Read up to `size` bytes, the head first; all that is left when `size` is negative."""
        if size is None or size < 0:
            data = self.head + self.stream.read()
            self.head = b""
            return data

        data = self.head[:size]
        self.head = self.head[size:]
        if len(data) < size:
            data += self.stream.read(size - len(data))

        return data
