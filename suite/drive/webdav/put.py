"""PUT: create a file or overwrite one in place.

Unlike Drive's upload endpoint this never auto-renames — an existing target is
overwritten at the same entity, which is what Office/Finder save flows
(LOCK → PUT → UNLOCK) require. (Disk targets keep their storage key too; on S3
each PUT writes a fresh generation key that the commit publishes — see
_stage_s3_generation.) The body spools through a scratch
file with SHA-256 computed on the way (constant memory under the
streaming_request_paths hook), and `X-OC-Mtime` is honored so rclone's
nextcloud vendor round-trips modification times.
"""

import glob
import hashlib
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import frappe
import mimemapper
from werkzeug.datastructures import FileStorage
from werkzeug.wrappers import Response

from suite.drive.api.activity import create_new_activity_log
from suite.drive.api.files import get_upload_path
from suite.drive.api.permissions import user_has_permission
from suite.drive.api.storage import acquire_owner_storage_lock, get_storage_usage, validate_quota
from suite.drive.utils import (
    STATUS_ACTIVE,
    STATUS_TRASHED,
    apply_file_size_delta,
    create_drive_file,
    get_file_type,
)
from suite.drive.utils.files import FileManager, get_s3_key, get_s3_url, storage_key, stored_on_disk
from suite.drive.webdav import pathmap, perms
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import (
    BadRequest,
    Conflict,
    Forbidden,
    InsufficientStorage,
    MethodNotAllowed,
    NotFoundError,
    quota_guard,
)
from suite.drive.webdav.properties import to_site_naive

# 9999-12-31 UTC — the largest epoch datetime.fromtimestamp can represent
MAX_MTIME = 253402300799


def handle(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)

    if resolved.is_mount or (resolved.root == "virtual"):
        raise MethodNotAllowed("Cannot PUT to a collection.")
    if resolved.missing_intermediate or resolved.root == "unknown":
        raise Conflict("Intermediate collections do not exist.")
    if ctx.request.headers.get("Content-Range"):
        raise BadRequest("Partial PUT is not supported.")

    row = resolved.entity

    # Permission gate FIRST — before any existence- or lock-revealing branch
    # (the 405 collection reply, evaluate_preconditions' 412, locks.enforce's
    # 423), so an unreadable target is indistinguishable from an absent one, as
    # on the other write verbs. It also stops an unauthorized/over-quota client
    # forcing a large body to be spooled before rejection (native upload_file
    # checks permission before writing the temp file too). Create paths gate on
    # the parent's access, overwrite on the row's.
    if row is None:
        access = perms.resolve_entity_access(resolved.parent, ctx.user)
        if not (access["read"] or access["upload"]):
            raise NotFoundError("Resource not found.")
        if not access["upload"]:
            raise Forbidden("Ask the folder owner for upload access.")
        if ctx.had_trailing_slash:
            raise Conflict("Cannot PUT to a collection URL.")
        owner, existing = ctx.user, 0
    else:
        if not perms.resolve_entity_access(row, ctx.user)["read"]:
            raise NotFoundError("Resource not found.")
        if row.is_folder:
            raise MethodNotAllowed("Cannot PUT to a collection.")
        if not user_has_permission(row.name, "write"):
            raise Forbidden("You cannot overwrite this file.")
        if frappe.db.exists("Meet Transcription Job", {"artifact": row.name}):
            raise Forbidden("Generated Meet transcripts are read-only. Download a copy to edit.")
        owner, existing = row.owner, row.file_size or 0

    evaluate_preconditions(ctx.request, row)

    from suite.drive.webdav import locks

    if row is not None:
        locks.enforce(ctx, entity=row.name)
    else:
        locks.enforce(ctx, membership_parent=resolved.parent.name)

    ceiling = _size_ceiling(owner, existing)
    length = ctx.request.content_length
    if ceiling is not None and length and length > ceiling:
        raise InsufficientStorage("Upload exceeds available storage.")

    # keep the target's extension on the scratch name — mimemapper detects by it
    from werkzeug.utils import secure_filename

    scratch = get_upload_path(f"webdav_{frappe.generate_hash(length=12)}_{secure_filename(ctx.segments[-1])}")
    digest = hashlib.sha256()
    try:
        written = 0
        with scratch.open("wb") as spool:
            for chunk in ctx.body.stream():
                written += len(chunk)
                if ceiling is not None and written > ceiling:
                    raise InsufficientStorage("Upload exceeds available storage.")
                spool.write(chunk)
                digest.update(chunk)
        size = scratch.stat().st_size

        if row is None:
            return _create(ctx, resolved, scratch, size, digest.hexdigest())
        return _overwrite(ctx, row, scratch, size, digest.hexdigest())
    finally:
        scratch.unlink(missing_ok=True)


def _size_ceiling(owner: str, existing_size: int) -> int | None:
    """Largest body this PUT may spool to disk, or None when unbounded. Bounds
    the scratch write by the owner's remaining quota (an overwrite reclaims the
    existing blob) and an optional absolute site cap, so a client can never
    spool far past what could ever be stored."""
    ceilings = []
    usage = get_storage_usage(owner)
    if usage["limit"]:
        ceilings.append(max(0, usage["limit"] - usage["total_size"]) + (existing_size or 0))
    hard = frappe.conf.get("drive_webdav_max_upload_size")
    if hard:
        ceilings.append(int(hard))
    return min(ceilings) if ceilings else None


def _create(ctx: DavContext, resolved, scratch: Path, size: int, sha256: str) -> Response:
    parent = resolved.parent
    name = ctx.segments[-1]

    # upload permission was already verified in handle(), before the body spool
    pathmap.validate_dav_name(name, parent)
    _run_upload_validators(scratch, name, parent.name)

    acquire_owner_storage_lock(ctx.user)
    with quota_guard():
        validate_quota(incoming_size=size)

    mime_type = _detect_mime(ctx, scratch)
    manager = ctx.manager
    drive_file = create_drive_file(
        name,
        parent.name,
        get_file_type(mime_type),
        lambda file: "/" + str(manager.get_disk_path(file)),
        mime_type,
        size,
    )
    # the storage form of the url — disk path and S3 key derive from it, and
    # neither can be recovered from the fetch-url rewrite by get_s3_key
    blob = frappe._dict(name=drive_file.name, file_url=drive_file.file_url, mime_type=mime_type)

    def undo(current):
        # compensation for a promotion that failed after commit: without the
        # bytes the row must not exist, nor its share of the rollup — reversed
        # where the rollup now lives, should a move have relocated the row; a
        # trash already settled the chain with the stamped size, so only the
        # row itself remains to remove. Through the controller, not a raw row
        # delete: after_delete reaps whatever another request linked to the
        # row in the window (permissions, favourites, locks, dead props) —
        # orphaned by a raw delete, those rows would never become reachable
        # again. force skips the link check that would otherwise throw over
        # those same rows before the cleanup runs.
        frappe.delete_doc("File", drive_file.name, ignore_permissions=True, force=True)
        if current.status == STATUS_ACTIVE:
            apply_file_size_delta(current.folder, -size)

    def repair():
        # read at drift time, after the stamp landed on the row
        return {
            "file": drive_file.name,
            "stamp": {field: drive_file.get(field) for field in _STAMP_FIELDS},
            "restore": None,
            "delta": size,
        }

    # Stage the byte transfer now, publish at commit (same discipline as
    # _overwrite): the transfer is irreversible while every row write rolls
    # back with the transaction, and the dispatcher commits only after this
    # handler returns — placed at the final disk path any earlier, a failed
    # commit would strand the blob there, unreferenced. On S3 the upload goes
    # straight to the generation key the row will point at: unreachable until
    # the commit publishes the row, deleted if the transaction rolls back.
    # Staging before the remaining row writes also keeps their row locks out
    # of the transfer window, so an S3-sized upload never stalls a concurrent
    # PUT's rollup.
    if manager.s3_enabled:
        generation = _stage_s3_generation(manager, blob, scratch, get_s3_key(blob.file_url), replaces=None)
        drive_file.file_url = get_s3_url(generation)
        drive_file.save()
    else:
        _stage_disk_swap(scratch, _Compensation(drive_file, undo, repair), manager, blob)
    stamped = {"content_hash": sha256}
    if (client_mtime := _client_mtime_datetime(ctx)) is not None:
        # not via create_drive_file: its fromtimestamp() reads the epoch in the
        # OS zone, not the site zone the DB convention expects
        stamped["file_modified"] = client_mtime
    drive_file.db_set(stamped, update_modified=False)
    _bump_folder_size(parent.name, size)
    return _response(ctx, 201, drive_file.name, sha256)


def _overwrite(ctx: DavContext, row: frappe._dict, scratch: Path, size: int, sha256: str) -> Response:
    # write permission was already verified in handle(), before the body spool
    _run_upload_validators(scratch, row.file_name, row.folder)

    # quota stays with the existing owner — an Office save must not shift
    # ownership or billing to whoever pressed Ctrl+S
    acquire_owner_storage_lock(row.owner)
    # a locking read, past MVCC: a concurrent PUT that just committed a new
    # generation key (or size) is visible here, so the swap replaces — and
    # later reaps — the key the row actually points at, not a resolve-time
    # snapshot of it
    doc = frappe.get_doc("File", row.name, for_update=True)
    delta = size - (doc.file_size or 0)
    with quota_guard():
        validate_quota(row.owner, max(0, delta))

    mime_type = _detect_mime(ctx, scratch)
    manager = ctx.manager

    full_name = frappe.db.get_value("User", ctx.user, "full_name")
    activity = create_new_activity_log(
        entity=row.name,
        activity_type="edit",
        activity_message=f"{full_name} updated {row.file_name} via WebDAV",
    )

    fields = ("file_size", "mime_type", "file_type", "file_modified", "content_hash", "modified")
    prior = {field: doc.get(field) for field in fields}

    def undo(current):
        # compensation for a promotion that failed after commit: the bytes
        # never changed, so the content metadata and rollup step back to
        # match them. A metadata-only writer (rename, move) may have carried
        # our stale claim along — the reversal follows the row to its current
        # folder, and the newer clock stays if someone else advanced it. A
        # trashed row's chain needs no reversal: the trash flow subtracted
        # the stamped size, which telescoped the stamped delta away already
        _restore_content(row.name, prior, doc.modified, current)
        if current.status == STATUS_ACTIVE:
            apply_file_size_delta(current.folder, -delta)

    def revoke():
        # our own audit row: the edit it announces never took effect, and
        # that stays true when a newer writer supersedes the metadata
        # restore — the newer PUT logs its own row
        if activity.name:
            frappe.db.delete("Drive Entity Activity Log", {"name": activity.name})

    def repair():
        # read at drift time, after the stamp landed on the row
        return {
            "file": row.name,
            "stamp": {field: doc.get(field) for field in _STAMP_FIELDS},
            "restore": prior,
            "delta": delta,
            "activity": activity.name,
        }

    # DB writes roll back while byte writes cannot, and the dispatcher commits
    # only after this handler returns — replacing the target here would leave
    # a failed commit serving the new body under the rolled-back size, hash
    # and mtime (wrong GET bodies, stale ETags). So only the fallible byte
    # transfer happens now, away from the target: on disk into a staging file
    # the commit renames over the target, on S3 into the generation key the
    # committed row itself will point at. Any rollback discards the staged
    # bytes without touching the target. Staging before the row writes also
    # keeps their row locks out of the transfer window, so an S3-sized upload
    # never stalls a concurrent PUT's rollup.
    new_file_url = _stage_blob_swap(manager, doc, scratch, _Compensation(doc, undo, repair, revoke))

    stamped = {
        "file_size": size,
        "mime_type": mime_type,
        "file_type": get_file_type(mime_type),
        "file_modified": _client_mtime_datetime(ctx) or frappe.utils.now_datetime(),
        "content_hash": sha256,
    }
    if new_file_url is not None:
        stamped["file_url"] = new_file_url
    doc.db_set(stamped)
    # doc.folder, not row.folder: the resolve-time snapshot spans the whole
    # body spool, and a move committed in that window would land the delta on
    # a folder the file already left — the row lock held since the locked
    # read guarantees doc.folder is where the row sits at commit
    _bump_folder_size(doc.folder, delta)
    return _response(ctx, 204, row.name, sha256)


def _stage_blob_swap(manager, doc, scratch: Path, compensation: _Compensation) -> str | None:
    """Stage the new bytes for the commit-time swap. Returns the new file_url
    when they land under a new storage key (an S3 generation), or None when
    the target path itself is swapped in place at commit (disk). The
    compensation only reaches the disk swaps — the S3 path has no fallible
    post-commit step, so its edit always takes effect."""
    if manager.s3_enabled and not stored_on_disk(doc.file_url):
        # storage_key, not get_s3_key: an existing row's file_url is the
        # rewritten fetch url, which only storage_key resolves to the object key
        key = storage_key(doc.file_url)
        return get_s3_url(_stage_s3_generation(manager, doc, scratch, key, replaces=key))
    if manager.s3_enabled:
        # a framework-adopted blob lives on the site disk even under S3; swap
        # it in place — upload_file would write the new body to a stray S3 key
        # that GET (which serves on-disk blobs directly) never reads back. No
        # thumbnail either, matching the native path for adopted blobs.
        _stage_disk_swap(scratch, compensation, manager, expects_existing=True)
    else:
        _stage_disk_swap(scratch, compensation, manager, doc, expects_existing=True)
    return None


_SWAP_FOLLOW_LIMIT = 6
_SWAP_WAITS = 3

# one flat directory under the storage root for bytes awaiting their
# commit-time swap, keyed by row id like the trash store: a MOVE or RENAME
# committed between staging and a later probe rewrites file_url, so any
# location derived from the path goes stale — the id does not
_PENDING_SWAP_PREFIX = ".putpending"


def _pending_swap_dir(manager) -> Path:
    return manager.site_folder / manager.get_root_storage_key() / _PENDING_SWAP_PREFIX


def _stage_disk_swap(
    scratch: Path, compensation: _Compensation, manager, doc=None, expects_existing=False
) -> None:
    """Rename the spooled body into the pending store now (one filesystem —
    the site files tree — end to end, the assumption upload_file's rename
    already makes), so the commit-time swap is a single atomic os.replace
    and the only mutation the old blob ever sees. The staged name is keyed
    by row id, never by the target path: _pending_swap_delivers must find
    these bytes however many relocations land before they install.

    The swap settles against concurrent relocations rather than trusting the
    staging-time path: a move or rename that lands in the commit-to-swap gap
    rewrites file_url, so replacing at the captured path would succeed while
    orphaning the new bytes and leaving the moved file serving old ones
    under the new metadata, with no failure to compensate. Each pass takes a
    locking read (past our own snapshot, released promptly so the peer can
    commit), places the bytes where the committed row points, and
    re-verifies. Drive's relocation flows (File.move/rename, trash) hold the
    row lock ACROSS their disk transfer, so a relocation is never observable
    mid-flight from this locked read; the machinery below — the bounded wait
    on a missing overwrite destination, the settlement job it queues — stays
    as defense in depth for out-of-band writers that bypass the controllers,
    and the missing-destination fallthrough still heals a blob that is
    simply gone (see settle_swap_destination)."""
    pending = _pending_swap_dir(manager)
    pending.mkdir(exist_ok=True)
    staged = pending / f"{compensation.stamped.name}.{frappe.generate_hash(length=12)}.putpart"
    os.rename(scratch, staged)

    def cleanup(placed):
        (placed if placed is not None else staged).unlink(missing_ok=True)

    def swap():
        placed = None
        suspicious = False
        try:
            waits_left = _SWAP_WAITS
            for _attempt in range(_SWAP_FOLLOW_LIMIT):
                current = _swap_state(compensation.stamped.name)
                if current is None:
                    # trashed or deleted in the gap: recreating a path would
                    # orphan a blob a later restore would clobber, so stand
                    # down. Whether the stamped metadata steps back is the
                    # compensation's trash-aware call — bytes this swap placed
                    # before the trash slipped in went with it into the trash
                    # store: delivered, so the stamp stands
                    cleanup(placed)
                    compensation.run()
                    return
                dest = manager.get_local_path(current.file_url)
                missing = placed is None and expects_existing and not dest.exists()
                if missing and waits_left:
                    waits_left -= 1
                    frappe.db.commit()  # release the row so the peer can commit
                    time.sleep(0.1)
                    continue
                if dest != placed:
                    suspicious = suspicious or missing
                    os.replace(placed if placed is not None else staged, dest)
                    placed = dest
                    frappe.db.commit()
                    continue  # a fresh locked read must agree with the placement
                frappe.db.commit()
                break
            else:
                cleanup(placed)
                raise OSError("swap destination kept moving")
        except Exception:
            cleanup(placed)
            compensation.run()
            raise
        if suspicious:
            _queue_swap_settlement(compensation.stamped, placed)
        if doc is not None and manager.can_create_thumbnail(doc):
            _enqueue_thumbnail(manager, doc, str(placed))

    frappe.db.after_commit.add(swap)
    frappe.db.after_rollback.add(lambda: staged.unlink(missing_ok=True))


def _queue_swap_settlement(stamped, placed: Path) -> None:
    """Best-effort hand-off of the timed-out wait to a worker; a failure to
    queue must not fail a PUT whose bytes are already placed and consistent
    with everything committed so far."""
    try:
        frappe.enqueue(
            settle_swap_destination,
            queue="short",
            file=stamped.name,
            stamp={
                "content_hash": stamped.get("content_hash"),
                "file_size": stamped.get("file_size"),
            },
            placed=str(placed),
        )
    except Exception:
        _file_log(f"File {stamped.name}: could not queue the swap settlement\n{frappe.get_traceback()}")


_SETTLE_DELAYS = (1, 2, 4, 8, 16)


# far beyond any organic relocation rate — the chase settles the moment the
# churn pauses for a single iteration — yet finite, so machine-speed churn of
# a file cannot pin a worker (or the inline fallback's stack) forever
_SETTLE_HOPS = 64


def settle_swap_destination(file, stamp, placed, hops=0):
    """The late half of the swap's follow, queued when the in-request wait
    for a suspected mid-flight relocation timed out and the bytes were
    placed at the last committed path. A peer stalled longer than that wait
    commits eventually; a worker re-checks here — minutes past any plausible
    stall — and finishes the follow when it does. Idempotent by the same
    guards as compensation: it acts only while the row still claims the
    PUT's content, the placed file still delivers it, and the row's current
    location does not. Every placement is re-verified with a fresh locked
    read and followed if the pointer moved again, mirroring the in-request
    swap — a job never ends on an unverified replace: when relocations
    outlast the budget, the remainder chains to a fresh job (hops-capped,
    no re-waits) whose first locked read is exactly the missing
    verification. A blob that was simply missing never moves the pointer,
    so the checks drain quietly and the heal stands."""
    placed = Path(placed)
    moved = False
    delays = iter(_SETTLE_DELAYS if hops == 0 else ())
    for _ in range(len(_SETTLE_DELAYS) + 3):
        # locked, like the in-request swap: a newer PUT blocks at its own
        # locked read until this commit, so it cannot slip between these
        # guards (which may hash sizable files) and the replace below
        current = frappe.db.get_value(
            "File", file, ["file_url", "status", "content_hash", "file_size"], as_dict=True, for_update=True
        )
        if current is None or current.status != STATUS_ACTIVE:
            frappe.db.commit()
            return
        dest = FileManager().get_local_path(current.file_url)
        if dest == placed:
            frappe.db.commit()  # release the row before deciding or waiting
            if moved:
                return  # a fresh locked read agrees with the follow — settled
            delay = next(delays, None)
            if delay is None:
                return  # the peer never landed; the heal stands
            time.sleep(delay)
            continue
        ours = _file_delivers_stamp(placed, stamp)
        if ours and _content_carries(stamp, current) and not _bytes_deliver_stamp(stamp, current):
            # follow the pointer, then loop: the next locked read must agree
            # with the placement — an out-of-band relocation mid-replace
            # would otherwise strand these bytes exactly the way the
            # original stale-path race did
            os.replace(placed, dest)
            placed = dest
            moved = True
            frappe.db.commit()
            continue
        if ours:
            # superseded — the row moved on without needing these bytes;
            # reap our copy. A placed path that no longer delivers the
            # stamp may already belong to someone else's blob: leave it.
            placed.unlink(missing_ok=True)
        frappe.db.commit()
        return
    # budget exhausted right after a replace (pure waits return above): the
    # placement is live but the last word belongs to a fresh locked read —
    # chain the remainder instead of exiting unverified
    if hops < _SETTLE_HOPS:
        try:
            frappe.enqueue(
                settle_swap_destination,
                queue="short",
                file=file,
                stamp=stamp,
                placed=str(placed),
                hops=hops + 1,
            )
            return
        except Exception:
            # the queue is down, but the database demonstrably is not — the
            # loop above just used it. Continue the chase inline instead of
            # abandoning a verification that needs no queue at all; the hop
            # cap still bounds the recursion.
            return settle_swap_destination(file, stamp, str(placed), hops=hops + 1)
    # the hop cap is spent: one last locked read classifies the outcome before
    # anything is recorded — churn usually pauses the instant the chase stops,
    # which makes the final replace the settled last word, and a false alarm
    # here would send an operator replaying a settlement that already landed
    try:
        current = frappe.db.get_value(
            "File", file, ["file_url", "status", "content_hash", "file_size"], as_dict=True, for_update=True
        )
        if current is None or current.status != STATUS_ACTIVE:
            frappe.db.commit()
            return
        if FileManager().get_local_path(current.file_url) == placed:
            frappe.db.commit()
            return  # settled on the final replace after all
        ours = _file_delivers_stamp(placed, stamp)
        if not (ours and _content_carries(stamp, current) and not _bytes_deliver_stamp(stamp, current)):
            # superseded, or equivalent bytes already delivered — mirror the
            # loop's supersede exit: reap only a copy still provably ours
            if ours:
                placed.unlink(missing_ok=True)
            frappe.db.commit()
            return
        frappe.db.commit()
    except Exception:
        pass  # classification is best-effort; the record below still lands
    note = (
        f"File {file}: swap settlement exhausted mid-churn; bytes at {placed}; replay with "
        f"settle_swap_destination(file={file!r}, stamp={json.dumps(stamp, default=str)}, placed={str(placed)!r})"
    )
    _file_log(note)
    try:
        # the database is alive on this path — leave a record an operator
        # actually sees, not just a log line
        frappe.log_error(
            "Drive: swap settlement exhausted mid-churn", note, reference_doctype="File", reference_name=file
        )
        frappe.db.commit()
    except Exception:
        pass


def _swap_state(name: str) -> frappe._dict | None:
    """The committed row's location, read under lock: locking reads see past
    this transaction's repeatable-read snapshot, and a mover that already
    issued its row write commits before we proceed. Callers release the lock
    promptly with a commit. None means the row is no longer Active — or no
    longer exists — and the swap must stand down."""
    current = frappe.db.get_value("File", name, ["file_url", "status"], as_dict=True, for_update=True)
    if current is None or current.status != STATUS_ACTIVE:
        return None
    return current


# one generation suffix per key: [0-9a-f] is generate_hash's alphabet
_GENERATION_SUFFIX = re.compile(r"\.[0-9a-f]{12}\.putgen$")


def _stage_s3_generation(manager, doc, scratch: Path, key: str, replaces: str | None) -> str:
    """Upload the body to a fresh generation key now — the fallible network
    transfer happens entirely inside the transaction — and let the commit that
    publishes the new metadata publish file_url pointing at it in the same
    instant. Copying into a fixed key at after_commit instead left a window as
    long as the S3 copy in which a GET paired the committed size, hash and
    mtime with the previous bytes. The object this PUT replaces turns to
    garbage at commit and is reaped best-effort; a rollback reaps the new
    generation and never touches the old one."""
    # strip the previous PUT's suffix so repeated saves never stack suffixes
    # into an ever-growing key
    generation = f"{_GENERATION_SUFFIX.sub('', key)}.{frappe.generate_hash(length=12)}.putgen"
    manager.conn.upload_file(str(scratch), manager.bucket, generation)
    thumb_source = None

    def promote():
        # the inequality guards the freak hash collision where reaping the
        # replaced key would reap the bytes just written
        if replaces is not None and replaces != generation:
            _discard_object(manager, replaces)
        if thumb_source is not None:
            _enqueue_thumbnail(manager, doc, str(thumb_source), discard_source=thumb_source)

    def discard():
        if thumb_source is not None:
            thumb_source.unlink(missing_ok=True)
        _discard_object(manager, generation)

    # armed the moment the object exists: anything that raises between here
    # and the commit — the thumbnail rename below included — must reap it on
    # rollback, or the failed PUT strands an unreferenced object forever
    frappe.db.after_commit.add(promote)
    frappe.db.after_rollback.add(discard)

    if manager.can_create_thumbnail(doc):
        # upload_thumbnail renders from a local file and deletes it when done;
        # the closures read thumb_source at run time, so they see this rebind
        staged_thumb = scratch.with_name(scratch.name + ".thumbsrc")
        os.rename(scratch, staged_thumb)
        thumb_source = staged_thumb
    return generation


def _enqueue_thumbnail(manager, doc, file_path: str, discard_source: Path | None = None) -> None:
    """Thumbnails are cosmetic, and by this point the bytes and metadata are
    committed and promoted — nothing here may fail the response, or the client
    would retry a PUT that already succeeded. upload_thumbnail swallows its own
    failures; this guards the enqueue machinery around it — and the recovery
    itself (an unlink, an Error Log insert) may not escape either."""
    try:
        frappe.enqueue(manager.upload_thumbnail, now=True, at_front=True, file=doc, file_path=file_path)
    except Exception:
        trace = frappe.get_traceback()
        try:
            if discard_source is not None:
                discard_source.unlink(missing_ok=True)
        except Exception:
            pass
        try:
            frappe.log_error("Drive: could not create WebDAV thumbnail", trace)
        except Exception:
            _file_log(f"File {doc.name}: could not create WebDAV thumbnail\n{trace}")


class _Compensation:
    """Steps a committed PUT back when its disk promotion fails: the row
    already claims bytes the target never received, and the exception the
    failure re-raises turns into the client's 500, whose retry heals
    everything anyway.

    undo restores the shared row state (content snapshot, rollup delta) and
    is guarded by the content-stamp check: a CONTENT writer that slipped in
    after our commit has already replaced bytes, metadata and rollup,
    computing its delta against our committed size — restoring our snapshot
    over that would clobber the newer write and unbalance the accounting
    chain. A metadata-only writer (rename, move, share) is not a reason to
    yield: it carries our stale content claim along, so undo still runs,
    receiving the locked current row to follow a move and to keep a newer
    clock. The locking read blocks until any in-flight writer commits, so
    the choice is race-free. revoke retracts only rows this PUT itself
    created (its audit trail) and runs either way: an edit that never took
    effect must not stay recorded, however the row race went. repair builds
    the same undo as a serializable spec for the queued worker retry."""

    def __init__(self, stamped, undo, repair, revoke=None):
        self.stamped = stamped
        self.undo = undo
        self.repair = repair
        self.revoke = revoke

    def run(self) -> None:
        """Two attempts on fresh transactions — a first failure is often a
        deadlock victim or lock timeout. If both fail, the drift is recorded
        durably and the compensation is handed to a background worker, whose
        queue rides Redis rather than the database connection failing here."""
        try:
            self._attempt()
        except Exception:
            try:
                frappe.db.rollback()
                self._attempt()
            except Exception:
                self._record_drift()

    def _attempt(self) -> None:
        if self.revoke is not None:
            self.revoke()
        current = _locked_content_state(self.stamped.name)
        if _should_restore(self.stamped, current):
            self.undo(current)
        frappe.db.commit()

    def _record_drift(self) -> None:
        trace = frappe.get_traceback()
        spec = self.repair()
        # the full spec rides every record, so the handoff can degrade but
        # never vanish: even with the database and the queue both down, the
        # last line below replays verbatim once services return, e.g.
        #   bench execute suite.drive.webdav.put.repair_promotion_drift \
        #       --kwargs '<spec>'
        note = "replay with repair_promotion_drift(**spec); spec follows:\n" + json.dumps(spec, default=str)
        # each rung records independently — the file log needs no services,
        # but it sits on the very disk that may have failed the promotion, so
        # it must not gate the database record or the queued repair either
        _file_log(
            f"File {self.stamped.name}: metadata left ahead of bytes after failed promotion\n{trace}\n{note}"
        )
        try:
            frappe.db.rollback()  # clear any aborted transaction so the log row can commit
            frappe.log_error(
                "Drive: metadata left ahead of bytes after failed promotion",
                f"{trace}\n\n{note}",
                reference_doctype="File",
                reference_name=self.stamped.name,
            )
            frappe.db.commit()
        except Exception:
            pass
        try:
            frappe.enqueue(repair_promotion_drift, queue="short", **spec)
        except Exception:
            _file_log(
                f"File {self.stamped.name}: could not queue the drift repair — "
                f"replay the spec recorded above\n{frappe.get_traceback()}"
            )


def _file_log(message: str) -> None:
    """The service-independent rung of the drift record. Even opening the log
    file can fail (the promotion may have failed because this same disk is
    full or read-only) — fall back to stderr then: an already-open
    descriptor that needs neither the site disk nor any service, lands in
    the supervisor's or container's log stream, and cannot fail on a full
    disk the way a file write can. The repair spec rides the message, so it
    survives even with logging, database, and queue all down at once."""
    try:
        frappe.logger("drive").error(message)
    except Exception:
        try:
            print(f"drive.webdav: {message}", file=sys.stderr, flush=True)
        except Exception:
            pass


def repair_promotion_drift(file, stamp, restore, delta, activity=None):
    """Deferred compensation, run by a worker on its own connection after the
    in-request attempts failed. Same rules as the inline path: the restore
    and the rollup reversal apply only while the row still carries the failed
    PUT's content stamp (a later successful save reconciles everything
    itself), the reversal follows the row to its current folder, and the
    audit row comes off regardless. Idempotent — a repeat run finds the stamp
    gone and changes nothing."""
    current = _locked_content_state(file)
    if _should_restore(stamp, current):
        if restore is None:
            # a failed create: without the bytes the row must not exist —
            # through the controller, so after_delete reaps linked records
            frappe.delete_doc("File", file, ignore_permissions=True, force=True)
        else:
            _restore_content(file, restore, stamp.get("modified"), current)
        # a trashed row's chain was already settled by the trash flow, which
        # subtracted the stamped size — the stamped delta telescoped away
        if current.status == STATUS_ACTIVE:
            apply_file_size_delta(current.folder, -delta)
    if activity:
        frappe.db.delete("Drive Entity Activity Log", {"name": activity})
    frappe.db.commit()


# the fields a PUT stamps; the first three are the content fingerprint, the
# row clock (modified) rides along only to decide whether restore may put the
# clock back
_STAMP_FIELDS = ("content_hash", "file_size", "file_modified", "modified")


def _locked_content_state(name: str) -> frappe._dict | None:
    """The row's content claim and location, read under lock: a concurrent
    writer has either committed (and shows here) or waits until the
    compensation commits, so the yield-or-restore choice is race-free."""
    return frappe.db.get_value(
        "File",
        name,
        ["name", "content_hash", "file_size", "modified", "folder", "file_url", "status"],
        as_dict=True,
        for_update=True,
    )


def _should_restore(stamped, current) -> bool:
    """Restore only when the row still claims the content this PUT wrote AND
    that claim is neither already delivered nor about to be. The byte check
    settles the case the row fingerprint cannot — a racing PUT of the
    identical body whose promotion succeeded while ours failed — and the
    pending-swap check settles its committed-but-not-yet-swapped variant."""
    if not _content_carries(stamped, current):
        return False
    if _bytes_deliver_stamp(stamped, current):
        return False
    return not _pending_swap_delivers(stamped, current)


def _pending_swap_delivers(stamped, current) -> bool:
    """A twin-content PUT commits its stamp before its after-commit swap
    installs the bytes: the row's claim is then genuine, just pending — and
    its staged putpart still sits in the pending store, un-consumable while
    we hold the row lock its swap is queued behind. The store is keyed by
    row id, so the probe survives any MOVE or RENAME committed since the
    twin staged — a probe beside the row's current path would go stale the
    moment the pointer moved. Restoring over a pending twin would hand the
    imminent install stale metadata and unbalance the rollup. Only a staged
    file whose content actually delivers the claimed stamp counts; an
    unrelated orphan does not stand in the way of a needed restore."""
    try:
        pattern = glob.escape(current.name) + ".*.putpart"
        return any(
            _file_delivers_stamp(staged, stamped) for staged in _pending_swap_dir(FileManager()).glob(pattern)
        )
    except Exception:
        return False


def _content_carries(stamped, current) -> bool:
    """Whether the row still claims exactly the content this PUT wrote — its
    hash and size. Clocks are deliberately not part of the fingerprint: a
    metadata-only writer advances `modified` (rename, move, share) or even
    `file_modified` (trash, a PROPPATCH timestamp write) while carrying our
    stale content claim along, and yielding to one would leave the old bytes
    under the failed PUT's metadata. The case the clocks used to guard — a
    racing PUT of the identical body — is settled by _bytes_deliver_stamp."""
    if current is None:
        return False
    if current.content_hash != stamped.get("content_hash"):
        return False
    return (current.file_size or 0) == (stamped.get("file_size") or 0)


def _bytes_deliver_stamp(stamped, current) -> bool:
    """Whether the row's claimed content is really delivered wherever its
    bytes now live. For an Active row that is the file at file_url. A
    Trashed row's blob sits under the trash prefix — trash moves the bytes
    but not the pointer — so a swap that placed our bytes just before the
    trash slipped in has genuinely taken effect: the trash store carried
    them along, and restoring the prior metadata over it would hand a later
    restore new content under stale size, hash and accounting. file_url
    stays a candidate for trashed rows too: flat layouts never move the
    blob. Any doubt (unresolvable paths) counts as undelivered so the
    restore proceeds."""
    manager = FileManager()
    candidates = []
    if current.get("status") == STATUS_TRASHED and current.get("name"):
        try:
            candidates.append(manager.site_folder / manager.get_trash_path(current))
        except Exception:
            pass
    try:
        candidates.append(manager.get_local_path(current.file_url))
    except Exception:
        pass
    return any(_file_delivers_stamp(path, stamped) for path in candidates)


def _file_delivers_stamp(path: Path, stamped) -> bool:
    """Whether the file at `path` holds the stamped content. The stat gate
    keeps this cheap — a genuine compensation almost always has old size ≠
    stamped size and never hashes; the full hash runs only for a same-size
    file, on rare failure paths, and any doubt (missing file, unreadable, no
    hash to check) counts as undelivered."""
    if not stamped.get("content_hash"):
        return False
    try:
        if path.stat().st_size != (stamped.get("file_size") or 0):
            return False
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            while chunk := fh.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest() == stamped.get("content_hash")
    except Exception:
        return False


def _restore_content(name: str, prior: dict, stamped_clock, current) -> None:
    """Put the prior content metadata back. The row clock reverts only when
    it still reads this PUT's stamp — a metadata writer that advanced it
    keeps its newer clock, only its carried content claim is corrected."""
    restore = dict(prior)
    if not _same_clock(current.modified, stamped_clock):
        restore.pop("modified", None)
    frappe.db.set_value("File", name, restore, update_modified=False)


def _same_clock(left, right) -> bool:
    # get_datetime(None) means "now", so bare equality would misread None
    if left is None or right is None:
        return left is None and right is None
    return frappe.utils.get_datetime(left) == frappe.utils.get_datetime(right)


def _discard_object(manager, key: str) -> None:
    try:
        manager.conn.delete_object(Bucket=manager.bucket, Key=key)
    except Exception:
        # a stray object is only clutter; the PUT's outcome must not fail over
        # it — not even over the Error Log insert recording the leak
        trace = frappe.get_traceback()
        try:
            frappe.log_error("Drive: could not delete WebDAV object", trace)
        except Exception:
            _file_log(f"could not delete WebDAV object {key}\n{trace}")


def _run_upload_validators(scratch: Path, file_name: str, parent: str) -> None:
    checks = frappe.get_hooks("validate_drive_upload")
    if not checks:
        return
    with scratch.open("rb") as stream:
        wrapper = FileStorage(stream=stream, filename=file_name)
        for check in checks:
            result = frappe.call(check, file=wrapper, parent=parent, embed=0)
            if result is not None and result is not True:
                raise Forbidden(str(result) or "This upload was cancelled by a validation check.")


def _detect_mime(ctx: DavContext, scratch: Path) -> str:
    mime_type = mimemapper.get_mime_type(str(scratch), native_first=False)
    if not mime_type or mime_type == "application/octet-stream":
        declared = (ctx.request.headers.get("Content-Type") or "").split(";")[0].strip()
        if declared and declared != "application/octet-stream":
            mime_type = declared
    return mime_type or "application/octet-stream"


def _client_mtime(ctx: DavContext) -> float | None:
    header = ctx.request.headers.get("X-OC-Mtime")
    if header:
        stamp = header.strip()
        # isdigit() alone let a huge value through and overflowed
        # datetime.fromtimestamp; bound it to what a datetime can represent
        if stamp.isdigit() and int(stamp) <= MAX_MTIME:
            return float(stamp)
    return None


def _client_mtime_datetime(ctx: DavContext) -> datetime | None:
    """X-OC-Mtime is a UTC epoch; the DB stores site-local naive datetimes.
    A zoneless fromtimestamp() would read the epoch in the OS zone instead and
    skew every round-trip (rclone re-syncs) whenever the two zones differ."""
    stamp = _client_mtime(ctx)
    if stamp is None:
        return None
    return to_site_naive(datetime.fromtimestamp(stamp, tz=UTC))


def _bump_folder_size(folder: str, delta: int) -> None:
    """A failed rollup fails the PUT. The atomic delta cannot lose a race, so
    failure means the database itself is in trouble — and suppressed, it would
    commit ancestor sizes that no reconciliation repairs. Raising rolls the
    whole transaction back, staged bytes included, for the client to retry."""
    if not delta:
        return
    apply_file_size_delta(folder, delta)


def _response(ctx: DavContext, status: int, entity_name: str, sha256: str) -> Response:
    headers = {"ETag": f'"sha256-{sha256[:32]}"'}
    if ctx.request.headers.get("X-OC-Mtime"):
        headers["X-OC-Mtime"] = "accepted"
    return Response(status=status, headers=headers)
