import hashlib
import json
import os
import re
import secrets
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import frappe
import mimemapper
from frappe.rate_limiter import rate_limit
from pypika import Order
from werkzeug.utils import secure_filename, send_file
from werkzeug.wrappers import Response
from werkzeug.wsgi import wrap_file

from suite.drive.api.storage import acquire_owner_storage_lock, validate_quota
from suite.drive.http import shims
from suite.drive.utils import (
    ATTACHMENT_CONTENT_DOCTYPE,
    STATUS_ACTIVE,
    STATUS_TRASHED,
    apply_file_size_delta,
    create_drive_file,
    get_file_type,
    get_new_file_name,
    get_user_folder,
    update_file_size,
    validate_filename,
)
from suite.drive.utils import get_root_folder as drive_root
from suite.drive.utils.api import prettify_file
from suite.drive.utils.files import (
    FileManager,
    content_disposition,
    get_s3_key,
    get_s3_url,
    storage_key,
    stored_on_disk,
)
from suite.drive.utils.users import mark_as_viewed

from .permissions import user_has_permission

FORBIDDEN_DOWNLOAD_TYPES = ["Folder", "Link", "Document", "Presentation"]


@frappe.whitelist(allow_guest=True)
def upload_file(
    total_file_size: int = 0,
    file_modified: int | None = None,
    fullpath: str | None = None,
    parent: str | None = None,
    embed: int = 0,
):
    """Accept one chunk of a multipart upload.

    §11.7 forwarder over `POST /uploads`, `PUT /uploads/<id>/chunk`, and
    `POST /uploads/<id>/finish`. It answers `None` until the last chunk lands,
    as this name always has.
    """
    checks = frappe.get_hooks("validate_drive_upload")
    for check in checks:
        res = frappe.call(check, file=frappe.request.files["file"], parent=parent, embed=embed)
        if res is not None and res is not True:
            frappe.throw(res or "This upload was cancelled by a validation check.", TypeError)
    return shims.upload_file(
        total_file_size=total_file_size,
        file_modified=file_modified,
        fullpath=fullpath,
        parent=parent,
        embed=embed,
    )


@frappe.whitelist(allow_guest=True)
def get_thumbnail(entity_name: str):
    """Serve one file's thumbnail.

    §11.7 forwarder over `GET /nodes/<id>?expand=preview`. It answers a
    redirect to the signed preview URL, or `""` when there is none.
    """
    return shims.get_thumbnail(entity_name)


@frappe.whitelist()
def create_folder(file_name: str, parent: str | None = None):
    """Create a folder. §11.7 forwarder over `POST /nodes` `kind=folder`."""
    return shims.create_folder(file_name, parent)


def ensure_path(fullpath, parent=None):
    """
    Walk through a folder path and ensure every part exists.

    :param fullpath: Path string, e.g. "foo/bar/baz"
    :param parent: Optional starting folder (defaults to the user folder)
    :return: The name of the deepest folder
    """
    parts = Path(fullpath).parts
    current_parent = parent or get_user_folder().name

    for folder in parts[:-1]:
        exists = frappe.db.get_value(
            "File",
            {
                "file_name": folder,
                "is_folder": 1,
                "status": STATUS_ACTIVE,
                "folder": current_parent,
            },
            "name",
        )
        if not exists:
            # use the higher-level folder creation, which answers the legacy
            # columns as a plain dict now that it forwards (§11.7)
            current_parent = create_folder(folder, parent=current_parent)["name"]
        else:
            current_parent = exists
    return current_parent


@frappe.whitelist()
def create_link(file_name: str, link: str, parent: str | None = None):
    """Create a link. §11.7 forwarder over `POST /nodes` `kind=link`."""
    return shims.create_link(file_name, link, parent)


@frappe.whitelist(allow_guest=True)
def create_auth_token(entity_name: str):
    """Retired. §8.4 replaced the one-shot download token with a signed URL."""
    return shims.create_auth_token(entity_name)


@frappe.whitelist(allow_guest=True)
def get_file_content(entity_name: str, trigger_download: bool = False, token: str | None = None):
    """Serve one file's bytes.

    §11.7 forwarder over `GET /nodes/<id>/content`, which answers a redirect
    to a signature that lives fifteen minutes.
    """
    return shims.get_file_content(entity_name, trigger_download, token)


def _serve_resumable(manager, key, download_name, mime_type=None):
    """Range/resume-capable download served by storage, not this worker.

    S3 → presigned URL; disk+nginx → X-Accel-Redirect; disk → send_file.
    """
    if manager.s3_enabled and not stored_on_disk(key):
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = manager.presigned_url(key, download_name, mime_type)
        return

    xaccel_prefix = frappe.conf.get("drive_xaccel_prefix")
    if xaccel_prefix:
        key = str(manager.get_local_path(key).relative_to(manager.site_folder.resolve()))
        response = Response(status=200)
        # header values must be latin-1 and nginx expects an encoded URI
        response.headers["X-Accel-Redirect"] = f"{xaccel_prefix.rstrip('/')}/{quote(key)}"
        response.headers["Content-Disposition"] = content_disposition(download_name)
        if mime_type:
            response.headers["Content-Type"] = mime_type
        return response

    response = send_file(
        str(manager.get_local_path(key)),
        mimetype=mime_type or "application/octet-stream",
        as_attachment=True,
        download_name=download_name,
        conditional=True,
        max_age=0,
        environ=frappe.request.environ,
    )
    # advertise ranges on the 200 too, so browsers resume rather than restart
    response.headers["Accept-Ranges"] = "bytes"
    return response


def get_file_internal(file, trigger_download=0):
    if not trigger_download and file.file_type == "Video" and frappe.request.headers.get("Range"):
        return stream_file_content(file.name)

    manager = FileManager()
    if trigger_download:
        return _serve_resumable(manager, storage_key(file.file_url), file.file_name, file.get("mime_type"))
    return send_file(
        manager.get_file(file),
        as_attachment=False,
        conditional=True,
        max_age=3600,
        download_name=file.file_name,
        environ=frappe.request.environ,
    )


@frappe.whitelist(allow_guest=True)
def stream_file_content(entity_name: str):
    """Serve one file's bytes with range support.

    §11.7 forwarder over `GET /nodes/<id>/content`. Ranges are answered by
    storage behind the signed URL, not by this worker.
    """
    return shims.stream_file_content(entity_name)


def _iter_folder_files(entity_name, prefix=""):
    """Recursively yield (arcname, file) for downloadable files in a folder.

    Read is checked per child, not once at the top: access does not simply cascade
    — a deny row anywhere below cuts it, and the Drive root is readable by every
    logged-in user, so a single top-level check would hand out the whole tree.

    Writer documents and links have no underlying blob, so they're skipped.
    """
    children = frappe.get_all(
        "File",
        filters={"folder": entity_name, "status": STATUS_ACTIVE},
        fields=["name", "file_name", "is_folder", "file_type", "file_url"],
    )
    for child in children:
        if not user_has_permission(child.name, "read"):
            continue
        arcname = f"{prefix}{child.file_name}"
        if child.is_folder:
            yield from _iter_folder_files(child.name, prefix=f"{arcname}/")
        elif child.file_type not in FORBIDDEN_DOWNLOAD_TYPES and child.file_url:
            yield arcname, child


def _collect_download_files(entity_names):
    """Expand the selected top-level entities into (arcname, file) pairs.

    Read is checked here and again per descendant in `_iter_folder_files`; a single
    folder nests its contents under its own file name.
    """
    for name in entity_names:
        if not user_has_permission(name, "read"):
            raise frappe.PermissionError("You do not have permission to download this file")
        entity = frappe.get_value(
            "File",
            name,
            ["name", "file_name", "is_folder", "file_type", "file_url", "status"],
            as_dict=True,
        )
        if not entity or entity.status != STATUS_ACTIVE:
            continue
        if entity.is_folder:
            yield from _iter_folder_files(entity.name, prefix=f"{entity.file_name}/")
        elif entity.file_type not in FORBIDDEN_DOWNLOAD_TYPES and entity.file_url:
            yield entity.file_name, entity


DOWNLOAD_TTL = 60 * 60  # finished archives live for an hour
# a build's cache entry must outlive queue wait + the job timeout, or polls 404
# on a still-running build
BUILDING_TTL = 3 * 60 * 60
ARCHIVE_DIR = "private/files/.drive-downloads"


def _download_cache_key(token):
    return f"drive-download:{token}"


def _build_zip(manager, files, fileobj):
    """Write a ZIP_STORED archive to a seekable file, streaming each file in."""
    with zipfile.ZipFile(fileobj, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for arcname, child in files:
            info = zipfile.ZipInfo(arcname)
            info.compress_type = zipfile.ZIP_STORED
            with zf.open(info, "w") as dest:
                for block in manager.iter_blocks(child):
                    dest.write(block)


def _write_archive(token, files):
    """Build the zip into storage; return (storage_key, size). S3 builds to
    a temp file then uploads so nothing lands half-formed."""
    manager = FileManager()
    key = f"{ARCHIVE_DIR}/{token}.zip"
    if manager.s3_enabled:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with open(tmp_path, "wb") as fh:
                _build_zip(manager, files, fh)
            size = os.path.getsize(tmp_path)
            s3_key = f".drive-downloads/{token}.zip"
            manager.conn.upload_file(tmp_path, manager.bucket, s3_key)
            return s3_key, size
        finally:
            os.remove(tmp_path)
    else:
        target = manager.site_folder / key
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as fh:
            _build_zip(manager, files, fh)
        return key, os.path.getsize(target)


def _publish_download_status(token, user, status, **extra):
    """Push the terminal build state over the user's realtime room so the
    client can drop polling and just listen."""
    frappe.publish_realtime("drive-download-status", {"token": token, "status": status, **extra}, user=user)


def build_download_archive(token, entities, zip_name, user):
    """Background job: build the archive as `user` and publish its state to cache."""
    cache = frappe.cache()
    cache_key = _download_cache_key(token)
    frappe.set_user(user)
    try:
        files = list(_collect_download_files(entities))
        if not files:
            raise frappe.NotFound("No downloadable files found")
        key, size = _write_archive(token, files)
        cache.set_value(
            cache_key,
            {"status": "ready", "owner": user, "key": key, "file_name": zip_name, "size": size},
            expires_in_sec=DOWNLOAD_TTL,
        )
        _publish_download_status(token, user, "ready", size=size)
    except Exception as e:
        frappe.log_error("Drive: archive build failed", e)
        cache.set_value(
            cache_key,
            {"status": "failed", "owner": user, "error": str(e)},
            expires_in_sec=DOWNLOAD_TTL,
        )
        _publish_download_status(token, user, "failed", error=str(e))


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=10, seconds=10 * 60)
def download_folder(entities: str):
    """Enqueue a zip build and return a token; client polls download_status then
    fetches download_archive. Avoids timing out large folders into a corrupt zip.

    :param entities: JSON list of File names (the user's selection)
    """
    if isinstance(entities, str):
        entities = frappe.parse_json(entities)
    if not entities:
        frappe.throw("Nothing to download", ValueError)

    # resolve up front so a permission error surfaces here, not in the job
    files = list(_collect_download_files(entities))
    if not files:
        frappe.throw("No downloadable files found", frappe.NotFound)

    cache = frappe.cache()
    user = frappe.session.user

    # same selection already building or built → hand back that token instead of
    # burning another job + artifact
    selection_key = (
        f"drive-download-sel:{user}:{hashlib.sha1(json.dumps(sorted(entities)).encode()).hexdigest()}"
    )
    existing = cache.get_value(selection_key)
    if existing:
        entry = cache.get_value(_download_cache_key(existing))
        if entry and entry.get("status") in ("building", "ready"):
            return {"token": existing, "file_name": entry["file_name"]}

    if len(entities) == 1:
        zip_name = f"{frappe.get_value('File', entities[0], 'file_name')}.zip"
    else:
        zip_name = f"Drive Download {frappe.utils.now()}.zip"

    token = secrets.token_urlsafe(24)
    cache.set_value(
        _download_cache_key(token),
        {"status": "building", "owner": user, "file_name": zip_name},
        expires_in_sec=BUILDING_TTL,
    )
    cache.set_value(selection_key, token, expires_in_sec=BUILDING_TTL)
    frappe.enqueue(
        "suite.drive.api.files.build_download_archive",
        queue="long",
        timeout=3600,
        token=token,
        entities=entities,
        zip_name=zip_name,
        user=user,
    )
    return {"token": token, "file_name": zip_name}


def _get_download_entry(token):
    entry = frappe.cache().get_value(_download_cache_key(token))
    if not entry or entry.get("owner") != frappe.session.user:
        frappe.throw("Not found", frappe.DoesNotExistError)
    return entry


@frappe.whitelist(allow_guest=True)
def download_status(token: str):
    """Poll the state of an archive build: building | ready | failed."""
    entry = _get_download_entry(token)
    return {"status": entry["status"], "error": entry.get("error"), "size": entry.get("size")}


@frappe.whitelist(allow_guest=True)
def download_archive(token: str):
    """Serve a finished archive as a Range/resume-capable download."""
    entry = _get_download_entry(token)
    if entry.get("status") != "ready":
        frappe.throw("Not found", frappe.DoesNotExistError)
    return _serve_resumable(FileManager(), entry["key"], entry["file_name"], "application/zip")


@frappe.whitelist()
def set_favourite(entities: list | None = None, clear_all: bool = False):
    """Set or clear favourite marks.

    §11.7 forwarder over `PUT`/`DELETE /nodes/<id>/favourite`.
    """
    return shims.set_favourite(entities, clear_all)


@frappe.whitelist()
def remove_or_restore(entity_names: list[str] | str):
    """Trash active entities, or restore trashed ones.

    §11.7 forwarder over `PATCH /nodes/<id>` `{state}`. A restore names no
    destination: §8.7 puts a node back where it was, and refuses when that
    place is gone.
    """
    return shims.remove_or_restore(entity_names)


def toggle_entity_status(doc, manager: FileManager, locked_owners: set):
    """Trash an Active entity, or restore a Trashed one. Shared by
    remove_or_restore and WebDAV DELETE."""
    # row lock before the disk transfer — same discipline as File.move()
    frappe.db.get_value("File", doc.name, "name", for_update=True)
    if not user_has_permission(doc, "write"):
        raise frappe.PermissionError("You do not have permission to remove this file")
    if doc.owner not in locked_owners:
        acquire_owner_storage_lock(doc.owner)
        locked_owners.add(doc.owner)
    if doc.status == STATUS_ACTIVE:
        flag = STATUS_TRASHED
        manager.move_to_trash(doc)
    else:
        validate_quota(doc.owner, doc.file_size)
        # A trashed name is free — get_new_file_name only counts Active siblings —
        # so something may have taken it. Restoring onto it would overwrite the
        # newcomer's blob, or, for a folder, land inside it.
        available = get_new_file_name(doc.file_name, doc.folder, doc.file_type, doc.name)
        if available != doc.file_name:
            doc.flags.drive_disk_rename = True
            doc.file_name = available
            if not manager.flat and not doc._not_in_disk():
                doc.file_url = str(manager.get_disk_path(doc)) + ("/" if doc.is_folder else "")
        manager.restore(doc)
        flag = STATUS_ACTIVE

    doc.status = flag
    doc.file_modified = frappe.utils.now_datetime()
    if doc.folder and doc.file_size:
        apply_file_size_delta(doc.folder, doc.file_size * (1 if flag == STATUS_ACTIVE else -1))

    doc.save()


@frappe.whitelist()
def delete_entities(entity_names: list[str] | None = None, clear_all: bool = False):
    """Purge trashed entities.

    §11.7 forwarder over `DELETE /nodes/<id>`.
    """
    return shims.delete_entities(entity_names, clear_all)


@frappe.whitelist()
def rename(entity_name: str, new_title: str):
    """Rename one entity. §11.7 forwarder over `PATCH /nodes/<id>` `{title}`."""
    return shims.rename(entity_name, new_title)


# Will be replaced after new JS composables refactor
@frappe.whitelist()
def update_access(entity_name: str, method: str, **kwargs):
    """Share or unshare one entity.

    §11.7 forwarder over `PUT`/`DELETE /nodes/<id>/grants/<principal>`. An
    unshare removes the row and writes nothing: §5.10 keeps removal and denial
    apart, so a client that wants a denial has to ask for one.
    """
    kwargs.pop("cmd", None)
    return shims.update_access(entity_name, method, **kwargs)


@frappe.whitelist()
def remove_recents(entity_names: list[str] | None = None, clear_all: bool = False):
    """Clear the caller's recent rows.

    §11.7 forwarder over `DELETE /views/recents`. An empty list still clears
    nothing.
    """
    return shims.remove_recents(entity_names, clear_all)


@frappe.whitelist()
def does_entity_exist(name: str | None = None, folder: str | None = None):
    """Whether `folder` already holds a file called `name`.

    §11.7 forwarder. It keeps the `upload` gate the old body used: the answer
    is derived from names in a folder, so a caller who could not write there
    is not entitled to it.
    """
    return shims.does_entity_exist(name, folder)


@frappe.whitelist()
def get_new_title(title: str, parent_name: str, folder: bool = False):
    """Retired. §8.6 refuses a sibling collision instead of renaming around it."""
    return shims.get_new_title(title, parent_name, folder)


@frappe.whitelist()
def move(entity_names: list[str], new_parent: str | None = None):
    """Move entities into a new parent.

    §11.7 forwarder over `PATCH /nodes/<id>` `{parent}`.
    """
    return shims.move(entity_names, new_parent)


# `search` resolves access one row at a time, so the rows it scans are not the
# rows it can return. Walk the match set in windows and keep only what the
# caller may read, until the page is full or the scan budget is spent.
SEARCH_PAGE_LENGTH = 50
SEARCH_SCAN_WINDOW = 100
MAX_SEARCH_SCAN_WINDOWS = 10

SEARCH_QUERY = """
        SELECT  `tabFile`.name,
                `tabFile`.file_name,
                `tabFile`.file_type,
                `tabFile`.is_folder,
                `tabFile`.owner,
                `tabFile`.attached_to_doctype,
                `tabFile`.attached_to_name,
                `tabFile`.content_doctype,
                `tabFile`.content_docname,
                `tabUser`.name AS user_name,
                `tabUser`.user_image,
                `tabUser`.full_name
        FROM `tabFile`
        LEFT JOIN `tabUser` ON `tabFile`.`owner` = `tabUser`.`name`
        WHERE `tabFile`.`status` = %(status)s
            AND COALESCE(`tabFile`.`folder`, '') <> ''
            AND MATCH(`tabFile`.file_name) AGAINST (%(text)s IN BOOLEAN MODE)
        GROUP BY `tabFile`.`name`
        ORDER BY MATCH(`tabFile`.file_name) AGAINST (%(text)s IN BOOLEAN MODE) DESC,
                 `tabFile`.`name` ASC
        LIMIT %(limit)s OFFSET %(offset)s
        """


@frappe.whitelist()
def search(query: str):
    """Search active files by name.

    §11.7 forwarder over `GET /views/search`.
    """
    return shims.search(query)


@frappe.whitelist(allow_guest=True)
def translate_old_name(old_name: str):
    # The pre-team-restructure id mapping (Drive File's `old_name` field) was
    # dropped when Drive File merged into the framework File doctype, so ids
    # can only be passed through when they survived migration as File names.
    # Missing and inaccessible ids both return None so guests can't probe
    # which private files exist.
    """Answer a pre-migration id with the id it is now.

    §14.3 gives every node the id its `File` row had, so the id is returned
    unchanged when the caller may read it. Missing and unreadable both answer
    `None`, so a guest cannot probe which private files exist.
    """
    return shims.translate_old_name(old_name)


@frappe.whitelist(allow_guest=True)
def get_entity_type(entity_name: str):
    """Answer whether an entity is a folder or a file.

    §11.7 forwarder over `GET /nodes/<id>`.
    """
    return shims.get_entity_type(entity_name)


@frappe.whitelist()
def get_root_folder():
    """The shared Drive tree and the caller's private folder.

    §11.7 forwarder over `_core.roots`. §11.2 has no root-discovery route, so
    this is where a client still bootstraps from.
    """
    return shims.get_root_folder()


@frappe.whitelist(allow_guest=True)
def redirect_to_original(file_id: str):
    """Redirect a Drive attachment to the document it belongs to.

    §11.7 forwarder over `GET /nodes/<id>`. §14.4 drops the content link on an
    adopted attachment, so after Build this refuses exactly as the old body
    refused a row that was not an attachment.
    """
    return shims.redirect_to_original(file_id)


@frappe.whitelist()
def track_visit(
    entity_name: str | None = None,
    doctype: str | None = None,
    docname: str | None = None,
):
    """Record that the caller opened an entity.

    §11.7 forwarder over `POST /nodes/<id>/visit`, plus the unread
    notifications about that node, which the old body also cleared.
    """
    return shims.track_visit(entity_name, doctype, docname)


def get_upload_path(file_name):
    root_folder = frappe.get_single("Drive Disk Settings").root_folder or ""
    uploads_path = Path(frappe.get_site_path("private/files"), root_folder, ".uploads")
    uploads_path.mkdir(exist_ok=True)
    uploads_path = uploads_path.resolve()
    upload_path = (uploads_path / file_name).resolve()
    if not upload_path.is_relative_to(uploads_path):
        frappe.throw("Invalid upload path.", frappe.ValidationError)
    return upload_path


@frappe.whitelist()
def resolve_legacy_route(old_id: str):
    """Where a pre-migration team link should land now.

    §11.7 forwarder over `Drive Legacy Route`, then a readability check on the
    id it names. Returns `None` when there is nothing to point at, so the
    caller can 404 normally and nobody learns a private file exists.
    """
    return shims.resolve_legacy_route(old_id)
