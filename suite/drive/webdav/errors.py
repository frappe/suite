"""DAV error hierarchy and mapping of Drive/frappe exceptions to DAV statuses.

This module must not import other webdav modules (everything imports it).
The tiny <D:error> bodies are built by hand so no XML library is needed here.
"""

from contextlib import contextmanager
from xml.sax.saxutils import escape

import frappe
from werkzeug.exceptions import HTTPException
from werkzeug.wrappers import Response

# The realm `auth.REALM` names. Repeated rather than imported: every WebDAV
# module imports this one, so it may import none of them.
BASIC_CHALLENGE = 'Basic realm="Frappe Drive", charset="UTF-8"'


class DAVError(Exception):
    status = 500

    def __init__(
        self,
        message: str = "",
        *,
        headers: dict[str, str] | None = None,
        condition: str | None = None,
        condition_href: str | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.headers = headers or {}
        # DAV: precondition/postcondition element for the <D:error> body (RFC 4918 §16)
        self.condition = condition
        self.condition_href = condition_href


class BadRequest(DAVError):
    status = 400


class AuthRequired(DAVError):
    status = 401

    def __init__(self, message: str = "", **kwargs):
        super().__init__(message, **kwargs)
        # RFC 7235: a 401 with no challenge gives a client nothing to retry
        # with, and DAV clients only speak Basic. `auth._challenge` builds the
        # same string; this covers the 401s that arrive from anywhere else.
        self.headers.setdefault("WWW-Authenticate", BASIC_CHALLENGE)


class Forbidden(DAVError):
    status = 403


class NotFoundError(DAVError):
    status = 404


class MethodNotAllowed(DAVError):
    status = 405


class Conflict(DAVError):
    status = 409


class PreconditionFailed(DAVError):
    status = 412


class UnsupportedMediaType(DAVError):
    status = 415


class RangeNotSatisfiable(DAVError):
    status = 416


class Locked(DAVError):
    status = 423

    def __init__(
        self,
        message: str = "",
        *,
        lock_root: str | None = None,
        condition: str = "lock-token-submitted",
    ):
        super().__init__(message, condition=condition, condition_href=lock_root)


class BadGateway(DAVError):
    status = 502


class InsufficientStorage(DAVError):
    status = 507


def to_response(error: DAVError) -> Response:
    if error.condition:
        response = Response(
            _condition_body(error.condition, error.condition_href),
            status=error.status,
            content_type='application/xml; charset="utf-8"',
        )
    else:
        response = Response(
            (error.message or "").rstrip("\n") + "\n" if error.message else "",
            status=error.status,
            content_type="text/plain; charset=utf-8",
        )
    for key, value in error.headers.items():
        response.headers[key] = value
    return response


# A framework HTTPException already carries a status this hierarchy models.
# `Locked` is absent on purpose: it takes a lock root, and no framework
# exception has one to give.
_HTTP_STATUS_ERRORS: dict[int, type[DAVError]] = {
    400: BadRequest,
    401: AuthRequired,
    403: Forbidden,
    404: NotFoundError,
    405: MethodNotAllowed,
    409: Conflict,
    412: PreconditionFailed,
    415: UnsupportedMediaType,
    416: RangeNotSatisfiable,
    502: BadGateway,
    507: InsufficientStorage,
}

# Headers a framework exception carries that the DAV answer must keep. A 416
# without `Content-Range` tells the client nothing about the real length, and
# `bytes */<size>` is the whole point of RFC 7233's refusal.
_CARRIED_HEADERS = frozenset({"content-range", "allow", "retry-after", "www-authenticate"})


def map_exception(exception: Exception) -> DAVError:
    """Fallback mapping for Drive/frappe exceptions a handler let escape."""
    if isinstance(exception, DAVError):
        return exception
    if mapped := _drive_refusal(exception):
        return mapped
    if isinstance(exception, HTTPException):
        return _framework_status(exception)
    if isinstance(exception, frappe.AuthenticationError):
        return AuthRequired(str(exception))
    if isinstance(exception, frappe.PermissionError):
        return Forbidden("You do not have permission for this resource.")
    if isinstance(exception, frappe.DoesNotExistError | frappe.PageDoesNotExistError):
        return NotFoundError("Resource not found.")
    if isinstance(exception, frappe.ValidationError):
        return Conflict(str(exception))
    return DAVError("Internal server error.")


def _framework_status(exception: HTTPException) -> DAVError:
    """Map a framework HTTPException onto the DAV status it already names.

    The byte path leaves through `frappe.storage.serve.stream_blob`, and that
    is werkzeug's ground: `send_file` raises `RequestedRangeNotSatisfiable`
    for a Range it will not serve, and `NotFound` when the blob's bytes are
    gone from the driver. Both are answers, not faults. Without this branch
    they fell to the generic 500 below, which also had the dispatcher write
    and commit an Error Log row on every client retry.
    """
    factory = _HTTP_STATUS_ERRORS.get(exception.code or 500)
    if factory is None:
        return DAVError("Internal server error.")
    headers = {name: value for name, value in exception.get_headers() if name.lower() in _CARRIED_HEADERS}
    # werkzeug's description is an HTML-ish sentence about the framework; the
    # DAV answer is the status, and 404 keeps this module's one wording
    message = "Resource not found." if factory is NotFoundError else ""
    return factory(message, headers=headers)


def _drive_refusal(exception: Exception) -> DAVError | None:
    """Map a Drive workflow refusal onto its DAV status.

    Every one of these subclasses `frappe.ValidationError`, so without this the
    generic branch below would answer 409 to all of them - including the one
    refusal WebDAV is strictest about. §12.1: unreadable is always 404, never
    403, so `DriveNotFound` has to be recognised before the family it belongs
    to. The import is function-local because this module is the one every other
    WebDAV module imports and it must stay cheap.
    """
    from suite.drive._core.errors import (
        DriveConflict,
        DriveError,
        DriveForbidden,
        DriveLinkExpired,
        DriveLocked,
        DriveNotFound,
        DriveOverQuota,
    )

    if isinstance(exception, DriveNotFound):
        return NotFoundError("Resource not found.")
    if isinstance(exception, DriveForbidden):
        return Forbidden("You do not have permission for this resource.")
    if isinstance(exception, DriveOverQuota):
        return InsufficientStorage(str(exception))
    if isinstance(exception, DriveConflict):
        return Conflict(str(exception))
    if isinstance(exception, DriveLocked | DriveLinkExpired):
        # §6.9 gives a DAV session no link principals, so neither refusal can
        # be reached from here. If one ever is, it is a credential the client
        # cannot supply over this protocol, which is a refusal, not a retry.
        return Forbidden("You do not have permission for this resource.")
    if isinstance(exception, DriveError):
        return BadRequest(str(exception))
    return None


@contextmanager
def quota_guard():
    """validate_quota raises a bare ValueError; convert it to 507 Insufficient Storage."""
    try:
        yield
    except ValueError as e:
        raise InsufficientStorage(str(e)) from e


def _condition_body(condition: str, href: str | None) -> str:
    inner = f"<D:{condition}/>"
    if href:
        inner = f"<D:{condition}><D:href>{escape(href)}</D:href></D:{condition}>"
    return f'<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:">{inner}</D:error>'
