"""The before_request hook that owns every request under /dav.

frappe's router rejects WebDAV verbs outright (frappe/app.py:146) and its
validate_auth misreads password Basic auth, so this hook — which runs before
both (frappe/app.py:212) — handles /dav requests end to end and returns the
response by raising an HTTPException carrying it (returned verbatim at
frappe/app.py:150). Everything else pays two string comparisons.
"""

import importlib
from collections.abc import Callable

import frappe
from werkzeug.exceptions import HTTPException, NotFound
from werkzeug.wrappers import Request, Response

from suite.drive.webdav import DAV_PREFIX, RELINKED_METHODS


class DAVResponseException(HTTPException):
    """Carrier for a finished DAV response through frappe's exception handling."""


# method -> (module under suite.drive.webdav, handler attribute); imported lazily
# so non-DAV requests never load the protocol engine.
#
# The write verbs are absent while ticket 25 is open. Their handlers still
# write legacy `File` rows, and the path they would be handed now names a
# `Drive Node`, so running one would create a row in the wrong tree. They are
# refused by the allow-list before they reach here; this table and
# `RELINKED_METHODS` grow back together.
_HANDLERS: dict[str, tuple[str, str]] = {
    "PROPFIND": ("propfind", "handle"),
    "GET": ("get", "handle"),
    "HEAD": ("get", "handle"),
}


def handle_before_request() -> None:
    request = frappe.local.request
    path = request.path
    if path == DAV_PREFIX or path.startswith(DAV_PREFIX + "/"):
        _dispatch(request)  # never returns
    elif path == "/" and request.method == "OPTIONS":
        from suite.drive.webdav import options, settings

        if settings.global_webdav_enabled():
            options.advertise_on_root()


def _dispatch(request: Request) -> None:
    from suite.drive.webdav import auth, context, errors, log, options, settings

    if not settings.global_webdav_enabled():
        # disabled site is indistinguishable from one without the feature
        raise NotFound()

    log.start_request(request)

    if request.method == "OPTIONS":
        # pre-auth: static headers, and Windows probes before offering credentials
        _respond(options.handle(request))

    try:
        user = auth.authenticate(request)
        log.note_user(user)
        if not settings.user_webdav_enabled(user):
            raise errors.Forbidden("WebDAV is disabled for your account. Enable it in Drive settings.")
        frappe.set_user(user)
        allowed = settings.allowed_webdav_methods()
        if request.method not in allowed:
            raise errors.MethodNotAllowed(
                f"{request.method} is disabled on this site.",
                headers={"Allow": ", ".join(allowed)},
            )
        handler = _handler_for(request.method, allowed)
        ctx = context.build(request, user)
        response = handler(ctx)
    except DAVResponseException:
        raise
    except errors.DAVError as e:
        _rollback()
        log.note(str(e) or type(e).__name__)
        _raise(errors.to_response(e))
    except Exception as e:
        _rollback()
        mapped = errors.map_exception(e)
        log.note(f"{type(e).__name__}: {e}"[:200])
        if mapped.status >= 500:
            frappe.log_error(title=f"WebDAV {request.method} {request.path}"[:140])
            # frappe/app.py rolls back again after the carrier is raised; the
            # handler's writes are already discarded, so committing here
            # persists exactly the Error Log row — without it a production
            # 500 leaves no trace
            frappe.db.commit()
        _raise(errors.to_response(mapped))
    else:
        _respond(response)


def _handler_for(method: str, allowed: tuple[str, ...] = RELINKED_METHODS) -> Callable:
    entry = _HANDLERS.get(method)
    if not entry:
        from suite.drive.webdav.errors import MethodNotAllowed

        raise MethodNotAllowed(
            f"{method} is not supported here.",
            headers={"Allow": ", ".join(allowed)},
        )
    module_name, attribute = entry
    module = importlib.import_module(f"suite.drive.webdav.{module_name}")
    return getattr(module, attribute)


def _respond(response: Response) -> None:
    # frappe/app.py:151 rolls back on the exception path, so persist first;
    # this also fires after_commit callbacks (blob deletion, storage-lock release)
    frappe.db.commit()
    _raise(response)


def _raise(response: Response) -> None:
    from suite.drive.webdav import log

    # every response leaves through here — the one choke point worth logging
    log.log_response(frappe.local.request, response)
    # frappe's process_response replaces WWW-Authenticate on 401/403 with an
    # OAuth Bearer challenge; frappe.local.response_headers is merged after
    # that, so mirror ours there — WebDAV clients only speak Basic
    if "WWW-Authenticate" in response.headers:
        frappe.local.response_headers["WWW-Authenticate"] = response.headers["WWW-Authenticate"]
    raise DAVResponseException(response=response)


def _rollback() -> None:
    if db := getattr(frappe.local, "db", None):
        db.rollback()
