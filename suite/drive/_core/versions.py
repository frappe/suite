"""Drive-owned immutable version history and retention workflows."""

import time
from collections.abc import Mapping
from contextlib import closing
from datetime import datetime, timedelta
from uuid import uuid4

import frappe
from frappe import _
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.storage.url import signed_url_for_blob
from frappe.utils import get_datetime, now_datetime

from suite.drive._core import content, previews
from suite.drive._core.access import require
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveNotFound,
    rollback_savepoint,
)
from suite.drive._core.nodes import (
    CONTENT_TTL_SECONDS,
    DEFAULT_PAGE_SIZE,
    _node,
    _record_activity,
    _validate_existing_head,
    decode_cursor,
    page_limit,
    page_of,
)
from suite.drive._core.principals import Principals
from suite.drive._core.quota import admit, release
from suite.drive._core.roles import EDIT, MANAGE, READ
from suite.drive._core.roots import reject_illegal_root_operation

VERSION_FIELDS = (
    "name",
    "node",
    "seq",
    "kind",
    "label",
    "pinned",
    "actor",
    "size",
    "blob",
    "creation",
)
VERSION_KINDS = ("auto", "named", "milestone")

# "Leave this column as it is". A PATCH that names one of the two mutable
# fields must not clear the other (§9.1), and `None` cannot say so: it is the
# value that clears a label.
KEEP = object()

# Tier transitions are lower-bound inclusive, matching "under 24 h" then
# "24 h to 7 d" in the accepted ladder. Exactly 90 days remains weekly;
# only versions older than that final bound are removed.
DEFAULT_LADDER = {
    "keep_all_hours": 24,
    "hourly_until_hours": 24 * 7,
    "daily_until_hours": 24 * 30,
    "weekly_until_hours": 24 * 90,
}


def take_version(
    principals: Principals,
    node: str,
    *,
    kind: str = "auto",
    label: str | None = None,
) -> int:
    """Capture one file head or content document body as immutable bytes."""
    _validate_kind_and_label(kind, label)
    current = _node(node, for_update=True)
    via_link = require(current, EDIT, principals)
    _require_content_version_node(current)

    blob, size = _version_bytes(current)
    savepoint = f"drive_take_version_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        admit(current.root, size)
        seq = _insert_version(
            current,
            principals,
            blob=blob,
            size=size,
            kind=kind,
            label=label,
        )
        _record_activity(
            current.name,
            "edit",
            principals,
            {"blob": blob, "size": size, "version": seq},
            via_link=via_link,
        )
    except Exception as exc:
        # Content bytes are stored before this savepoint. On a refused write
        # their unreferenced File Blob row is deliberately left for framework
        # GC, just like a finalized upload whose Drive admission fails.
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return seq


def list_versions(
    principals: Principals,
    node: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> dict:
    """Page one readable node's versions, newest sequence first (§11.4)."""
    current = _node(node)
    require(current, READ, principals)
    _require_version_node(current)
    window = page_limit(limit)
    offset = decode_cursor(cursor)
    rows = frappe.get_all(
        "Drive Node Version",
        filters={"node": current.name},
        fields=VERSION_FIELDS,
        order_by="seq desc",
        limit=window,
        start=offset,
    )
    return page_of(rows, offset, len(rows), window)


def read_version(principals: Principals, node: str, seq: int):
    """Answer one readable version's stored bytes as a stream, after a READ check.

    `version_content_url` above mints a signed URL for a browser. An app that
    wrote the bytes with its own `version_bytes` needs them in the process,
    to publish its own history without a round trip through `/f/`. The node
    is checked, not the version row: a version belongs to its node and carries
    no grant of its own (§9.1), and `_validated_version_blob` refuses bytes
    that are missing, public, or a different size than the row claims.
    """
    _validate_seq(seq)
    current = _node(node)
    require(current, READ, principals)
    _require_version_node(current)
    version = _version(current.name, seq)
    blob = _validated_version_blob(version)
    return get_driver(blob.driver).read(blob.key, is_private=bool(blob.is_private))


def version_content_url(
    principals: Principals,
    node: str,
    seq: int,
    *,
    expires_in: int = CONTENT_TTL_SECONDS,
) -> dict:
    """Mint one readable version's signed `/f/` URL after a READ check (§6.8).

    The node is checked, not the version row: a version belongs to its node and
    carries no grant of its own. `_validated_version_blob` then refuses bytes
    that are missing, public, or a different size than the row claims, so a
    signature is only ever minted over the exact blob the history recorded.

    LIMITATION: `Drive Node Version` has no MIME column (§3.4) and the version
    blob was written without one, so on a driver that presigns the object
    directly the download arrives as `application/octet-stream`. `versions.py`
    records the same handoff where the blob is written.
    """
    _validate_seq(seq)
    current = _node(node)
    require(current, READ, principals)
    _require_version_node(current)
    version = _version(current.name, seq)
    _validated_version_blob(version)
    return {
        "url": signed_url_for_blob(
            version.blob,
            content.download_filename(_version_filename(current, version)),
            expires_in,
        ),
        "expires": int(time.time()) + expires_in,
    }


def _version_filename(node: frappe._dict, version: frappe._dict) -> str:
    """Name a downloaded version after its node and its sequence."""
    label = str(version.seq)
    title = (node.title or "download").strip() or "download"
    stem, dot, suffix = title.rpartition(".")
    if dot and stem:
        return f"{stem} (v{label}).{suffix}"
    return f"{title} (v{label})"


def label_version(
    principals: Principals,
    node: str,
    seq: int,
    *,
    label: str | None | object = KEEP,
    pinned: bool | object = KEEP,
) -> dict:
    """Mutate only the user-controlled label and retention pin.

    An argument left at `KEEP` is not written. §9.1 makes `pinned` a retention
    exemption - a pinned version is never thinned - so a caller who renamed a
    milestone and said nothing about the pin must not silently lose it, and a
    caller who pinned one must not silently lose its name.

    Answers both stored values, so `PATCH /nodes/<id>/versions/<seq>` publishes
    what the row now holds rather than what the request happened to name.
    """
    _validate_seq(seq)
    if label is not KEEP and label is not None and not isinstance(label, str):
        frappe.throw(_("A Drive version label must be text or null"), frappe.ValidationError)
    if pinned is not KEEP and not isinstance(pinned, bool):
        frappe.throw(_("A Drive version pin must be true or false"), frappe.ValidationError)
    if label is KEEP and pinned is KEEP:
        frappe.throw(_("A Drive version change must name a label or a pin"), frappe.ValidationError)

    savepoint = f"drive_label_version_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        require(current, EDIT, principals)
        # Trashed is allowed. §8.8 opens a trashed document read-only, which
        # covers its body; a label and a pin are retention metadata on the
        # history table and §9.1 gives this call EDIT as its one condition.
        _require_version_node(current)
        version = _version(current.name, seq, for_update=True)
        changes = {}
        if label is not KEEP:
            changes["label"] = label
        if pinned is not KEEP:
            changes["pinned"] = int(pinned)
        frappe.db.set_value("Drive Node Version", version.name, changes)
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return {
        "label": changes.get("label", version.label),
        "pinned": changes.get("pinned", int(version.pinned or 0)),
    }


def delete_version(principals: Principals, node: str, seq: int) -> None:
    """Delete one managed version and release its logical byte charge."""
    _validate_seq(seq)
    savepoint = f"drive_delete_version_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        require(current, MANAGE, principals)
        # Trashed is allowed. §7.1 makes deleting a version the way to free
        # its bytes, and the daily thinner already removes a trashed node's
        # auto history, so MANAGE must be able to do the same by hand.
        _require_version_node(current)
        version = _version(current.name, seq, for_update=True)
        frappe.db.delete("Drive Node Version", {"name": version.name})
        release(current.root, int(version.size or 0))
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)


def restore_version(principals: Principals, node: str, seq: int) -> int:
    """Capture the current state, then restore an earlier immutable version.

    Returns the sequence captured before the restore. A zero-byte file head
    is the one exception and returns 0 because no version row is created.
    """
    _validate_seq(seq)
    current = _node(node, for_update=True)
    via_link = require(current, EDIT, principals)
    _require_content_version_node(current)
    target = _version(current.name, seq, for_update=True)
    target_blob = _validated_version_blob(target)

    current_blob = None
    current_size = 0
    content_spec = None
    if current.kind == "file":
        _validate_existing_head(current)
        if current.blob and int(current.size or 0) > 0:
            current_blob, current_size = current.blob, int(current.size)
    else:
        content_spec = _content_spec(current, require_restore=True)
        current_blob, current_size = _version_bytes(current, spec=content_spec)

    savepoint = f"drive_restore_version_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        captured_seq = 0
        if current_blob:
            # A file head was already charged. Its charge moves to this row;
            # content document bodies were free, so their captured bytes are
            # a new logical reference and must be admitted.
            if current.kind == "document":
                admit(current.root, current_size)
            captured_seq = _insert_version(
                current,
                principals,
                blob=current_blob,
                size=current_size,
                kind="auto",
                label=None,
            )

        if current.kind == "file":
            # The target version remains charged. Repointing the head creates
            # one additional logical reference of exactly the target's size.
            admit(current.root, int(target.size or 0))
            if target_blob.name != current.blob:
                # A repoint changes the head bytes, so it invalidates the
                # preview exactly as replace does (§8.5 step 5, §9.2). A
                # restore that lands on the same blob keeps a preview that is
                # still correct. Lock order stays Drive Node, Drive Node
                # Version, Drive Root, then Drive Node Preview; the render is
                # queued, never run inline, so it takes no lock here.
                frappe.db.delete("Drive Node Preview", {"node": current.name})
                previews.enqueue_render(current.name)
            frappe.db.set_value(
                "Drive Node",
                current.name,
                {
                    "blob": target_blob.name,
                    "size": int(target.size or 0),
                    "mime": target_blob.mime_type,
                    "content_modified": now_datetime(),
                },
            )
        else:
            with get_driver(target_blob.driver).read(
                target_blob.key, is_private=bool(target_blob.is_private)
            ) as stream:
                content.call_app(content_spec.restore_version, current.content_docname, stream)
            frappe.db.set_value("Drive Node", current.name, "content_modified", now_datetime())

        _record_activity(
            current.name,
            "edit",
            principals,
            {
                "blob": target_blob.name,
                "size": int(target.size or 0),
                "version": captured_seq or None,
            },
            via_link=via_link,
        )
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return captured_seq


def thin(ladder: dict | None = None) -> dict:
    """Remove eligible automatic history and release every removed charge.

    One node per transaction. §7.2 makes the `Drive Root` row UPDATE the quota
    lock, so a daily pass must not hold that row across every node it visits:
    that would block admission for every writer on the site for the length of
    the run. One failing node is logged and skipped, never the whole pass.
    """
    policy = _normalized_ladder(ladder)
    now = now_datetime()
    cutoff = now - timedelta(hours=policy["keep_all_hours"])
    nodes = frappe.db.sql(
        """
        SELECT DISTINCT v.node
        FROM `tabDrive Node Version` v
        JOIN `tabDrive Node` n ON n.name = v.node
        WHERE v.kind = 'auto' AND v.pinned = 0 AND v.creation <= %(cutoff)s
        ORDER BY v.node
        """,
        {"cutoff": cutoff},
        pluck=True,
    )

    scanned = deleted = released_bytes = failed = 0
    for node in nodes:
        try:
            result = _thin_node(node, now, policy)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            failed += 1
            frappe.log_error("Drive: could not thin one node's version history", frappe.get_traceback())
            continue
        scanned += result["scanned"]
        deleted += result["deleted"]
        released_bytes += result["released_bytes"]

    return {
        "nodes": len(nodes),
        "scanned": scanned,
        "deleted": deleted,
        "released_bytes": released_bytes,
        "failed": failed,
    }


def _thin_node(node: str, now: datetime, policy: Mapping[str, int]) -> dict:
    """Thin one node's automatic history under its row lock, and release bytes."""
    savepoint = f"drive_thin_versions_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        current = _node(node, for_update=True)
        rows = frappe.db.sql(
            """
            SELECT name, seq, creation, size
            FROM `tabDrive Node Version`
            WHERE node = %(node)s AND kind = 'auto' AND pinned = 0
            ORDER BY creation DESC, seq DESC
            FOR UPDATE
            """,
            {"node": current.name},
            as_dict=True,
        )
        removals = _pick_deletions(rows, now, policy)
        released = sum(int(row.size or 0) for row in removals)
        if removals:
            frappe.db.delete("Drive Node Version", {"name": ["in", tuple(row.name for row in removals)]})
            release(current.root, released)
    except DriveNotFound as exc:
        # The node was purged between the candidate query and this lock. Its
        # versions and their charge went with it (§9.1), so there is no work.
        rollback_savepoint(savepoint, exc)
        return {"scanned": 0, "deleted": 0, "released_bytes": 0}
    except Exception as exc:
        rollback_savepoint(savepoint, exc)
        raise
    else:
        frappe.db.release_savepoint(savepoint)
    return {"scanned": len(rows), "deleted": len(removals), "released_bytes": released}


def preserve_file_head(node: frappe._dict, principals: Principals) -> int:
    """Insert a replacement's already-charged nonempty head as auto history.

    The caller must already hold `node`'s row lock, because `_insert_version`
    allocates the next `seq` under it. `nodes._replace_file` is the only
    caller and takes that lock before it loads the node.
    """
    _validate_existing_head(node)
    if not node.blob or int(node.size or 0) <= 0:
        raise DriveConflict(_("A zero-byte Drive file head is not versioned during replacement"))
    return _insert_version(
        node,
        principals,
        blob=node.blob,
        size=int(node.size),
        kind="auto",
        label=None,
    )


def _version_bytes(node: frappe._dict, *, spec=None) -> tuple[str, int]:
    if node.kind == "file":
        _validate_existing_head(node)
        if not node.blob:
            raise DriveConflict(_("This Drive file has no bytes to version"))
        # A size-0 head is versioned here on purpose. §9.1's exception is
        # "a replaced head of size 0 is never kept", so it binds the two
        # old-head captures (`preserve_file_head` and restore), not a person
        # or an app asking for a version of the file as it stands.
        return node.blob, int(node.size or 0)
    if node.kind != "document":
        raise DriveConflict(_("Only Drive files and content documents have versions"))

    spec = spec or _content_spec(node)
    callback = getattr(spec, "version_bytes", None)
    if not callable(callback):
        raise DriveConflict(_("This Drive content type does not provide version bytes"))
    # `call_app_stream` runs the callback guarded and hands back a stream that
    # stays guarded, because `put_blob` below reads it after the call returned
    # and a lazily produced stream runs app code on every read (§10.1).
    stream, _mime = content.call_app_stream(callback, node.content_docname)
    # The declared MIME is checked as a contract shape (§10.1) and then
    # dropped. Drive cannot keep it: `Drive Node Version` has no MIME column
    # (§3.4) and `put_blob` sniffs the bytes with no caller override, so a
    # JSON or plain text body lands as `application/octet-stream`. §10.1
    # states the return type only and names no consumer, and §11.2 requires
    # only a 302 to a signed URL, so dropping it conforms.
    # LIMITATION: the served type is then driver-dependent. On the local
    # driver `frappe/storage/serve.py` recovers the type from the download
    # filename. On S3 it does not: `signed_url_for_blob` returns the driver
    # presigned URL, which sets `ResponseContentDisposition` and no
    # `ResponseContentType`, and the object was written with no `ContentType`.
    # A Writer version therefore downloads as octet-stream on S3.
    # HANDOFF, ticket 16 (§10.1) and ticket 22 (§11.2 version content
    # route). Fixing it needs a §3.4 MIME column or a framework
    # `put_blob(content_type=)`, so neither belongs to this ticket.
    with closing(stream):
        blob = put_blob(stream, is_private=True)
    return blob.name, int(blob.file_size)


def _content_spec(node: frappe._dict, *, require_restore: bool = False):
    """Resolve one document node's registered content type, or refuse."""
    if not node.content_doctype or not node.content_docname:
        raise DriveConflict(_("The Drive content document link is incomplete"))
    found = content.spec_for(node.content_doctype)
    if require_restore and not callable(found.restore_version):
        raise DriveConflict(_("This Drive content type cannot restore versions"))
    return found


def _insert_version(
    node: frappe._dict,
    principals: Principals,
    *,
    blob: str,
    size: int,
    kind: str,
    label: str | None,
) -> int:
    # Every compliant writer holds the node row lock before allocating. That
    # one stable lock serializes MAX(seq)+1 without a separate counter field.
    seq = int(
        frappe.db.sql(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM `tabDrive Node Version` WHERE node = %s",
            node.name,
        )[0][0]
    )
    frappe.get_doc(
        {
            "doctype": "Drive Node Version",
            "node": node.name,
            "seq": seq,
            "kind": kind,
            "label": label,
            "actor": principals.user,
            "size": size,
            "blob": blob,
        }
    ).insert(ignore_permissions=True)
    return seq


def _version(node: str, seq: int, *, for_update: bool = False) -> frappe._dict:
    row = frappe.db.get_value(
        "Drive Node Version",
        {"node": node, "seq": seq},
        VERSION_FIELDS,
        as_dict=True,
        for_update=for_update,
    )
    if not row:
        raise DriveNotFound(_("Drive version {0} was not found").format(seq))
    return row


def _validated_version_blob(version: frappe._dict) -> frappe._dict:
    row = frappe.db.get_value(
        "File Blob",
        version.blob,
        ["name", "key", "file_size", "mime_type", "driver", "is_private", "status"],
        as_dict=True,
    )
    if (
        not row
        or row.status != "Ready"
        or not row.is_private
        or int(row.file_size or 0) != int(version.size or 0)
    ):
        raise DriveConflict(_("The Drive version bytes are unavailable or inconsistent"))
    return row


def _require_content_version_node(node: frappe._dict) -> None:
    """Guard the two calls that capture or rewrite the node's own bytes."""
    _require_version_node(node)
    if node.state != "Active":
        # §8.8: a trashed document opens read-only. Replacing a trashed
        # file's head is refused the same way (`nodes._replace_file`).
        raise DriveForbidden(_("Trashed Drive nodes are read-only"))


def _require_version_node(node: frappe._dict) -> None:
    # Every version entry point runs this, so take, list, label, delete, and
    # restore all refuse a root with the one shared message from §8.
    reject_illegal_root_operation(node, "version")
    if node.kind not in ("file", "document"):
        raise DriveConflict(_("Only Drive files and content documents have versions"))


def _validate_kind_and_label(kind: str, label: str | None) -> None:
    if kind not in VERSION_KINDS:
        frappe.throw(_("Drive version kind is invalid"), frappe.ValidationError)
    if label is not None and not isinstance(label, str):
        frappe.throw(_("A Drive version label must be text or null"), frappe.ValidationError)


def _validate_seq(seq: int) -> None:
    if isinstance(seq, bool) or not isinstance(seq, int) or seq < 1:
        frappe.throw(_("Drive version sequence must be a positive integer"), frappe.ValidationError)


def _normalized_ladder(ladder: Mapping | None) -> dict[str, int]:
    if ladder is None:
        ladder = frappe.conf.get("drive_version_ladder") or {}
    if not isinstance(ladder, Mapping):
        frappe.throw(_("drive_version_ladder must be an object"), frappe.ValidationError)
    unknown = set(ladder) - set(DEFAULT_LADDER)
    if unknown:
        frappe.throw(_("drive_version_ladder contains unknown tiers"), frappe.ValidationError)
    policy = {**DEFAULT_LADDER, **ladder}
    values = tuple(policy[key] for key in DEFAULT_LADDER)
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in values):
        frappe.throw(
            _("drive_version_ladder tiers must be nonnegative integer hours"), frappe.ValidationError
        )
    if values != tuple(sorted(values)):
        frappe.throw(_("drive_version_ladder tier bounds must be ordered"), frappe.ValidationError)
    return policy


def _pick_deletions(
    versions: list[dict],
    now: datetime,
    ladder: Mapping[str, int],
) -> list[dict]:
    """Keep the newest row in each age bucket and return the rest."""
    removals = []
    kept_buckets: set[tuple[str, int]] = set()
    for version in versions:
        creation = get_datetime(version.creation)
        age_hours = max((now - creation).total_seconds() / 3600, 0)
        bucket = _retention_bucket(age_hours, ladder)
        if bucket is None:
            removals.append(version)
        elif bucket == ("all", 0):
            continue
        elif bucket in kept_buckets:
            removals.append(version)
        else:
            kept_buckets.add(bucket)
    return removals


def _retention_bucket(age_hours: float, ladder: Mapping[str, int]) -> tuple[str, int] | None:
    if age_hours < ladder["keep_all_hours"]:
        return ("all", 0)
    if age_hours < ladder["hourly_until_hours"]:
        return ("hour", int(age_hours))
    if age_hours < ladder["daily_until_hours"]:
        return ("day", int(age_hours // 24))
    if age_hours <= ladder["weekly_until_hours"]:
        return ("week", int(age_hours // (24 * 7)))
    return None
