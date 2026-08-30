"""DAV error hierarchy and mapping of Drive/frappe exceptions to DAV statuses.

This module must not import other webdav modules (everything imports it).
The tiny <D:error> bodies are built by hand so no XML library is needed here.
"""

from contextlib import contextmanager
from xml.sax.saxutils import escape

import frappe
from werkzeug.wrappers import Response


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


def map_exception(exception: Exception) -> DAVError:
    """Fallback mapping for Drive/frappe exceptions a handler let escape."""
    if isinstance(exception, DAVError):
        return exception
    if isinstance(exception, frappe.AuthenticationError):
        return AuthRequired(str(exception))
    if isinstance(exception, frappe.PermissionError):
        return Forbidden("You do not have permission for this resource.")
    if isinstance(exception, frappe.DoesNotExistError | frappe.PageDoesNotExistError):
        return NotFoundError("Resource not found.")
    if isinstance(exception, frappe.ValidationError):
        return Conflict(str(exception))
    return DAVError("Internal server error.")


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
