"""Authorized, synchronous folder archive builds."""

import io
import re
import tempfile
import zipfile
from contextlib import closing

import frappe
from frappe import _
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver

from suite.drive._core import content
from suite.drive._core import nodes as node_core
from suite.drive._core.errors import DriveConflict, DriveNotFound
from suite.drive._core.principals import Principals

ARCHIVE_TTL_SECONDS = 60 * 60
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def start(principals: Principals, node: str) -> dict:
    """Build one readable folder archive now and return its terminal status."""
    folder, rows = _authorized_rows(principals, node)
    key = _cache_key(principals.user, folder.name)
    frappe.cache().set_value(
        key,
        {"status": "building", "file_name": f"{_segment(folder.title)}.zip"},
        expires_in_sec=ARCHIVE_TTL_SECONDS,
    )
    try:
        blob, size = _build(principals, folder, rows)
    except Exception as error:
        frappe.cache().set_value(
            key,
            {"status": "failed", "error": str(error)},
            expires_in_sec=ARCHIVE_TTL_SECONDS,
        )
        raise
    answer = {
        "status": "ready",
        "file_name": f"{_segment(folder.title)}.zip",
        "size": size,
        "blob": blob,
    }
    frappe.cache().set_value(key, answer, expires_in_sec=ARCHIVE_TTL_SECONDS)
    return _public_status(answer)


def status(principals: Principals, node: str) -> dict:
    """Return this caller's current archive build state for one folder."""
    folder = _folder(principals, node)
    entry = frappe.cache().get_value(_cache_key(principals.user, folder.name))
    if not isinstance(entry, dict):
        raise DriveNotFound(_("No Drive archive build was found"))
    return _public_status(entry)


def download(principals: Principals, node: str) -> tuple[frappe.model.document.Document, str]:
    """Return the ready private blob and filename after a fresh folder check."""
    folder = _folder(principals, node)
    entry = frappe.cache().get_value(_cache_key(principals.user, folder.name))
    if not isinstance(entry, dict) or entry.get("status") != "ready" or not entry.get("blob"):
        raise DriveNotFound(_("The Drive archive is not ready"))
    try:
        blob = frappe.get_doc("File Blob", entry["blob"])
    except frappe.DoesNotExistError:
        raise DriveNotFound(_("The Drive archive is no longer available")) from None
    if blob.status != "Ready" or not blob.is_private:
        raise DriveNotFound(_("The Drive archive is no longer available"))
    return blob, entry.get("file_name") or f"{_segment(folder.title)}.zip"


def _authorized_rows(principals: Principals, node: str) -> tuple[frappe._dict, list[frappe._dict]]:
    folder = _folder(principals, node)
    prefix = f"{folder.path or '/'}{folder.name}/%"
    descendants = frappe.db.sql(
        f"""
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
        """,
        {"root": folder.root, "prefix": prefix},
        as_dict=True,
    )
    checked = node_core._readable_rows(descendants, principals)
    if len(checked) != len(descendants):
        raise DriveNotFound(_("A node in this Drive folder cannot be read"))
    return folder, [folder, *descendants]


def _folder(principals: Principals, node: str) -> frappe._dict:
    folder = node_core.get(principals, node)
    if folder.kind != "folder" or folder.state != "Active":
        raise DriveConflict(_("Only an active Drive folder can be archived"))
    return folder


def _build(principals: Principals, folder: frappe._dict, rows: list[frappe._dict]) -> tuple[str, int]:
    declared = sum(int(row.size or 0) for row in rows if row.kind == "file")
    if declared > MAX_ARCHIVE_BYTES:
        raise DriveConflict(_("This Drive folder is too large to archive synchronously"))

    blob_names = tuple({row.blob for row in rows if row.blob})
    blobs = (
        {
            row.name: row
            for row in frappe.get_all(
                "File Blob",
                filters={"name": ["in", blob_names]},
                fields=["name", "key", "driver", "is_private", "status"],
            )
        }
        if blob_names
        else {}
    )
    paths = {folder.name: _segment(folder.title)}
    written = 0
    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b") as target:
        with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED, allowZip64=True) as archive:
            archive.writestr(paths[folder.name] + "/", b"")
            for row in rows[1:]:
                parent = paths.get(row.parent)
                if parent is None:
                    raise DriveConflict(_("The Drive folder tree is inconsistent"))
                path = f"{parent}/{_segment(row.title)}"
                paths[row.name] = path
                if row.kind == "folder":
                    archive.writestr(path + "/", b"")
                elif row.kind == "file":
                    written = _write_file(archive, path, row, blobs, written)
                elif row.kind == "document":
                    stream, _mime, filename = content.export_document(principals, row.name)
                    written = _write_stream(archive, f"{parent}/{_segment(filename)}", stream, written)
                elif row.kind == "link":
                    written = _write_stream(
                        archive,
                        path + ".url",
                        io.BytesIO(f"[InternetShortcut]\nURL={row.url or ''}\n".encode()),
                        written,
                    )
        size = target.tell()
        target.seek(0)
        blob = put_blob(target, is_private=True, filename=f"{_segment(folder.title)}.zip")
    return blob.name, size


def _write_file(archive, path, row, blobs, written: int) -> int:
    if not row.blob and int(row.size or 0) == 0:
        return _write_stream(archive, path, io.BytesIO(), written)
    blob = blobs.get(row.blob)
    if not blob or blob.status != "Ready" or not blob.is_private:
        raise DriveConflict(_("Drive file bytes are unavailable"))
    stream = get_driver(blob.driver).read(blob.key, is_private=True)
    return _write_stream(archive, path, stream, written)


def _write_stream(archive, path: str, stream, written: int) -> int:
    with closing(stream), archive.open(path, "w") as destination:
        while block := stream.read(1024 * 1024):
            written += len(block)
            if written > MAX_ARCHIVE_BYTES:
                raise DriveConflict(_("This Drive folder is too large to archive synchronously"))
            destination.write(block)
    return written


def _cache_key(user: str, node: str) -> str:
    return f"drive:folder-archive:{user}:{node}"


def _public_status(entry: dict) -> dict:
    return {
        "status": entry.get("status"),
        "file_name": entry.get("file_name"),
        "size": entry.get("size"),
        "error": entry.get("error"),
    }


def _segment(title: str) -> str:
    cleaned = re.sub(r"[\\/\x00-\x1f\x7f]", "_", (title or "download").strip())
    return "download" if cleaned in ("", ".", "..") else cleaned
