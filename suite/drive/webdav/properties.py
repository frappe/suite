"""Live WebDAV properties and the ETag scheme.

ETags are strong and they are the blob's own SHA-256 checksum (§12.4), which
is exactly what the framework's stream-read puts on a GET. Both sides quoting
the same value is what lets a client hand a `getetag` it read in a PROPFIND
straight back in an `If-Match`; a validator computed some other way here would
never match the one on the bytes.

A file node with no blob is §8.5's empty head, and the checksum of no bytes is
still a checksum, so it validates like any other file.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import frappe
from lxml import etree
from werkzeug.http import http_date

from suite.drive._core.nodes import EMPTY_BLOB_CHECKSUM, blob_checksums
from suite.drive.webdav.xmlutil import dav, dav_element

# `checksum` was never looked up, as opposed to looked up and absent. A batched
# caller passes what it found, None included; only an unbatched one may read.
UNREAD: str = object()  # type: ignore[assignment]


def checksums_for(rows: list[frappe._dict]) -> dict[str, str | None]:
    """One batched blob read for a whole listing, keyed by node id.

    Every row holding a blob gets a key, None included. The key is the caller's
    proof that the batch already looked, so a blob the read did not answer for
    costs no second query in the render loop.
    """
    by_blob = blob_checksums([row.blob for row in rows if row.get("blob")])
    return {row.name: by_blob.get(row.blob) for row in rows if row.get("blob")}


def compute_etag(row: frappe._dict, checksum: str | None = UNREAD) -> str | None:
    """The strong validator for one node, or None when there is not one.

    `checksum` is the blob's, when the caller has already read it for a whole
    page; passing None means the batch looked and the blob had none. Omitting
    it costs one read here, so every listing passes it in.

    A node with no blob is §8.5's empty head, and the checksum of no bytes is
    the validator the byte path publishes for it. A node naming a blob nobody
    can read has no validator at all, and no validator is the honest answer:
    the empty-bytes one would tell a client that a file with bytes is empty.
    """
    if not row.get("blob"):
        return f'"{EMPTY_BLOB_CHECKSUM}"'
    if checksum is UNREAD:
        checksum = blob_checksums([row.blob]).get(row.blob)
    return f'"{checksum}"' if checksum else None


def rfc1123(value: datetime | str) -> str:
    return http_date(_to_utc(value))


def content_time(row: frappe._dict) -> datetime | str:
    """When the node's content last changed (§8.11).

    `content_modified` is the content's own time and is what `getlastmodified`
    reports. It is null until something writes the content, and the row time is
    the only answer there is then.
    """
    return row.get("content_modified") or row.modified


def modified_utc(row: frappe._dict) -> datetime:
    return _to_utc(content_time(row))


def to_site_naive(value: datetime) -> datetime:
    """Aware datetime -> the naive site-local form the DB stores."""
    return value.astimezone(_site_zone()).replace(tzinfo=None)


def iso8601(value: datetime | str) -> str:
    return _to_utc(value).strftime("%Y-%m-%dT%H:%M:%SZ")


def live_properties(
    row: frappe._dict | None,
    *,
    is_collection: bool,
    display_name: str,
    quota: tuple[int, int] | None = None,
    checksum: str | None = UNREAD,
) -> dict[str, etree._Element | None]:
    """All live properties for one resource, keyed by Clark name; None = not
    defined for this resource (rendered as a 404 propstat when requested).

    quota = (used_bytes, limit_bytes); limit 0 means unlimited, and RFC 4331 §4
    then wants `quota-available-bytes` left out rather than guessed at.
    lockdiscovery/supportedlock are contributed by the locking module at
    assembly time.
    """
    props: dict[str, etree._Element | None] = {
        dav("displayname"): dav_element("displayname", text=display_name),
        dav("resourcetype"): _resourcetype(is_collection),
        dav("getcontentlength"): None,
        dav("getcontenttype"): None,
        dav("getetag"): None,
        dav("getlastmodified"): None,
        dav("creationdate"): None,
        dav("quota-used-bytes"): None,
        dav("quota-available-bytes"): None,
    }

    if row is not None:
        props[dav("getlastmodified")] = dav_element("getlastmodified", text=rfc1123(content_time(row)))
        props[dav("creationdate")] = dav_element("creationdate", text=iso8601(row.creation))

    if row is not None and not is_collection:
        props[dav("getcontentlength")] = dav_element("getcontentlength", text=str(row.size or 0))
        props[dav("getcontenttype")] = dav_element(
            "getcontenttype", text=row.mime or "application/octet-stream"
        )
        if etag := compute_etag(row, checksum):
            props[dav("getetag")] = dav_element("getetag", text=etag)

    if is_collection and quota is not None:
        used, limit = quota
        props[dav("quota-used-bytes")] = dav_element("quota-used-bytes", text=str(used))
        if limit:
            props[dav("quota-available-bytes")] = dav_element(
                "quota-available-bytes", text=str(max(0, limit - used))
            )

    return props


def _resourcetype(is_collection: bool) -> etree._Element:
    element = dav_element("resourcetype")
    if is_collection:
        etree.SubElement(element, dav("collection"))
    return element


def _to_utc(value: datetime | str) -> datetime:
    # naive site-local stamps are ambiguous during the DST fall-back hour;
    # fold=0 picks the earlier instant, the best the lost offset allows
    return _as_datetime(value).replace(tzinfo=_site_zone()).astimezone(UTC)


def _as_datetime(value: datetime | str) -> datetime:
    if isinstance(value, str):
        return frappe.utils.get_datetime(value)
    return value


def _site_zone() -> ZoneInfo:
    return ZoneInfo(frappe.utils.get_system_timezone())
