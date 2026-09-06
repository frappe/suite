"""Drive-authorized browser uploads backed by trusted blob sessions."""

import frappe
from frappe import _
from frappe.storage.upload import (
    create_blob_upload,
    finish_upload_to_blob,
    upload_blob_chunk,
)

from suite.drive._core.access import require, require_link
from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive._core.nodes import _content_time, _node, _validate_parent, create_file, update
from suite.drive._core.principals import Principals
from suite.drive._core.quota import preflight, root_for_node
from suite.drive._core.roles import EDIT, UPLOAD

BINDING_TTL_SECONDS = 24 * 60 * 60
BINDING_PREFIX = "drive:blob-upload"

# `/api/suite/drive/uploads/` is a streaming request path, which is what lets a
# chunk body arrive unparsed - and also clears the framework's own
# `max_content_length`. Storage refuses a chunk that would pass the declared
# size, but only after the bytes exist, so the bound that keeps one PUT from
# pinning arbitrary memory has to be this one. It is the largest chunk a client
# may send, not a limit on the file.
MAX_CHUNK_BYTES = 16 * 1024 * 1024


def create_upload(
    principals: Principals,
    parent: str,
    filename: str,
    size: int,
    *,
    mime: str | None = None,
) -> dict:
    """Authorize and preflight a private, blob-only storage session."""
    if not isinstance(filename, str) or not filename.strip():
        frappe.throw(_("An upload filename is required"), frappe.ValidationError)
    parent_row = _node(parent)
    via_link = require(parent_row, UPLOAD, principals)
    _validate_parent(parent_row)
    root = root_for_node(parent_row)
    preflight(root, size)
    if principals.user == "Guest" and via_link is None:
        raise DriveForbidden(_("Guest uploads require a bound Drive link"))

    result = create_blob_upload(filename, size, is_private=True)
    binding = {
        "parent": parent_row.name,
        "user": principals.user,
        "authority": "link" if via_link else "own",
        "via_link": via_link,
        "filename": filename,
        "declared_size": size,
        "mime": mime,
    }
    _store_binding(result["upload_id"], binding)
    return result


def upload_chunk(
    principals: Principals,
    upload_id: str,
    offset: int,
    data: bytes,
) -> dict:
    """Reauthorize a bound chunk and stream its supplied body to storage."""
    if not isinstance(data, bytes | bytearray):
        frappe.throw(_("An upload chunk is raw bytes"), frappe.ValidationError)
    if len(data) > MAX_CHUNK_BYTES:
        frappe.throw(
            _("A Drive upload chunk may not exceed {0} bytes").format(MAX_CHUNK_BYTES),
            frappe.ValidationError,
        )
    binding = _authorized_binding(principals, upload_id)
    _reauthorize_original_destination(principals, binding)
    result = upload_blob_chunk(upload_id, offset, data)
    _store_binding(upload_id, binding)
    return result


def finish_upload(
    principals: Principals,
    upload_id: str,
    *,
    parent: str | None = None,
    title: str | None = None,
    checksum: str | None = None,
    content_modified=None,
    replaces: str | None = None,
) -> str:
    """Finish one create or replace after binding and destination reauthorization."""
    _validate_finish_arguments(parent=parent, title=title, replaces=replaces)
    normalized_content_time = _content_time(content_modified) if content_modified is not None else None
    binding = _authorized_binding(principals, upload_id)
    _reauthorize_original_destination(principals, binding)

    if replaces:
        target = _node(replaces)
        require(target, EDIT, principals)
        if target.kind != "file" or target.state != "Active":
            raise DriveForbidden(_("Only an active Drive file can be replaced"))
        if target.parent != binding["parent"]:
            raise DriveForbidden(_("The replacement is outside this upload's destination"))
    else:
        if parent != binding["parent"]:
            raise DriveForbidden(_("The finish destination does not match this upload"))
        target = _node(parent)
        require(target, UPLOAD, principals)
        _validate_parent(target)

    # Delete the binding only after storage successfully claims and finalizes
    # the session. In particular, an empty/no-data session remains retryable.
    blob = finish_upload_to_blob(upload_id, checksum=checksum)
    frappe.cache().delete_value(_binding_key(upload_id))

    if replaces:
        update(
            principals,
            replaces,
            blob=blob.name,
            size=blob.file_size,
            mime=blob.mime_type,
            content_modified=normalized_content_time,
            _via_link=binding.get("via_link"),
            _bound_parent=binding["parent"],
        )
        return replaces
    return create_file(
        principals,
        parent,
        title,
        blob=blob.name,
        size=blob.file_size,
        mime=blob.mime_type,
        content_modified=normalized_content_time,
        _via_link=binding.get("via_link"),
    )


def _validate_finish_arguments(*, parent: str | None, title: str | None, replaces: str | None) -> None:
    create = parent is not None or title is not None
    replace = replaces is not None
    valid_create = (
        isinstance(parent, str)
        and bool(parent)
        and isinstance(title, str)
        and bool(title.strip())
        and replaces is None
    )
    valid_replace = isinstance(replaces, str) and bool(replaces) and parent is None and title is None
    if create == replace or not (valid_create or valid_replace):
        frappe.throw(
            _("Finish an upload with either parent and title, or replaces"),
            frappe.ValidationError,
        )


def _authorized_binding(principals: Principals, upload_id: str) -> dict:
    if not isinstance(upload_id, str) or not upload_id or not upload_id.isascii() or not upload_id.isalnum():
        raise DriveNotFound(_("Drive upload session was not found or has expired"))
    raw = frappe.cache().get_value(_binding_key(upload_id))
    if not raw:
        raise DriveNotFound(_("Drive upload session was not found or has expired"))
    try:
        binding = frappe.parse_json(raw)
    except (TypeError, ValueError):
        raise DriveNotFound(_("Drive upload session was not found or has expired")) from None
    required = {"parent", "user", "authority", "filename", "declared_size"}
    valid_shape = (
        isinstance(binding, dict)
        and required.issubset(binding)
        and isinstance(binding.get("parent"), str)
        and bool(binding.get("parent"))
        and isinstance(binding.get("user"), str)
        and bool(binding.get("user"))
        and binding.get("authority") in ("own", "link")
        and isinstance(binding.get("filename"), str)
        and bool(binding.get("filename"))
        and isinstance(binding.get("declared_size"), int)
        and not isinstance(binding.get("declared_size"), bool)
        and binding.get("declared_size") >= 0
    )
    if not valid_shape:
        raise DriveNotFound(_("Drive upload session was not found or has expired"))
    if binding.get("user") != principals.user:
        raise DriveForbidden(_("This Drive upload belongs to another visitor"))
    via_link = binding.get("via_link")
    if binding.get("authority") == "link":
        if not via_link or via_link not in principals.open:
            raise DriveForbidden(_("This Drive upload requires its original link"))
    elif principals.user == "Guest" or binding.get("authority") != "own":
        raise DriveForbidden(_("This Drive upload has an invalid authority binding"))
    return binding


def _reauthorize_original_destination(principals: Principals, binding: dict) -> None:
    parent = _node(binding["parent"])
    _validate_parent(parent)
    via_link = binding.get("via_link")
    if via_link:
        # Preserve own-principal deny semantics while proving the exact bound
        # link remains current and unlocked. Another capability cannot take it over.
        require_link(parent, UPLOAD, principals, via_link)
        return

    own = Principals(
        user=principals.user,
        own=principals.own,
        open=("$PUBLIC",),
        is_admin=principals.is_admin,
    )
    require(parent, UPLOAD, own)


def _binding_key(upload_id: str) -> str:
    site = getattr(frappe.local, "site", None) or "no-site"
    return f"{BINDING_PREFIX}:{site}:{upload_id}"


def _store_binding(upload_id: str, binding: dict) -> None:
    frappe.cache().set_value(
        _binding_key(upload_id),
        frappe.as_json(binding),
        expires_in_sec=BINDING_TTL_SECONDS,
    )
