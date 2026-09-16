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
from werkzeug.utils import send_file
from werkzeug.wrappers import Response
from werkzeug.wsgi import wrap_file

from suite.drive.api.storage import acquire_owner_storage_lock, validate_quota
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

# How long a partial upload's staging file and chunk ledger are kept before
# `clear_stale_uploads` reclaims them.
UPLOAD_SESSION_TTL = 24 * 60 * 60


@frappe.whitelist(allow_guest=True)
def upload_file(
    total_file_size: int = 0,
    file_modified: int | None = None,
    fullpath: str | None = None,
    parent: str | None = None,
    embed: int = 0,
):
    """
    Accept chunked file contents via a multipart upload.
    Store the file on disk, and insert a corresponding DriveFile doc.
    Works with normal uploads, and embeds.
    :return: DriveFile doc once the entire file has been uploaded
    """
    checks = frappe.get_hooks("validate_drive_upload")
    for check in checks:
        res = frappe.call(check, file=frappe.request.files["file"], parent=parent, embed=embed)
        if res is not None and res is not True:
            frappe.throw(res or "This upload was cancelled by a validation check.", TypeError)

    parent = parent or get_user_folder().name

    if not user_has_permission(parent, "upload"):
        frappe.throw("Ask the folder owner for upload access.", frappe.PermissionError)

    if fullpath:
        parent = ensure_path(fullpath, parent)

    # Support both chunked and non-chunked uploads
    chunked = bool(frappe.form_dict.chunk_index)
    if chunked:
        current_chunk = int(frappe.form_dict.chunk_index)
        total_chunks = int(frappe.form_dict.total_chunk_count)
        offset = int(frappe.form_dict.chunk_byte_offset)
    else:
        offset = 0
        current_chunk = 0
        total_chunks = 1

    total_file_size = int(total_file_size or 0)
    file = frappe.request.files["file"]
    file_name = get_new_file_name(file.filename, parent)
    upload_session = frappe.form_dict.uuid
    if not upload_session and total_chunks == 1:
        upload_session = frappe.generate_hash(12)
    if not isinstance(upload_session, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", upload_session):
        frappe.throw("Invalid upload session.", frappe.ValidationError)

    # chunk_byte_offset is client-supplied and decides where a write lands, so
    # bound it before anything touches disk.
    if total_chunks < 1 or not 0 <= current_chunk < total_chunks:
        frappe.throw("Invalid chunk index.", frappe.ValidationError)
    if offset < 0:
        frappe.throw("Invalid chunk offset.", frappe.ValidationError)
    if chunked and total_file_size <= 0:
        frappe.throw("Chunked uploads must declare the total file size.", frappe.ValidationError)

    data = file.stream.read()
    if total_file_size and offset + len(data) > total_file_size:
        frappe.throw("Chunk falls outside the declared file size.", frappe.ValidationError)

    # Check quota before writing, not after.
    validate_quota(incoming_size=total_file_size or len(data))

    staging_name = get_staging_name(upload_session)
    staging_path = get_upload_path(staging_name)

    # pwrite at the chunk's own offset, instead of opening in append mode and
    # seeking: POSIX O_APPEND ignores the seek and always writes at EOF, so a
    # re-sent chunk (e.g. a retried upload) would duplicate bytes instead of
    # overwriting them.
    fd = os.open(staging_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        os.pwrite(fd, data, offset)
    finally:
        os.close(fd)

    # Track which chunks have actually arrived instead of inferring completion
    # from file size, which can't tell "every chunk arrived" from "one chunk
    # arrived twice".
    cache = frappe.cache()
    chunks_key = f"drive-upload-chunks:{staging_name}"
    cache.hset(chunks_key, current_chunk, len(data))
    # RedisWrapper namespaces keys inside hset/hgetall but not inside expire.
    cache.expire(cache.make_key(chunks_key), UPLOAD_SESSION_TTL)
    received = cache.hgetall(chunks_key)
    if len(received) < total_chunks:
        return

    try:
        staged_size = staging_path.stat().st_size
    except FileNotFoundError:
        # A concurrent request for this session already finalized and moved
        # the staging file; it owns the insert.
        return
    if total_file_size and (staged_size != total_file_size or sum(received.values()) != total_file_size):
        # Every index arrived but the bytes don't add up - could be a sparse
        # file (a write at a far offset inflates st_size without allocating
        # anything) or overlapping chunks. Leave it for the sweep rather than
        # committing a short or fake-sized file.
        return

    # With a complete ledger, two concurrent requests can both reach this line;
    # the winner of this claim is the one that finalizes. No TTL: a completed
    # session must never be re-finalizable, at any distance in time, not just
    # within a window - an expiring claim would let a sufficiently late resend
    # (or a deliberate replay) insert the file a second time.
    claim = cache.make_key(f"drive-upload-done:{staging_name}")
    if not cache.set(claim, frappe.session.user, nx=True):
        return

    try:
        file_size = staged_size
        acquire_owner_storage_lock(frappe.session.user)
        validate_quota(incoming_size=file_size)

        # mimemapper reads the extension off this string, not the file's actual
        # bytes - it must be the uploaded name, not the staging path, which is
        # a content-addressed `.part` file with no extension of its own.
        mime_type = mimemapper.get_mime_type(file_name, native_first=False)
        file_type = get_file_type(mime_type)
        manager = FileManager()

        drive_file = create_drive_file(
            file_name,
            parent,
            file_type,
            lambda file: "/" + str(manager.get_disk_path(file, embed)),
            mime_type,
            file_size,
            int(file_modified) / 1000 if file_modified else None,
        )

        # Upload and update parent folder size
        manager.upload_file(staging_path, drive_file, not embed)
        # Change path to be s3 compatible
        if manager.s3_enabled:
            drive_file.file_url = get_s3_url(get_s3_key(drive_file.file_url))
            drive_file.save()
    except Exception:
        # Let the same uuid be retried from scratch instead of inheriting a
        # half-finalized partial. The claim is released only here - on
        # success it is never released, so a resend of the same session
        # (e.g. the client never saw the response, or a later replay) can't
        # re-finalize and insert the file twice.
        staging_path.unlink(missing_ok=True)
        cache.delete_value(claim, make_keys=False)
        raise
    finally:
        cache.delete_value(chunks_key)

    try:
        update_file_size(parent, file_size)
    except Exception:
        # Find a cleaner way to handle folder sizes as multiple simultaneous uploads will break this
        pass

    frappe.publish_realtime("list-add", {"file": prettify_file(drive_file.as_dict())})

    return drive_file


@frappe.whitelist(allow_guest=True)
def get_thumbnail(entity_name: str):
    drive_file = frappe.get_cached_doc("File", entity_name)

    # Permission first, so callers can't probe type/existence of files they can't read.
    if not user_has_permission(drive_file, "read"):
        frappe.throw("No permission", frappe.PermissionError)

    # Thumbnails only exist for these types; bail before touching storage otherwise.
    if drive_file.is_folder or drive_file.file_type not in ("Image", "Video", "PDF"):
        return ""

    try:
        thumbnail = FileManager().get_thumbnail(entity_name)
        thumbnail_data = BytesIO(thumbnail.read())
        thumbnail.close()
    except Exception:
        return ""

    response = Response(
        wrap_file(frappe.request.environ, thumbnail_data),
        direct_passthrough=True,
    )
    response.headers.set("Content-Type", "image/webp")
    response.headers.set("Cache-Control", "private, max-age=3600")
    response.headers.set("Content-Disposition", "inline", filename=entity_name)
    return response


@frappe.whitelist()
def create_folder(file_name: str, parent: str | None = None):
    parent = parent or get_user_folder().name

    parent_doc = frappe.get_doc("File", parent)
    if not user_has_permission(parent_doc, "upload"):
        frappe.throw(
            "You don't have permissions for this.",
            frappe.PermissionError,
        )
    validate_filename(file_name, parent, "Folder", error=f"Folder '{file_name}' already exists.")

    manager = FileManager()
    path = manager.create_folder(
        frappe._dict(
            {
                "file_name": file_name,
                "parent_path": Path(storage_key(parent_doc.file_url or "")),
            }
        )
    )

    return create_drive_file(
        file_name,
        parent,
        "Folder",
        path,
    )


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
            # use the higher-level folder creation
            doc = create_folder(folder, parent=current_parent)
            current_parent = doc.name
        else:
            current_parent = exists
    return current_parent


@frappe.whitelist()
def create_link(file_name: str, link: str, parent: str | None = None):
    parent = parent or get_user_folder().name

    if not user_has_permission(parent, "upload"):
        frappe.throw(
            "Cannot create link due to insufficient permissions.",
            frappe.PermissionError,
        )

    validate_filename(file_name, parent, "Link", error=f"Link '{file_name}' already exists.")

    drive_file = frappe.get_doc(
        {
            "doctype": "File",
            "is_private": 1,
            "file_name": file_name,
            "file_url": link,
            "file_type": "Link",
            "file_modified": frappe.utils.now_datetime(),
            "folder": parent,
        }
    )
    drive_file.flags.file_created = True
    drive_file.insert()

    return drive_file


@frappe.whitelist(allow_guest=True)
def create_auth_token(entity_name: str):
    if not user_has_permission(entity_name, "read"):
        raise frappe.PermissionError("You do not have permission to view this file")
    token = frappe.get_doc(
        {
            "doctype": "Drive Token",
            "file": entity_name,
            "user": frappe.session.user,
            "expiry": frappe.utils.add_to_date(None, minutes=5),
        }
    ).insert(ignore_permissions=True)
    return token.name


@frappe.whitelist(allow_guest=True)
def get_file_content(entity_name: str, trigger_download: bool = False, token: str | None = None):
    """
    Central function to get files.
    """
    if token:
        # Single-use capability minted by create_auth_token, for cookieless
        # fetches (e.g. the Office Online preview).
        auth = frappe.db.get_value("Drive Token", token, ["file", "expiry"], as_dict=True)
        if not auth or auth.file != entity_name or frappe.utils.now_datetime() > auth.expiry:
            raise frappe.PermissionError("You do not have permission to view this file")
        frappe.delete_doc("Drive Token", token, ignore_permissions=True, force=True)
    elif not user_has_permission(entity_name, "read"):
        raise frappe.PermissionError("You do not have permission to view this file")

    file = frappe.get_value(
        "File",
        {"name": entity_name},
        [
            "name",
            "file_name",
            "file_type",
            "status",
            "file_url",
            "is_private",
            "mime_type",
        ],
        as_dict=1,
    )

    if not file or file.file_type in FORBIDDEN_DOWNLOAD_TYPES or file.status != STATUS_ACTIVE:
        frappe.throw("Not found", frappe.DoesNotExistError)

    if file.file_type == "Document":
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = "/drive/w/" + file.name
        return
    if not file.is_private:
        # Public files (adopted framework uploads) are served straight off /files.
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = file.file_url
        return

    return get_file_internal(file, trigger_download)


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
    """
    Stream file content and optionally trigger download

    :param entity_name: Document-name of the file whose content is to be streamed
    :param drive_entity: Drive Entity record object
    """
    range_header = frappe.request.headers.get("Range")
    if not range_header:
        return get_file_content(entity_name)
    entity = frappe.get_doc("File", entity_name)
    if not user_has_permission(entity, "read"):
        raise frappe.PermissionError("You do not have permission to view this file")

    if not entity.is_private:
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = entity.file_url
        return

    size = entity.file_size
    byte1, byte2 = 0, None

    m = re.search(r"(\d+)-(\d*)", range_header)
    g = m.groups()

    if g[0]:
        byte1 = int(g[0])
    if g[1]:
        byte2 = int(g[1])

    length = size - byte1

    max_length = 20 * 1024 * 1024  # 20 MB in bytes
    if length > max_length:
        length = max_length

    if byte2 is not None:
        length = byte2 - byte1

    manager = FileManager()
    data = None
    if manager.s3_enabled and not stored_on_disk(entity.file_url):
        data = manager.get_file(entity, f"bytes={byte1}-{byte1 + length - 1}")
    else:
        with manager.open_file(storage_key(entity.file_url)) as f:
            f.seek(byte1)
            data = f.read(length)

    res = Response(data, 206, mimetype=entity.mime_type, direct_passthrough=True)
    res.headers.add("Content-Range", "bytes {0}-{1}/{2}".format(byte1, byte1 + length - 1, size))
    return res


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
    """
    Favouite or unfavourite DriveEntities for specified user

    :param entities: List[dict] of document names and whether favorite
    :raises ValueError: If decoded entity_names is not a list
    """
    if clear_all:
        return frappe.db.delete("Drive Favourite", {"user": frappe.session.user})

    if not isinstance(entities, list):
        frappe.throw(f"Expected list but got {type(entities)}", ValueError)

    for entity in entities:
        existing_doc = frappe.db.exists(
            {
                "doctype": "Drive Favourite",
                "entity": entity["name"],
                "user": frappe.session.user,
            }
        )
        if not entity.get("is_favourite"):
            entity["is_favourite"] = not existing_doc

        if not isinstance(entity["is_favourite"], bool):
            entity["is_favourite"] = json.loads(entity["is_favourite"])

        if not entity["is_favourite"] and existing_doc:
            frappe.delete_doc("Drive Favourite", existing_doc)
        elif entity["is_favourite"] and not existing_doc:
            frappe.get_doc(
                {
                    "doctype": "Drive Favourite",
                    "entity": entity["name"],
                    "user": frappe.session.user,
                }
            ).insert()


@frappe.whitelist()
def remove_or_restore(entity_names: list[str] | str):
    """
    To move entities to or restore entities from the trash

    :param entity_names: List of document-names
    """
    if isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    if not isinstance(entity_names, list):
        frappe.throw(f"Expected list but got {type(entity_names)}", ValueError)
    manager = FileManager()
    locked_owners = set()

    for entity in entity_names:
        toggle_entity_status(frappe.get_doc("File", entity), manager, locked_owners)


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
    if clear_all:
        entity_names = frappe.db.get_list(
            "File", {"status": STATUS_TRASHED, "owner": frappe.session.user}, pluck="name"
        )
    elif isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    elif not isinstance(entity_names, list) or not entity_names:
        frappe.throw(f"Expected non-empty list but got {type(entity_names)}", ValueError)

    for entity in entity_names:
        frappe.get_doc("File", entity).permanent_delete()


@frappe.whitelist()
def rename(entity_name: str, new_title: str):
    drive_file = frappe.get_doc("File", entity_name)
    return drive_file.rename(new_title)


# Will be replaced after new JS composables refactor
@frappe.whitelist()
def update_access(entity_name: str, method: str, **kwargs):
    drive_file = frappe.get_doc("File", entity_name)
    kwargs.pop("cmd")
    if not drive_file:
        frappe.throw("Entity does not exist", ValueError)
    if method == "share":
        return drive_file.share(**kwargs)
    elif method == "unshare":
        return drive_file.unshare(user=kwargs.get("user"))


@frappe.whitelist()
def remove_recents(entity_names: list[str] | None = None, clear_all: bool = False):
    """
    Clear recent DriveEntities for specified user

    :param entity_names: List of document-names
    :type entity_names: list[str]
    :raises ValueError: If decoded entity_names is not a list
    """
    entity_names = entity_names or []
    if clear_all:
        return frappe.db.delete("Drive Entity Log", {"user": frappe.session.user})
    elif not isinstance(entity_names, list):
        frappe.throw(f"Expected list but got {type(entity_names)}", ValueError)

    for entity in entity_names:
        existing_doc = frappe.db.exists(
            {
                "doctype": "Drive Entity Log",
                "entity_name": entity,
                "user": frappe.session.user,
            }
        )
        if existing_doc:
            frappe.delete_doc("Drive Entity Log", existing_doc)


@frappe.whitelist()
def does_entity_exist(name: str | None = None, folder: str | None = None):
    """Whether `folder` already holds a file called `name`.

    Answers about a folder the caller cannot open are an enumeration oracle:
    the reply is derived from names the caller is not entitled to see. Gate it
    on `upload` rather than `read` - this only ever serves the uploader naming
    a file it is about to write, so it should refuse anyone who could not write
    there, and `upload_file` resolves the same folder against the same level.
    """
    if not folder:
        folder = get_user_folder().name
    if not user_has_permission(folder, "upload"):
        frappe.throw("Ask the folder owner for upload access.", frappe.PermissionError)
    result = frappe.db.exists("File", {"folder": folder, "file_name": name})
    return result


@frappe.whitelist()
def get_new_title(title: str, parent_name: str, folder: bool = False):
    """Return `title`, suffixed to avoid a collision inside `parent_name`.

    Leaks strictly more than `does_entity_exist` - the suffix is a count of the
    matching siblings - so it takes the same `upload` gate, for the same reason.
    """
    if not user_has_permission(parent_name, "upload"):
        frappe.throw("Ask the folder owner for upload access.", frappe.PermissionError)
    return get_new_file_name(title, parent_name, folder)


@frappe.whitelist()
def move(entity_names: list[str], new_parent: str | None = None):
    """
    Move file or folder to the new parent folder

    :param new_parent: Document-name of the new parent folder. Defaults to the user directory
    :raises NotADirectoryError: If the new_parent is not a folder, or does not exist
    :raises FileExistsError: If a file or folder with the same name already exists in the specified parent folder
    :return: DriveEntity doc once file is moved
    """
    if isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    if not entity_names or not isinstance(entity_names, list):
        frappe.throw(f"Expected a non-empty list but got {type(entity_names)}", ValueError)

    for entity in entity_names:
        doc = frappe.get_doc("File", entity)
        res = doc.move(new_parent)

    return res


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
    """Search active files by name, returning only rows the caller may read.

    Access cannot be resolved in the query - `file_permission_criterion` does
    not model inheritance - so it is filtered per row in Python. Filtering a
    single fixed window that way makes the reply depend on how many *unreadable*
    rows happen to sort first: a caller shared on few files gets a short page,
    or an empty one, while matches they can read sit just past the window. Walk
    successive windows instead, stopping once the page is full.
    """
    text = " ".join(k + "*" for k in query.split())
    if not text:
        return []
    try:
        rows = []
        seen = set()
        for window in range(MAX_SEARCH_SCAN_WINDOWS):
            batch = frappe.db.sql(
                SEARCH_QUERY,
                values={
                    "text": text,
                    "status": STATUS_ACTIVE,
                    "limit": SEARCH_SCAN_WINDOW,
                    "offset": window * SEARCH_SCAN_WINDOW,
                },
                as_dict=1,
            )
            for row in batch:
                # A window can overlap the one before it if rows are written
                # mid-scan; never pay for the same row - or return it - twice.
                if row.name in seen:
                    continue
                seen.add(row.name)
                # Pass the row, not its name: `user_has_permission` reloads the
                # whole document when given a string, and the access check only
                # reads fields this query already selects.
                if not user_has_permission(row, "read"):
                    continue
                rows.append(row)
                if len(rows) == SEARCH_PAGE_LENGTH:
                    return rows
            if len(batch) < SEARCH_SCAN_WINDOW:
                break
        return rows
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Frappe Drive Search Error")
        return {"error": str(e)}


@frappe.whitelist(allow_guest=True)
def translate_old_name(old_name: str):
    # The pre-team-restructure id mapping (Drive File's `old_name` field) was
    # dropped when Drive File merged into the framework File doctype, so ids
    # can only be passed through when they survived migration as File names.
    # Missing and inaccessible ids both return None so guests can't probe
    # which private files exist.
    if not frappe.db.exists("File", old_name):
        return None
    return old_name if user_has_permission(old_name, "read") else None


@frappe.whitelist(allow_guest=True)
def get_entity_type(entity_name: str):
    if not user_has_permission(entity_name, "read"):
        frappe.throw("You do not have permission to view this file.", frappe.PermissionError)

    entity = frappe.db.get_value(
        "File",
        {"status": STATUS_ACTIVE, "name": entity_name},
        ["name", "file_type"],
        as_dict=1,
    )
    if entity.file_type == "Folder":
        entity["type"] = "folder"
    else:
        entity["type"] = "file"
    return entity


@frappe.whitelist()
def get_root_folder():
    """The shared Drive tree and the caller's private folder."""
    return {"root": drive_root().name, "home": get_user_folder().name}


@frappe.whitelist(allow_guest=True)
def redirect_to_original(file_id: str):
    """
    Redirect Drive attachments to original files
    """
    file = frappe.get_cached_doc("File", file_id)
    if not user_has_permission(file_id, "read"):
        frappe.throw("You do not have permission to view this file.", frappe.PermissionError)
    if not file.content_doctype == ATTACHMENT_CONTENT_DOCTYPE:
        frappe.throw("This is not an attachment", ValueError)

    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = "/drive/g/" + file.content_docname


@frappe.whitelist()
def track_visit(
    entity_name: str | None = None,
    doctype: str | None = None,
    docname: str | None = None,
):
    if not entity_name and doctype and docname:
        entity_name = frappe.db.get_value(
            "File", {"content_doctype": doctype, "content_docname": docname}, "name"
        )
    if not entity_name:
        frappe.throw("A Drive file or content document is required", ValueError)
    entity = frappe.get_doc("File", entity_name)
    mark_as_viewed(entity)
    frappe.db.set_value(
        "Drive Notification",
        {
            "to_user": frappe.session.user,
            "notif_doctype_name": entity_name,
            "read": False,
        },
        "read",
        True,
    )


def get_staging_name(upload_session: str) -> str:
    """Staging file name for an upload session, hashed from the session user
    and upload id rather than taken from the request - `.uploads` is a single
    namespace shared by every caller, so this keeps one user's chunks out of
    another's staging file. Deliberately excludes the uploaded file's name,
    which can change mid-upload if a same-named sibling appears."""
    digest = hashlib.blake2b(f"{frappe.session.user}\0{upload_session}".encode(), digest_size=16).hexdigest()
    return f"{digest}.part"


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

    Teams became folders and their ids went with the doctype, so `/drive/t/<team>`
    can only be answered from the mapping the migration left behind. Returns None
    when there is nothing to point at, so the caller can 404 normally.
    """
    entity = frappe.db.get_value("Drive Legacy Route", old_id, "entity")
    if not entity:
        return None
    row = frappe.db.get_value("File", entity, ["name", "is_folder", "status"], as_dict=True)
    if not row or row.status != STATUS_ACTIVE:
        return None
    if not user_has_permission(entity, "read"):
        # don't confirm it exists to someone who cannot open it
        return None
    return {"name": row.name, "is_folder": bool(row.is_folder)}
