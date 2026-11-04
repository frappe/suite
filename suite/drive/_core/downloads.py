"""Downloads: one person's zip of Drive nodes, built in the background and kept for a day.

Asking for a download checks READ on each selected node and answers at once with
a Preparing row. A long-queue job then zips the nodes, and every folder's
subtree, into a private File Blob through the active storage driver. It checks
READ on every node it writes, and one unreadable node fails the whole zip
(Drive spec §11.2).

How the zip reaches its requester depends on where their access comes from.
Someone who reads every selected node through their own principals gets an
Inbox download: a notification links it when the job ends. A Guest, or anyone
whose access comes through a share link, gets a Page download: the page that
asked polls for it, and the row keeps the link credentials, because a browser
navigation to the zip carries no link header.

Sending the zip checks READ again on every node the job recorded, even one that
has moved since, with the requester's own principals and the recorded links. A
missing, trashed or unreadable member, or a revoked link, refuses the download.

A zip expires `DOWNLOAD_TTL` after it is ready. `purge_expired` fails downloads
whose job never finished and deletes expired rows and their notifications; the
storage garbage collector then deletes the unreferenced blob and its bytes.
"""

import dataclasses
import hashlib
import io
import json
import re
import tempfile
import zipfile
from collections.abc import Sequence
from contextlib import closing
from datetime import timedelta
from typing import IO
from uuid import uuid4

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver
from frappe.utils import get_datetime, now_datetime

from suite.drive._core import content
from suite.drive._core import nodes as node_core
from suite.drive._core.changes import emit_for_users
from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveNotFound,
    rollback_savepoint,
)
from suite.drive._core.principals import Principals

DOWNLOAD_TTL = timedelta(hours=24)
MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024
BUILD_TIMEOUT_SECONDS = 60 * 60
# A Preparing row older than this lost its job: a killed worker, or a fault
# after the job's own error handling.
STALLED_AFTER = timedelta(seconds=BUILD_TIMEOUT_SECONDS) + timedelta(minutes=15)
MAX_PREPARING_DOWNLOADS = 3
DOWNLOAD_FIELDS = (
    "name",
    "requester",
    "title",
    "status",
    "delivery",
    "nodes",
    "links",
    "members",
    "blob",
    "size",
    "expires_at",
    "error",
)
# The kinds a person can select in a listing. A root is never a row.
DOWNLOADABLE_KINDS = frozenset({"folder", "file", "document", "link"})

MEMBERS_SQL = f"""
    SELECT {node_core.NODE_FIELDS}
    FROM `tabDrive Node` n
    WHERE n.name IN %(nodes)s AND n.state = 'Active'
"""
# A folder's Active subtree, shallowest first, without the nodes inside a
# document: those are the document's own media, and its export carries them.
DESCENDANTS_SQL = f"""
    SELECT {node_core.NODE_FIELDS}
    FROM `tabDrive Node` n
    WHERE n.root = %(root)s
      AND n.state = 'Active'
      AND n.path LIKE %(prefix)s
      AND NOT EXISTS (
          SELECT 1
          FROM JSON_TABLE(
              CASE WHEN COALESCE(n.path, '') = '' THEN '[]'
                   ELSE CONCAT('[\"', REPLACE(TRIM(BOTH '/' FROM n.path), '/', '\",\"'), '\"]')
              END,
              '$[*]' COLUMNS (
                  name VARCHAR(140) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
              )
          ) AS ancestor_id
          JOIN `tabDrive Node` document_ancestor ON document_ancestor.name = ancestor_id.name
          WHERE document_ancestor.kind = 'document'
      )
    ORDER BY CHAR_LENGTH(n.path), n.name
"""


def start(principals: Principals, nodes: Sequence[str]) -> frappe._dict:
    """Return the caller's zip of the selected nodes: one already asked for, or a new Preparing one.

    The job is queued after this request commits, so it always finds the row.
    """
    selected = [_selectable(principals, node) for node in nodes]
    if not selected:
        raise DriveConflict(_("Select at least one item to download"))
    own = without_links(principals)
    page = principals.user == "Guest" or not _all_readable(own, [row.name for row in selected])
    links = _link_credentials(principals) if page else None
    builder = principals if page else own
    selection = _selection(selected, links)
    if reused := _reusable(builder, selection):
        return reused
    _check_preparing(principals.user, links)
    row = frappe.get_doc(
        {
            "doctype": "Drive Download",
            "requester": principals.user,
            "title": _zip_title(principals, selected),
            "status": "Preparing",
            "delivery": "Page" if page else "Inbox",
            "nodes": json.dumps([node.name for node in selected]),
            "selection": selection,
            "links": links,
            "expires_at": now_datetime() + DOWNLOAD_TTL,
        }
    ).insert(ignore_permissions=True)
    frappe.db.after_commit.add(lambda: queue_build(row.name, builder))
    return get(principals, row.name)


def get(principals: Principals, download: str) -> frappe._dict:
    """Return one of the caller's own downloads. Anyone else's is not found.

    Every Guest is one requester, so a Guest's download is reached by its
    name alone: 128 random bits that only the page that asked was given.
    """
    row = frappe.db.get_value("Drive Download", download, DOWNLOAD_FIELDS, as_dict=True)
    if not row or row.requester != principals.user:
        raise DriveNotFound(_("Drive download {0} was not found").format(download))
    return row


def without_links(principals: Principals) -> Principals:
    """The caller's principals without the share links their request presented."""
    return dataclasses.replace(
        principals,
        open=tuple(principal for principal in principals.open if not principal.startswith("$LINK:")),
        link_tickets=(),
    )


def build(download: str, principals: Principals) -> None:
    """Background job: zip a download's nodes into a private blob, then notify its requester.

    A refusal or a fault fails this download alone. The worker commits the row
    and the notification together when the job returns.
    """
    row = frappe.db.get_value("Drive Download", download, DOWNLOAD_FIELDS, as_dict=True)
    if not row or row.status != "Preparing":
        return
    savepoint = f"drive_download_{uuid4().hex[:12]}"
    frappe.db.savepoint(savepoint)
    try:
        members = _members(principals, frappe.parse_json(row.nodes))
        blob, size = _zip(principals, members)
        values = {
            "status": "Ready",
            "blob": blob,
            "size": size,
            "members": json.dumps([member.name for member in members]),
            "expires_at": now_datetime() + DOWNLOAD_TTL,
        }
    except DriveError as refusal:
        rollback_savepoint(savepoint, refusal)
        values = {"status": "Failed", "error": str(refusal)}
    except Exception as fault:
        rollback_savepoint(savepoint, fault)
        frappe.log_error("Drive: could not prepare a download", frappe.get_traceback())
        values = {"status": "Failed", "error": _("Drive could not prepare this download. Try again.")}
    _finish(row, values)


def ready_blob(principals: Principals, download: str) -> tuple[Document, str]:
    """Return a ready zip's blob and file name after rechecking READ on every member.

    A Page download is checked with the link credentials it was asked with, so
    revoking that link refuses it.
    """
    row = get(principals, download)
    if row.status != "Ready" or get_datetime(row.expires_at) <= now_datetime():
        raise DriveNotFound(_("This download has expired. Download the items again."))
    if not _all_readable(_holder(principals, row), frappe.parse_json(row.members) or []):
        raise DriveNotFound(_("An item in this download was moved, deleted or unshared. Download it again."))
    blob = frappe.db.exists("File Blob", {"name": row.blob, "status": "Ready", "is_private": 1})
    if not blob:
        raise DriveNotFound(_("This download is no longer available"))
    return frappe.get_doc("File Blob", blob), row.title


def purge_expired() -> int:
    """Fail stalled downloads, then delete expired ones and the notifications that point at them.

    Deleting a row drops the zip's last reference to its File Blob. The storage
    garbage collector deletes the blob and its bytes on its next daily run.
    """
    stalled = frappe.get_all(
        "Drive Download",
        filters={"status": "Preparing", "creation": ["<", now_datetime() - STALLED_AFTER]},
        fields=DOWNLOAD_FIELDS,
    )
    for row in stalled:
        _finish(
            row, {"status": "Failed", "error": _("Drive took too long to prepare this download. Try again.")}
        )
    expired = frappe.get_all(
        "Drive Download",
        filters={"expires_at": ["<", now_datetime()]},
        fields=["name", "requester", "delivery"],
    )
    if not expired:
        return 0
    names = [row.name for row in expired]
    frappe.db.delete("Drive Notification", {"download": ["in", names]})
    frappe.db.delete("Drive Download", {"name": ["in", names]})
    emit_for_users({row.requester for row in expired if row.delivery == "Inbox"})
    return len(expired)


def queue_build(download: str, principals: Principals) -> None:
    """Push the build job; when that fails, fail the download at once.

    This runs after the request's commit, as `activity.queue_share_email` does:
    a Redis failure must not turn a committed request into a 500. So the failed
    row and its notification are committed here, or no one would.
    """
    try:
        frappe.enqueue(
            "suite.drive._core.downloads.build",
            queue="long",
            timeout=BUILD_TIMEOUT_SECONDS,
            download=download,
            principals=principals,
        )
    except Exception:
        frappe.logger("suite.drive").exception("Drive: could not queue download %s", download)
        row = frappe.db.get_value("Drive Download", download, DOWNLOAD_FIELDS, as_dict=True)
        _finish(
            row, {"status": "Failed", "error": _("Drive could not start preparing this download. Try again.")}
        )
        frappe.db.commit()


def _finish(row: frappe._dict, values: dict) -> None:
    """Record how a download ended. An Inbox download also tells its requester."""
    frappe.db.set_value("Drive Download", row.name, values)
    if row.delivery != "Inbox":
        return
    frappe.get_doc(
        {"doctype": "Drive Notification", "download": row.name, "to_user": row.requester, "read": 0}
    ).insert(ignore_permissions=True)
    emit_for_users((row.requester,))


def _all_readable(principals: Principals, nodes: Sequence[str]) -> bool:
    """Whether every node is Active and readable. No nodes is not readable."""
    rows = frappe.db.sql(MEMBERS_SQL, {"nodes": tuple(nodes)}, as_dict=True) if nodes else []
    return bool(nodes) and len(node_core._readable_rows(rows, principals)) == len(set(nodes))


def _link_credentials(principals: Principals) -> str:
    """The share links a request presented, as the JSON a Page download keeps."""
    links = sorted(principal for principal in principals.open if principal.startswith("$LINK:"))
    return json.dumps({"links": links, "tickets": sorted(map(list, principals.link_tickets))})


def _holder(principals: Principals, row: frappe._dict) -> Principals:
    """The caller's own principals, with the links a Page download was asked with."""
    own = without_links(principals)
    if not row.links:
        return own
    recorded = frappe.parse_json(row.links)
    return dataclasses.replace(
        own,
        open=(*own.open, *recorded["links"]),
        link_tickets=tuple(tuple(ticket) for ticket in recorded["tickets"]),
    )


def _selection(selected: list[frappe._dict], links: str | None) -> str:
    """A digest of what a download holds and the links it may be read with."""
    key = json.dumps({"nodes": sorted(row.name for row in selected), "links": links})
    return hashlib.sha256(key.encode()).hexdigest()


def _reusable(principals: Principals, selection: str) -> frappe._dict | None:
    """The requester's live download of the same selection, so a second click builds nothing."""
    rows = frappe.get_all(
        "Drive Download",
        filters={
            "requester": principals.user,
            "selection": selection,
            "status": ["in", ("Preparing", "Ready")],
            "expires_at": [">", now_datetime()],
        },
        fields=DOWNLOAD_FIELDS,
        order_by="creation desc",
        limit=1,
    )
    if not rows:
        return None
    row = rows[0]
    # A ready zip whose member was unshared since would only be refused.
    if row.status == "Ready" and not _all_readable(principals, frappe.parse_json(row.members) or []):
        return None
    return row


def _check_preparing(requester: str, links: str | None) -> None:
    """Refuse a new download while the requester has too many being prepared.

    Every Guest is one requester, so Guests are counted per set of links.
    """
    filters: dict[str, str | None] = {"requester": requester, "status": "Preparing"}
    if requester == "Guest":
        filters["links"] = links
    if frappe.db.count("Drive Download", filters) >= MAX_PREPARING_DOWNLOADS:
        raise DriveConflict(
            _("{0} downloads are already being prepared. Try again when one is ready.").format(
                MAX_PREPARING_DOWNLOADS
            )
        )


def _selectable(principals: Principals, node: str) -> frappe._dict:
    row = node_core.get(principals, node)
    if row.state != "Active" or row.kind not in DOWNLOADABLE_KINDS:
        raise DriveConflict(_("Only active Drive items can be downloaded"))
    return row


def _zip_title(principals: Principals, selected: list[frappe._dict]) -> str:
    """Name the zip after the one selected node, or after the folder the selection is in."""
    if len(selected) == 1:
        return f"{_segment(selected[0].title)}.zip"
    parents = {row.parent_node for row in selected}
    if len(parents) == 1:
        try:
            parent = node_core.get(principals, parents.pop())
        except DriveError:
            parent = None
        if parent and parent.kind == "folder":
            return f"{_segment(parent.title)}.zip"
    return f"{_segment(_('Suite download'))}.zip"


def _members(principals: Principals, nodes: Sequence[str]) -> list[frappe._dict]:
    """Every node the zip holds, each ancestor before its descendants."""
    members: dict[str, frappe._dict] = {}
    for node in nodes:
        row = _selectable(principals, node)
        members.setdefault(row.name, row)
        if row.kind == "folder":
            for descendant in _descendants(principals, row):
                members.setdefault(descendant.name, descendant)
    return sorted(members.values(), key=lambda row: len(row.path or ""))


def _descendants(principals: Principals, folder: frappe._dict) -> list[frappe._dict]:
    rows = frappe.db.sql(
        DESCENDANTS_SQL,
        {"root": folder.root, "prefix": f"{folder.path or '/'}{folder.name}/%"},
        as_dict=True,
    )
    if len(node_core._readable_rows(rows, principals)) != len(rows):
        raise DriveNotFound(_("An item in folder {0} cannot be read").format(folder.title))
    return rows


def _zip(principals: Principals, members: list[frappe._dict]) -> tuple[str, int]:
    """Write the members into one stored zip. A member whose folder is not in the zip sits at its top."""
    declared = sum(int(row.size or 0) for row in members if row.kind == "file")
    if declared > MAX_DOWNLOAD_BYTES:
        raise _too_large()
    blobs = _file_blobs(members)
    paths: dict[str, str] = {}
    taken: set[str] = set()
    written = 0
    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b") as target:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED, allowZip64=True) as archive:
            for row in members:
                parent = paths.get(row.parent_node)
                folder = f"{parent}/" if parent else ""
                if row.kind == "folder":
                    paths[row.name] = _free(folder + _segment(row.title), taken)
                    archive.writestr(paths[row.name] + "/", b"")
                elif row.kind == "file":
                    path = _free(folder + _segment(row.title), taken)
                    written = _write(archive, path, _file_stream(row, blobs), written)
                elif row.kind == "document":
                    stream, _mime, filename = content.export_document(principals, row.name)
                    written = _write(archive, _free(folder + _segment(filename), taken), stream, written)
                elif row.kind == "link":
                    shortcut = io.BytesIO(f"[InternetShortcut]\nURL={row.url or ''}\n".encode())
                    written = _write(
                        archive, _free(f"{folder}{_segment(row.title)}.url", taken), shortcut, written
                    )
        size = target.tell()
        target.seek(0)
        blob = put_blob(target, is_private=True, filename="download.zip")
    return blob.name, size


def _file_blobs(members: list[frappe._dict]) -> dict[str, frappe._dict]:
    names = tuple({row.blob for row in members if row.kind == "file" and row.blob})
    if not names:
        return {}
    found = frappe.get_all(
        "File Blob",
        filters={"name": ["in", names]},
        fields=["name", "key", "driver", "is_private", "status"],
    )
    return {blob.name: blob for blob in found}


def _file_stream(row: frappe._dict, blobs: dict[str, frappe._dict]) -> IO[bytes]:
    if not row.blob and int(row.size or 0) == 0:
        return io.BytesIO()
    blob = blobs.get(row.blob)
    if not blob or blob.status != "Ready" or not blob.is_private:
        raise DriveConflict(_("The bytes of {0} are unavailable").format(row.title))
    return get_driver(blob.driver).read(blob.key, is_private=True)


def _write(archive: zipfile.ZipFile, path: str, stream: IO[bytes], written: int) -> int:
    # Zip64 from the start: an entry's size is unknown until its stream ends,
    # and without it an entry over 2 GiB fails when it closes.
    with closing(stream), archive.open(path, "w", force_zip64=True) as destination:
        while block := stream.read(1024 * 1024):
            written += len(block)
            if written > MAX_DOWNLOAD_BYTES:
                raise _too_large()
            destination.write(block)
    return written


def _too_large() -> DriveConflict:
    """The refusal for a download over the cap. It names the cap, so the user knows what fits."""
    limit = f"{MAX_DOWNLOAD_BYTES // (1024 * 1024 * 1024)} GB"
    return DriveConflict(
        _(
            "This download is larger than {0}, the most Drive can put in one zip. Download fewer items at a time."
        ).format(limit)
    )


def _free(path: str, taken: set[str]) -> str:
    """Return `path`, or `name (2).ext` and so on when the zip already holds it."""
    head, slash, name = path.rpartition("/")
    stem, dot, extension = name.rpartition(".") if "." in name.lstrip(".") else (name, "", "")
    candidate, number = path, 1
    while candidate.casefold() in taken:
        number += 1
        candidate = f"{head}{slash}{stem} ({number}){dot}{extension}"
    taken.add(candidate.casefold())
    return candidate


def _segment(title: str) -> str:
    cleaned = re.sub(r"[\\/\x00-\x1f\x7f]", "_", (title or "download").strip())
    return "download" if cleaned in ("", ".", "..") else cleaned
