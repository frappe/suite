"""Mount `/api/suite/drive/` on Frappe's v2 method API, and nothing more.

`frappe.api.API_URL_MAP` is built once at import time, so an app cannot add a
rule to it. The supported way in is a `before_request` hook, which runs at the
end of `init_request` - after `make_form_dict` has parsed the query string and
the JSON body, and before `validate_auth` resolves a session or an API key.
That order is the whole design: Drive reads a path it already has, and leaves
every identity question to the framework that runs next.

Two writes are needed, not one. `API_URL_MAP.bind_to_environ` matches on
`environ["PATH_INFO"]`, while `get_api_version` reads `request.path`, which
werkzeug assigns once in `__init__` and never re-reads from the environ. Set
only the environ and the request routes to v2 but answers in the v1 error
envelope; set only the attribute and the URL map still sees the Drive path.
`full_path`, `url`, and `base_url` are cached properties over the old value, so
they are dropped as well. The client's own path is kept in the environ under
`ORIGINAL_PATH`, because the access log reads `full_path` after the rewrite.

An address inside the prefix that no row claims - an unknown path, or a verb
no row declares for that path - is routed to `routes.unknown`, which raises
`DriveNotFound`. A bare werkzeug `NotFound` would answer HTML in a namespace
that answers JSON everywhere else, and a 405 would confirm that a path exists
to a caller who may not know it does.
"""

import re

import frappe

PREFIX = "/api/suite/drive/"
TARGET = "/api/v2/method/suite.drive.http.routes."
ORIGINAL_PATH = "suite.drive.original_path"
UNKNOWN = "unknown"

# (method, pattern, handler, path-segment names). §11.2, in table order. The
# verb here and the verb on the handler's `@frappe.whitelist(methods=...)` are
# checked against each other by `test_translator.py`: this table decides what is
# reachable, and the decorator refuses the same call made directly at the v2
# method URL.
ROUTES = (
    ("POST", re.compile(r"^nodes$"), "node_create", ()),
    ("POST", re.compile(r"^nodes/batch$"), "node_batch", ()),
    ("GET", re.compile(r"^nodes/([^/]+)$"), "node_get", ("node",)),
    ("PATCH", re.compile(r"^nodes/([^/]+)$"), "node_patch", ("node",)),
    ("DELETE", re.compile(r"^nodes/([^/]+)$"), "node_purge", ("node",)),
    ("GET", re.compile(r"^nodes/([^/]+)/children$"), "node_children", ("node",)),
    ("POST", re.compile(r"^nodes/([^/]+)/copy$"), "node_copy", ("node",)),
    ("PUT", re.compile(r"^nodes/([^/]+)/content$"), "node_put_content", ("node",)),
    ("GET", re.compile(r"^nodes/([^/]+)/content$"), "node_get_content", ("node",)),
    ("GET", re.compile(r"^nodes/([^/]+)/media$"), "node_media", ("node",)),
    ("POST", re.compile(r"^nodes/([^/]+)/preview$"), "node_preview", ("node",)),
    ("POST", re.compile(r"^uploads$"), "upload_create", ()),
    ("PUT", re.compile(r"^uploads/([^/]+)/chunk$"), "upload_chunk", ("upload_id",)),
    ("POST", re.compile(r"^uploads/([^/]+)/finish$"), "upload_finish", ("upload_id",)),
    ("GET", re.compile(r"^nodes/([^/]+)/activity$"), "node_activity", ("node",)),
    ("POST", re.compile(r"^nodes/([^/]+)/visit$"), "node_visit", ("node",)),
    ("PUT", re.compile(r"^nodes/([^/]+)/favourite$"), "node_put_favourite", ("node",)),
    ("DELETE", re.compile(r"^nodes/([^/]+)/favourite$"), "node_delete_favourite", ("node",)),
    ("GET", re.compile(r"^nodes/([^/]+)/grants$"), "node_grants", ("node",)),
    # The principal is the whole tail, not one segment. A `$GROUP:` names a
    # `User Group`, whose docname may hold a slash; werkzeug has already
    # decoded `%2F` by the time this runs, so `[^/]+` would 404 that group
    # rather than answer it. Nothing follows the principal, so a greedy tail
    # cannot swallow a segment another row claims.
    ("PUT", re.compile(r"^nodes/([^/]+)/grants/(.+)$"), "node_put_grant", ("node", "principal")),
    ("DELETE", re.compile(r"^nodes/([^/]+)/grants/(.+)$"), "node_delete_grant", ("node", "principal")),
    ("POST", re.compile(r"^grants/([^/]+)/rotate$"), "grant_rotate", ("grant",)),
    ("POST", re.compile(r"^links/([^/]+)/unlock$"), "link_unlock", ("token",)),
    # The literal leads the pattern that would also match it, the same guard
    # `nodes/batch` gets above.
    ("DELETE", re.compile(r"^views/recents$"), "view_clear_recents", ()),
    ("GET", re.compile(r"^views/([^/]+)$"), "view_list", ("view",)),
    ("GET", re.compile(r"^nodes/([^/]+)/versions$"), "node_versions", ("node",)),
    ("POST", re.compile(r"^nodes/([^/]+)/versions$"), "node_version_create", ("node",)),
    ("PATCH", re.compile(r"^nodes/([^/]+)/versions/([^/]+)$"), "node_version_patch", ("node", "seq")),
    ("DELETE", re.compile(r"^nodes/([^/]+)/versions/([^/]+)$"), "node_version_delete", ("node", "seq")),
    (
        "GET",
        re.compile(r"^nodes/([^/]+)/versions/([^/]+)/content$"),
        "node_version_content",
        ("node", "seq"),
    ),
    (
        "POST",
        re.compile(r"^nodes/([^/]+)/versions/([^/]+)/restore$"),
        "node_version_restore",
        ("node", "seq"),
    ),
    ("GET", re.compile(r"^nodes/([^/]+)/threads$"), "node_threads", ("node",)),
    ("POST", re.compile(r"^nodes/([^/]+)/threads$"), "node_thread_create", ("node",)),
    ("PATCH", re.compile(r"^threads/([^/]+)$"), "thread_patch", ("thread",)),
    ("POST", re.compile(r"^threads/([^/]+)/comments$"), "thread_comment_create", ("thread",)),
    ("PATCH", re.compile(r"^comments/([^/]+)$"), "comment_patch", ("comment",)),
    ("DELETE", re.compile(r"^comments/([^/]+)$"), "comment_delete", ("comment",)),
    ("GET", re.compile(r"^notifications$"), "notifications_list", ()),
    ("POST", re.compile(r"^notifications/read$"), "notifications_read", ()),
    ("GET", re.compile(r"^roots/([^/]+)/usage$"), "root_usage", ("root",)),
    ("PATCH", re.compile(r"^roots/([^/]+)$"), "root_patch", ("root",)),
    ("DELETE", re.compile(r"^roots/([^/]+)$"), "root_purge", ("root",)),
)


def handle_before_request() -> None:
    """Translate one Drive request, or leave every other request untouched."""
    request = getattr(frappe.local, "request", None)
    if request is None or not request.path.startswith(PREFIX):
        return
    if request.method == "OPTIONS":
        # `frappe/app.py` answers OPTIONS with an empty response before it
        # reaches any route. Rewriting the path would change nothing but the
        # access log.
        return

    rest = request.path[len(PREFIX) :].rstrip("/")
    for method, pattern, handler, names in ROUTES:
        if method != request.method:
            continue
        match = pattern.match(rest)
        if match is None:
            continue
        # `update`, not `setdefault`: a path id is the address the caller wrote
        # in the URL, so it overrides a body or query argument of the same name.
        frappe.local.form_dict.update(dict(zip(names, match.groups(), strict=True)))
        _dispatch(request, handler)
        return

    _dispatch(request, UNKNOWN)


def _dispatch(request, handler: str) -> None:
    # Popped before anything can read it. `frappe/app.py` runs
    # `frappe.handler.handle()` for any request whose form_dict carries `cmd`,
    # and that branch is tested before the `/api/` prefix branch, so a `cmd`
    # left here would replace the addressed route with a method of the caller's
    # choosing - including one this table never exposed.
    frappe.local.form_dict.pop("cmd", None)

    target = TARGET + handler
    request.environ.setdefault(ORIGINAL_PATH, request.path)
    request.environ["PATH_INFO"] = target
    request.path = target
    for cached in ("full_path", "url", "base_url"):
        request.__dict__.pop(cached, None)


def original_path() -> str | None:
    """Return the Drive path the client asked for, after the rewrite."""
    request = getattr(frappe.local, "request", None)
    return request.environ.get(ORIGINAL_PATH) if request is not None else None
