"""HTTP conditional-request evaluation (RFC 7232) against the DAV ETag scheme.

evaluate_preconditions guards every mutating verb; is_not_modified backs the
manual 304 handling on the S3 GET path (werkzeug's send_file covers local).
"""

import frappe
from werkzeug.http import parse_date
from werkzeug.wrappers import Request

from suite.drive.webdav.errors import PreconditionFailed
from suite.drive.webdav.properties import compute_etag, modified_utc


def evaluate_preconditions(request: Request, row: frappe._dict | None) -> None:
    """Raise 412 unless the request's If-* preconditions hold for the target row
    (None = unmapped URL)."""
    etag = compute_etag(row) if row is not None else None

    if_match = request.headers.get("If-Match")
    if if_match is not None:
        if row is None:
            raise PreconditionFailed("If-Match on a missing resource.")
        if if_match.strip() != "*" and etag not in _strong_etags(if_match):
            raise PreconditionFailed("If-Match did not match.")

    if_none_match = request.headers.get("If-None-Match")
    if if_none_match is not None:
        if if_none_match.strip() == "*":
            if row is not None:
                raise PreconditionFailed("Resource already exists.")
        elif etag is not None and etag in _any_etags(if_none_match):
            raise PreconditionFailed("If-None-Match matched.")

    # RFC 7232 §6 step 2 evaluates If-Unmodified-Since only "when If-Match is
    # not present". A validator the client supplied and the server matched is
    # the stronger statement about the same state, so a stale date beside it
    # must not turn an accepted write into a 412.
    if_unmodified = request.headers.get("If-Unmodified-Since")
    if if_match is None and if_unmodified is not None and row is not None:
        since = parse_date(if_unmodified)
        if since is not None and modified_utc(row).replace(microsecond=0) > since:
            raise PreconditionFailed("Resource was modified.")


def is_not_modified(request: Request, row: frappe._dict) -> bool:
    """Whether a GET/HEAD should answer 304 (S3 path — local uses send_file)."""
    if_none_match = request.headers.get("If-None-Match")
    if if_none_match is not None:
        return if_none_match.strip() == "*" or compute_etag(row) in _any_etags(if_none_match)

    if_modified = request.headers.get("If-Modified-Since")
    if if_modified is not None:
        since = parse_date(if_modified)
        return since is not None and modified_utc(row).replace(microsecond=0) <= since
    return False


def _strong_etags(header: str) -> set[str]:
    # weak validators never satisfy state-changing comparison (RFC 7232 §2.3.2)
    return {tag for tag in _split(header) if not tag.startswith("W/")}


def _any_etags(header: str) -> set[str]:
    return {tag.removeprefix("W/") for tag in _split(header)}


def _split(header: str) -> list[str]:
    return [part.strip() for part in header.split(",") if part.strip()]
