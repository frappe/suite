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

import frappe

from suite.composition.http import ORIGINAL_PATH, Route, dispatch, original_path
from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
    DriveOverQuota,
)
from suite.drive.http import shapes

PREFIX = "/api/suite/drive/"
TARGET = "/api/v2/method/suite.drive.http.routes."
UNKNOWN = "unknown"

# One Route per §11.2 row, in table order. The
# verb here and the verb on the handler's `@frappe.whitelist(methods=...)` are
# checked against each other by `test_translator.py`: this table decides what is
# reachable, and the decorator refuses the same call made directly at the v2
# method URL.
ROUTES = (
    Route("POST", "nodes", "node_create", allow_guest=True, output=shapes.NodeShape),
    Route(
        "POST",
        "nodes/batch",
        "node_batch",
        body=shapes.BatchNodes,
        allow_guest=True,
        output=shapes.BatchResult,
    ),
    Route(
        "GET",
        "nodes/{node}",
        "node_get",
        errors=(DriveNotFound, DriveLocked, DriveLinkExpired),
        allow_guest=True,
        query=shapes.NodeGetQuery,
        output=shapes.NodeShape,
        entity={"tag": "DriveNode", "id": "name", "version": "modified"},
    ),
    Route(
        "PATCH",
        "nodes/{node}",
        "node_patch",
        body=shapes.Rename | shapes.Move | shapes.Trash | shapes.Restore | shapes.Stamp,
        errors=(DriveForbidden, DriveConflict, DriveOverQuota),
        allow_guest=True,
        output=shapes.NodeShape,
        entity={"tag": "DriveNode", "id": "name", "version": "modified"},
    ),
    Route("DELETE", "nodes/{node}", "node_purge"),
    Route(
        "GET",
        "nodes/{node}/children",
        "node_children",
        errors=(DriveConflict,),
        allow_guest=True,
        query=shapes.ChildrenQuery,
        output=shapes.Page[shapes.NodeShape],
    ),
    Route(
        "POST",
        "nodes/{node}/copy",
        "node_copy",
        body=shapes.CopyNode,
        errors=(DriveForbidden, DriveConflict, DriveOverQuota),
        allow_guest=True,
        output=shapes.NodeShape,
    ),
    Route(
        "POST",
        "nodes/{node}/archive",
        "node_archive_start",
        errors=(DriveConflict,),
        allow_guest=True,
        output=shapes.ArchiveStatus,
    ),
    Route(
        "GET",
        "nodes/{node}/archive",
        "node_archive_status",
        errors=(DriveNotFound, DriveConflict),
        allow_guest=True,
        output=shapes.ArchiveStatus,
    ),
    Route("GET", "nodes/{node}/archive/download", "node_archive_download", allow_guest=True),
    Route("PUT", "nodes/{node}/content", "node_put_content", allow_guest=True),
    Route("GET", "nodes/{node}/content", "node_get_content", allow_guest=True),
    Route("GET", "nodes/{node}/media", "node_media", allow_guest=True),
    Route("POST", "nodes/{node}/preview", "node_preview", allow_guest=True),
    Route("POST", "uploads", "upload_create", allow_guest=True),
    Route("PUT", "uploads/{upload_id}/chunk", "upload_chunk", allow_guest=True),
    Route("POST", "uploads/{upload_id}/finish", "upload_finish", allow_guest=True),
    Route("GET", "nodes/{node}/activity", "node_activity", allow_guest=True),
    Route("POST", "nodes/{node}/visit", "node_visit", output=shapes.Empty),
    Route("PUT", "nodes/{node}/favourite", "node_put_favourite", output=shapes.Empty),
    Route("DELETE", "nodes/{node}/favourite", "node_delete_favourite", output=shapes.Empty),
    Route("GET", "nodes/{node}/grants", "node_grants"),
    # The principal is the whole tail, not one segment. A `$GROUP:` names a
    # `User Group`, whose docname may hold a slash; werkzeug has already
    # decoded `%2F` by the time this runs, so `[^/]+` would 404 that group
    # rather than answer it. Nothing follows the principal, so a greedy tail
    # cannot swallow a segment another row claims.
    Route("PUT", "nodes/{node}/grants/{principal:path}", "node_put_grant"),
    Route("DELETE", "nodes/{node}/grants/{principal:path}", "node_delete_grant"),
    Route("POST", "grants/{grant}/rotate", "grant_rotate"),
    Route("POST", "links/{token}/unlock", "link_unlock", allow_guest=True),
    # The literal leads the pattern that would also match it, the same guard
    # `nodes/batch` gets above.
    Route("DELETE", "views/recents", "view_clear_recents"),
    Route(
        "GET",
        "views/{view}",
        "view_list",
        query=shapes.ViewQuery,
        output=shapes.Page[shapes.NodeShape | shapes.ArchivedRootShape],
    ),
    Route("GET", "nodes/{node}/versions", "node_versions", allow_guest=True),
    Route("POST", "nodes/{node}/versions", "node_version_create", allow_guest=True),
    Route("PATCH", "nodes/{node}/versions/{seq}", "node_version_patch", allow_guest=True),
    Route("DELETE", "nodes/{node}/versions/{seq}", "node_version_delete"),
    Route("GET", "nodes/{node}/versions/{seq}/content", "node_version_content", allow_guest=True),
    Route("POST", "nodes/{node}/versions/{seq}/restore", "node_version_restore", allow_guest=True),
    Route("GET", "nodes/{node}/threads", "node_threads", allow_guest=True),
    Route("POST", "nodes/{node}/threads", "node_thread_create", allow_guest=True),
    Route("PATCH", "threads/{thread}", "thread_patch", allow_guest=True),
    Route("POST", "threads/{thread}/comments", "thread_comment_create", allow_guest=True),
    Route("PATCH", "comments/{comment}", "comment_patch", allow_guest=True),
    Route("DELETE", "comments/{comment}", "comment_delete", allow_guest=True),
    Route(
        "GET",
        "notifications",
        "notifications_list",
        query=shapes.NotificationsQuery,
        output=shapes.Page[shapes.NotificationShape],
    ),
    Route(
        "GET",
        "notifications/unread-count",
        "notifications_unread_count",
        output=shapes.UnreadCount,
    ),
    Route(
        "POST",
        "notifications/read",
        "notifications_read",
        body=shapes.NotificationNames | shapes.AllNotifications,
        output=shapes.ReadResult,
    ),
    Route("GET", "roots", "roots_discover", output=shapes.RootLocations),
    Route("GET", "roots/{root}/usage", "root_usage", output=shapes.RootUsage),
    Route("PATCH", "roots/{root}", "root_patch"),
    Route("DELETE", "roots/{root}", "root_purge"),
)


def handle_before_request() -> None:
    """Translate one Drive request, or leave every other request untouched."""
    from suite.drive.framework import HTTP

    dispatch(HTTP)
