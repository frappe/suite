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

from dataclasses import replace

import frappe

from suite.composition.http import ORIGINAL_PATH, Route, dispatch, original_path
from suite.drive._core.errors import (
    DriveConflict,
    DriveFileTooLarge,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveMoved,
    DriveNotFound,
    DriveOverQuota,
    DriveRestoreDestinationRequired,
)
from suite.drive.http import shapes

PREFIX = "/api/suite/drive/"
TARGET = "/api/v2/method/suite.drive.http.routes."
UNKNOWN = "unknown"

# Every row declares what travels: `body` on a POST, PUT or PATCH, `query`
# where the query string carries arguments, `output` unless the answer is
# bytes, and the refusals the route adds to the common ones. The verb here and
# the verb on the handler's `@frappe.whitelist(methods=...)` are checked
# against each other by `test_translator.py`: this table decides what is
# reachable, and the decorator refuses the same call made directly at the v2
# method URL.
#
# Errors list only what a row adds. `_node_routes` puts `DriveNotFound`,
# `DriveLocked` and `DriveLinkExpired` on every `nodes/` row, because every one
# of them resolves its node through `access.require`. `DriveError` (400) is
# never listed: a malformed argument is possible on every route. A row whose
# path names nothing (`roots`, `settings`) or that writes only the caller's
# own rows (`views/recents`, `notifications/read`) may declare no refusal.
_COMMON_NODE_ERRORS = (DriveNotFound, DriveLocked, DriveLinkExpired)

_DECLARED = (
    Route(
        "POST",
        "nodes",
        "node_create",
        body=shapes.CreateFolder | shapes.CreateFile | shapes.CreateLink | shapes.CreateDocument,
        errors=(DriveForbidden, DriveConflict, DriveOverQuota),
        allow_guest=True,
        output=shapes.NodeShape,
    ),
    # A batch reports each node's refusal in its body (§11.5), so it adds none.
    Route(
        "POST",
        "nodes/batch",
        "node_batch",
        body=shapes.BatchNodes,
        allow_guest=True,
        output=shapes.BatchResult,
    ),
    Route(
        "POST",
        "nodes/batch/purge",
        "node_batch_purge",
        body=shapes.BatchPurge,
        output=shapes.BatchResult,
    ),
    Route(
        "GET",
        "nodes/{node}",
        "node_get",
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
        errors=(DriveForbidden, DriveConflict, DriveMoved, DriveRestoreDestinationRequired, DriveOverQuota),
        allow_guest=True,
        output=shapes.NodeShape,
        entity={"tag": "DriveNode", "id": "name", "version": "modified"},
    ),
    Route(
        "DELETE", "nodes/{node}", "node_purge", errors=(DriveForbidden, DriveConflict), output=shapes.Count
    ),
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
        body=shapes.Empty,
        errors=(DriveConflict,),
        allow_guest=True,
        output=shapes.ArchiveStatus,
    ),
    Route(
        "GET",
        "nodes/{node}/archive",
        "node_archive_status",
        errors=(DriveConflict,),
        allow_guest=True,
        output=shapes.ArchiveStatus,
    ),
    Route(
        "GET",
        "nodes/{node}/archive/download",
        "node_archive_download",
        errors=(DriveConflict,),
        allow_guest=True,
        stream=True,
    ),
    Route(
        "PUT",
        "nodes/{node}/content",
        "node_put_content",
        body=shapes.ReplaceContent,
        errors=(DriveForbidden, DriveConflict, DriveOverQuota, DriveFileTooLarge),
        allow_guest=True,
        output=shapes.NodeShape,
    ),
    # A file answers a signed redirect; a document streams its export.
    Route(
        "GET",
        "nodes/{node}/content",
        "node_get_content",
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        query=shapes.ContentQuery,
        stream=True,
    ),
    Route(
        "GET",
        "nodes/{node}/media",
        "node_media",
        errors=(DriveConflict,),
        allow_guest=True,
        output=shapes.MediaList,
    ),
    Route(
        "POST",
        "nodes/{node}/preview",
        "node_preview",
        body=shapes.PreviewPush,
        errors=(DriveForbidden,),
        allow_guest=True,
        output=shapes.PreviewAnswer,
    ),
    Route(
        "POST",
        "uploads",
        "upload_create",
        body=shapes.OpenUpload,
        errors=(DriveNotFound, DriveForbidden, DriveConflict, DriveOverQuota, DriveFileTooLarge),
        allow_guest=True,
        output=shapes.ChunkedUpload | shapes.DirectUpload,
    ),
    # The chunk is the raw request body, up to `upload.MAX_CHUNK_BYTES`.
    Route(
        "PUT",
        "uploads/{upload_id}/chunk",
        "upload_chunk",
        errors=(DriveNotFound, DriveForbidden, DriveConflict, DriveFileTooLarge),
        allow_guest=True,
        query=shapes.ChunkQuery,
        output=shapes.UploadProgress,
        stream=True,
    ),
    Route(
        "POST",
        "uploads/{upload_id}/finish",
        "upload_finish",
        body=shapes.FinishUpload,
        errors=(DriveNotFound, DriveForbidden, DriveConflict, DriveOverQuota, DriveFileTooLarge),
        allow_guest=True,
        output=shapes.NodeShape,
    ),
    Route(
        "GET",
        "nodes/{node}/activity",
        "node_activity",
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        query=shapes.PageQuery,
        output=shapes.Page[shapes.ActivityShape],
    ),
    Route(
        "POST",
        "nodes/{node}/visit",
        "node_visit",
        body=shapes.Empty,
        errors=(DriveConflict,),
        output=shapes.Count,
    ),
    Route(
        "PUT",
        "nodes/{node}/favourite",
        "node_put_favourite",
        body=shapes.Empty,
        errors=(DriveForbidden,),
        output=shapes.Count,
    ),
    Route("DELETE", "nodes/{node}/favourite", "node_delete_favourite", output=shapes.Count),
    Route(
        "GET",
        "nodes/{node}/grants",
        "node_grants",
        errors=(DriveForbidden,),
        query=shapes.GrantsQuery,
        output=shapes.GrantsShape,
    ),
    # The principal is the whole tail, not one segment. A `$GROUP:` names a
    # `User Group`, whose docname may hold a slash; werkzeug has already
    # decoded `%2F` by the time this runs, so `[^/]+` would 404 that group
    # rather than answer it. Nothing follows the principal, so a greedy tail
    # cannot swallow a segment another row claims.
    Route(
        "PUT",
        "nodes/{node}/grants/{principal:path}",
        "node_put_grant",
        body=shapes.GrantWrite,
        errors=(DriveForbidden,),
        output=shapes.GrantShape,
    ),
    Route(
        "DELETE",
        "nodes/{node}/grants/{principal:path}",
        "node_delete_grant",
        errors=(DriveForbidden,),
        query=shapes.RevokeQuery,
        output=shapes.Count,
    ),
    # A grant that exists is addressed by its id. This is the only way to
    # change or remove a share link: its `$LINK:<token>` principal is the
    # credential, and never belongs in a path.
    Route(
        "PATCH",
        "grants/{grant}",
        "grant_patch",
        body=shapes.GrantPatch,
        errors=(DriveNotFound, DriveForbidden),
        output=shapes.GrantShape,
    ),
    Route(
        "DELETE",
        "grants/{grant}",
        "grant_delete",
        errors=(DriveNotFound, DriveForbidden),
        output=shapes.Count,
    ),
    Route(
        "POST",
        "grants/{grant}/rotate",
        "grant_rotate",
        body=shapes.Empty,
        errors=(DriveNotFound, DriveForbidden),
        output=shapes.GrantShape,
    ),
    # The token travels in the body with the password: both are secrets.
    Route(
        "POST",
        "links/unlock",
        "link_unlock",
        body=shapes.Unlock,
        errors=(DriveNotFound, DriveForbidden, DriveLocked, DriveLinkExpired, frappe.RateLimitExceededError),
        output=shapes.UnlockTicket,
        allow_guest=True,
    ),
    # The literal leads the pattern that would also match it, the same guard
    # `nodes/batch` gets above. A DELETE carries its arguments in the query.
    Route(
        "DELETE",
        "views/recents",
        "view_clear_recents",
        query=shapes.ClearRecents,
        output=shapes.Count,
    ),
    Route(
        "GET",
        "views/{view}",
        "view_list",
        errors=(DriveNotFound, DriveForbidden),
        query=shapes.ViewQuery,
        output=shapes.Page[shapes.NodeShape | shapes.ArchivedRootShape],
    ),
    Route(
        "GET",
        "nodes/{node}/versions",
        "node_versions",
        errors=(DriveConflict,),
        allow_guest=True,
        query=shapes.PageQuery,
        output=shapes.Page[shapes.VersionShape],
    ),
    Route(
        "POST",
        "nodes/{node}/versions",
        "node_version_create",
        body=shapes.VersionTake,
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.VersionShape,
    ),
    Route(
        "PATCH",
        "nodes/{node}/versions/{seq}",
        "node_version_patch",
        body=shapes.VersionPatch,
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.VersionShape,
    ),
    Route(
        "DELETE",
        "nodes/{node}/versions/{seq}",
        "node_version_delete",
        errors=(DriveForbidden, DriveConflict),
        output=shapes.Count,
    ),
    Route(
        "GET",
        "nodes/{node}/versions/{seq}/content",
        "node_version_content",
        errors=(DriveConflict,),
        allow_guest=True,
        stream=True,
    ),
    Route(
        "POST",
        "nodes/{node}/versions/{seq}/restore",
        "node_version_restore",
        body=shapes.Empty,
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.VersionShape | None,
    ),
    Route(
        "GET",
        "nodes/{node}/threads",
        "node_threads",
        errors=(DriveConflict,),
        allow_guest=True,
        query=shapes.ThreadsQuery,
        output=shapes.ThreadList,
    ),
    Route(
        "POST",
        "nodes/{node}/threads",
        "node_thread_create",
        body=shapes.ThreadOpen,
        errors=(DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.ThreadShape,
    ),
    Route(
        "PATCH",
        "threads/{thread}",
        "thread_patch",
        body=shapes.ThreadResolve,
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.ThreadShape,
    ),
    Route(
        "POST",
        "threads/{thread}/comments",
        "thread_comment_create",
        body=shapes.CommentWrite,
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.CommentShape,
    ),
    Route(
        "PATCH",
        "comments/{comment}",
        "comment_patch",
        body=shapes.CommentEdit,
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.CommentShape,
    ),
    Route(
        "DELETE",
        "comments/{comment}",
        "comment_delete",
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        allow_guest=True,
        output=shapes.Count,
    ),
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
        output=shapes.Count,
    ),
    Route("GET", "roots", "roots_discover", output=shapes.RootLocations),
    Route(
        "GET",
        "roots/{root}/usage",
        "root_usage",
        errors=(DriveNotFound, DriveForbidden),
        query=shapes.RootUsageQuery,
        output=shapes.RootUsage,
    ),
    Route(
        "PATCH",
        "roots/{root}",
        "root_patch",
        body=shapes.RootQuota | shapes.RootArchive,
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        output=shapes.RootShape,
    ),
    Route(
        "DELETE",
        "roots/{root}",
        "root_purge",
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        output=shapes.Count,
    ),
    Route(
        "POST",
        "roots/{root}/trash/empty",
        "root_empty_trash",
        body=shapes.Empty,
        errors=(DriveNotFound, DriveForbidden, DriveConflict),
        output=shapes.Count,
    ),
    Route("GET", "settings", "settings_get", output=shapes.UserSettings),
    Route(
        "PATCH",
        "settings",
        "settings_patch",
        body=shapes.WebdavSwitch,
        output=shapes.UserSettings,
    ),
    Route(
        "GET",
        "site-settings",
        "site_settings_get",
        output=shapes.SiteSettings | shapes.AdminSiteSettings,
    ),
    Route(
        "PATCH",
        "site-settings",
        "site_settings_patch",
        body=shapes.WebdavSwitch,
        errors=(DriveForbidden,),
        output=shapes.AdminSiteSettings,
    ),
    Route(
        "GET",
        "webdav",
        "webdav_get",
        output=shapes.WebdavHidden | shapes.WebdavOff | shapes.WebdavConnection,
    ),
)


def _node_routes(declared: tuple[Route, ...]) -> tuple[Route, ...]:
    """Put the common node refusals first on every row that addresses a node."""
    rows = []
    for route in declared:
        if route.path.startswith("nodes/{node}"):
            extras = tuple(error for error in route.errors if error not in _COMMON_NODE_ERRORS)
            route = replace(route, errors=_COMMON_NODE_ERRORS + extras)
        rows.append(route)
    return tuple(rows)


ROUTES = _node_routes(_DECLARED)


def handle_before_request() -> None:
    """Translate one Drive request, or leave every other request untouched."""
    from suite.drive.framework import HTTP

    dispatch(HTTP)
