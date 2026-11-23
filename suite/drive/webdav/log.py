"""Request logging for the WebDAV dispatcher.

On by default at "info" — one line per request in logs/suite.drive.webdav.log
at both the bench and site level. drive_webdav_log_level in site_config.json
tunes it: "error" (5xx only), "warning" (adds 4xx), "debug" (adds the protocol
headers that matter when reproducing client behavior) or "off". Unrecognized
values keep the default rather than silently going dark. Credentials are never
logged: the Authorization header is deliberately excluded, and lock tokens are
capabilities only in the hands of their owner.
"""

import logging
import time

import frappe
from werkzeug.wrappers import Request, Response

LOGGER_MODULE = "suite.drive.webdav"
DEFAULT_LEVEL = logging.INFO
# one reason's worth of a log line. Two writers can reach the field, so the
# ceiling on the whole of it is twice this.
NOTE_LIMIT = 200

LEVELS = {
    "error": logging.ERROR,
    "warning": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
}

# headers worth having when debugging a client; Authorization deliberately absent
DEBUG_HEADERS = (
    "User-Agent",
    "Depth",
    "Destination",
    "Overwrite",
    "If",
    "If-Match",
    "If-None-Match",
    "Lock-Token",
    "Timeout",
    "Range",
    "Content-Type",
    "Content-Length",
    "X-OC-Mtime",
    "Expect",
)


def configured_level() -> int | None:
    raw = str(frappe.conf.get("drive_webdav_log_level") or "").strip().lower()
    if raw == "off":
        return None
    return LEVELS.get(raw, DEFAULT_LEVEL)


def start_request(request: Request) -> None:
    level = configured_level()
    frappe.local._webdav_log = (
        None if level is None else {"level": level, "start": time.monotonic(), "user": None, "note": None}
    )


def note_user(user: str) -> None:
    if context := getattr(frappe.local, "_webdav_log", None):
        context["user"] = user


def note(reason: str) -> None:
    """Add one reason to this request's log line; several are joined.

    Appending rather than replacing: a refusal names itself first, and the
    response net that runs after it must not erase that name to report its
    own repair.

    The reason is cleaned here rather than at each writer. `log_response`
    writes it inside `note="..."`, and the writers hand it exception text: a
    database error quoting a multi-line statement would otherwise forge whole
    records in the DAV log, and an unbounded message would carry a title into
    a line nothing else bounds.
    """
    if context := getattr(frappe.local, "_webdav_log", None):
        cleaned = " ".join(reason.replace('"', "'").split())[:NOTE_LIMIT]
        if not cleaned:
            return
        context["note"] = f"{context['note']}; {cleaned}" if context["note"] else cleaned


def log_response(request: Request, response: Response) -> None:
    context = getattr(frappe.local, "_webdav_log", None)
    if not context:
        return

    logger = frappe.logger(LOGGER_MODULE, file_count=10)
    logger.setLevel(context["level"])

    status = response.status_code
    duration_ms = (time.monotonic() - context["start"]) * 1000
    client = (request.user_agent.string or "-")[:120]
    ip = getattr(frappe.local, "request_ip", None) or request.remote_addr or "-"

    line = (
        f"{request.method} {request.path} -> {status} {duration_ms:.1f}ms "
        f'user={context["user"] or "-"} ip={ip} client="{client}"'
    )
    if context["note"]:
        line += f' note="{context["note"]}"'

    level = logging.ERROR if status >= 500 else logging.WARNING if status >= 400 else logging.INFO
    logger.log(level, line)

    if context["level"] <= logging.DEBUG:
        headers = "; ".join(
            f"{name}: {value}" for name in DEBUG_HEADERS if (value := request.headers.get(name))
        )
        if headers:
            logger.debug(f"{request.method} {request.path} headers: {headers}")
