"""Drive-authorized browser uploads backed by trusted blob sessions."""

import math

import frappe
from frappe import _
from frappe.storage.upload import (
    create_blob_upload,
    finish_upload_to_blob,
    upload_blob_chunk,
)

from suite.drive._core.access import require, require_link
from suite.drive._core.errors import DriveFileTooLarge, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import (
    _content_time,
    _lock_create_parent,
    _node,
    _refuse_sibling_collision,
    _validate_parent,
    create_file,
    update,
)
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
    replaces: str | None = None,
) -> dict:
    """Authorize and preflight a private, blob-only storage session.

    A `size` above the site's per-file limit is `DriveFileTooLarge`; one the
    root has no room for is `DriveOverQuota`. A `filename` an Active sibling
    holds is refused with the free title (§8.6), before a byte moves.
    `finish_upload` checks again, because the title can be taken while the
    bytes travel.

    `replaces` opens a replace session for one Active file below `parent`,
    under EDIT on that file. Its own title does not block `filename`; any
    other sibling's does. The session can only finish as that replace. Its
    preflight asks only for the growth over that file's head, because the
    finish releases the old head before it admits the new one (§8.5).
    """
    if not isinstance(filename, str) or not filename.strip():
        frappe.throw(_("An upload filename is required"), frappe.ValidationError)
    parent_row = _node(parent)
    via_link = require(parent_row, UPLOAD, principals)
    _validate_parent(parent_row)
    # Before the counter is read: a Guest with no bound link learns nothing
    # about how full the root is.
    if principals.user == "Guest" and via_link is None:
        raise DriveForbidden(_("Guest uploads require a bound Drive link"))
    replaced_bytes = 0
    if replaces is not None:
        replaced_bytes = int(_require_replaceable(principals, replaces, parent_row.name).size or 0)
    # Before the title and the quota: a file the site never accepts gets that
    # answer, not a rename prompt or a full-storage refusal that stops a batch.
    _refuse_over_site_limit(size)
    _refuse_sibling_collision(parent_row.name, filename, exclude=replaces, for_update=False)
    root = root_for_node(parent_row)
    preflight(root, max(size - replaced_bytes, 0))

    result = create_blob_upload(filename, size, is_private=True)
    binding = {
        "parent": parent_row.name,
        "user": principals.user,
        "authority": "link" if via_link else "own",
        "via_link": via_link,
        "filename": filename,
        "declared_size": size,
        "mime": mime,
        "replaces": replaces,
    }
    _store_binding(result["upload_id"], binding)
    return result


def _refuse_over_site_limit(size: int) -> None:
    """Refuse a file above the site's per-file limit as `DriveFileTooLarge`.

    The limit is Frappe's `max_file_size`, the one every Frappe upload path
    reads; Suite sets it to 1 GB on install unless the site has its own.
    `create_blob_upload` would refuse the same size with
    `MaxFileSizeReachedError`, a plain `ValidationError` that the boundary can
    only score 400, so the bound is read here and reported in Drive's own
    class. It is not `DriveOverQuota`: the root may have room, and the other
    files of a batch can still go (§11.2, §11.6).
    """
    from frappe.core.api.file import get_max_file_size

    limit = get_max_file_size()
    if size > limit:
        raise DriveFileTooLarge(
            _("Files can be up to {0}. This one is {1}.").format(
                _readable_size(limit), _readable_size(size, round_up=True)
            )
        )


def _readable_size(size: int, *, round_up: bool = False) -> str:
    """A byte count as people read it: `512 B`, `1.2 GB`, `1 GB`.

    Base 1024, like `max_file_size` in MB. `round_up` keeps a file just over
    the limit from reading as the limit itself. The upload queue words its own
    copy of this refusal the same way (`formatSize` in `uploads/format.ts`).
    """
    value = float(max(size, 0))
    units = ("B", "KB", "MB", "GB", "TB")
    unit = 0
    while value >= 1024 and unit < len(units) - 1:
        value /= 1024
        unit += 1
    scale = 1 if unit == 0 or value >= 100 else 10
    # The epsilon keeps float noise (1.2 * 10 is 12.000000000000002) from rounding up.
    value = math.ceil(value * scale - 1e-9) / scale if round_up else round(value * scale) / scale
    return f"{value:g} {units[unit]}"


def authorize_chunk(principals: Principals, upload_id: str) -> dict:
    """Prove the caller may write to this session, before its body is read.

    A chunk body is up to `MAX_CHUNK_BYTES`, and reading it is the expensive
    part of the request. An adapter calls this first so an unknown or
    unauthorized session costs one cache read instead of 16 MiB of memory.
    """
    binding = _authorized_binding(principals, upload_id)
    _reauthorize_original_destination(principals, binding)
    return binding


def upload_chunk(
    principals: Principals,
    upload_id: str,
    offset: int,
    data: bytes,
    *,
    binding: dict | None = None,
) -> dict:
    """Reauthorize a bound chunk and stream its supplied body to storage."""
    if binding is None:
        binding = authorize_chunk(principals, upload_id)
    if not isinstance(data, bytes | bytearray):
        frappe.throw(_("An upload chunk is raw bytes"), frappe.ValidationError)
    if len(data) > MAX_CHUNK_BYTES:
        frappe.throw(
            _("A Drive upload chunk may not exceed {0} bytes").format(MAX_CHUNK_BYTES),
            frappe.ValidationError,
        )
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

    if binding.get("replaces") and replaces != binding["replaces"]:
        raise DriveForbidden(_("This upload can only replace the file it was opened for"))
    if replaces:
        _require_replaceable(principals, replaces, binding["parent"])
    else:
        if parent != binding["parent"]:
            raise DriveForbidden(_("The finish destination does not match this upload"))
        # The collision check runs under the parent-chain lock that
        # `create_file` takes again below, and before storage claims the
        # session. A finish that lost its title to a concurrent one is refused
        # with the free title and keeps its session, so the client can retry.
        target = _lock_create_parent(parent)
        require(target, UPLOAD, principals)
        _validate_parent(target)
        _refuse_sibling_collision(target.name, title)

    # Delete the binding only after storage successfully claims and finalizes
    # the session. In particular, an empty/no-data session remains retryable.
    #
    # The blob below is the one this bound session just stored, so neither
    # write is a client naming bytes it learned: §8.4's binding is already the
    # proof. `nodes.create`'s `_client_named_blob` proof is for the §11.2 door
    # that has no session to show.
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
            # §8.5: a browser replace keeps no version of the old head.
            _keep_old_head=False,
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


def _require_replaceable(principals: Principals, replaces: str, parent: str) -> frappe._dict:
    target = _node(replaces)
    require(target, EDIT, principals)
    if target.kind != "file" or target.state != "Active":
        raise DriveForbidden(_("Only an active Drive file can be replaced"))
    if target.parent != parent:
        raise DriveForbidden(_("The replacement is outside this upload's destination"))
    return target


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
        and (
            binding.get("replaces") is None
            or (isinstance(binding["replaces"], str) and bool(binding["replaces"]))
        )
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
