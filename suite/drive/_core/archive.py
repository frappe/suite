"""The zip writer behind Drive downloads: members in, one private File Blob out."""

import io
import re
import tempfile
import zipfile
from contextlib import closing
from typing import IO

import frappe
from frappe import _
from frappe.storage.blob import put_blob
from frappe.storage.driver import get_driver

from suite.drive._core import content
from suite.drive._core.errors import DriveConflict
from suite.drive._core.principals import Principals

MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024


def write_zip(principals: Principals, members: list[frappe._dict]) -> tuple[str, int]:
    """Write the members into one stored zip and return its private File Blob and size.

    Members come each ancestor before its descendants. A member whose folder is
    not in the zip sits at its top. A zip over `MAX_DOWNLOAD_BYTES` is refused.
    """
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
                    paths[row.name] = _free(folder + segment(row.title), taken)
                    archive.writestr(paths[row.name] + "/", b"")
                elif row.kind == "file":
                    path = _free(folder + segment(row.title), taken)
                    written = _write(archive, path, _file_stream(row, blobs), written)
                elif row.kind == "document":
                    stream, _mime, filename = content.export_document(principals, row.name)
                    written = _write(archive, _free(folder + segment(filename), taken), stream, written)
                elif row.kind == "link":
                    shortcut = io.BytesIO(f"[InternetShortcut]\nURL={row.url or ''}\n".encode())
                    written = _write(
                        archive, _free(f"{folder}{segment(row.title)}.url", taken), shortcut, written
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


def segment(title: str) -> str:
    """A title as one safe zip path segment."""
    cleaned = re.sub(r"[\\/\x00-\x1f\x7f]", "_", (title or "download").strip())
    return "download" if cleaned in ("", ".", "..") else cleaned
