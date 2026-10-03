"""The §11.3 node shape, the §11.4 page, and query-string coercion.

One serialiser answers both a list row and a detail fetch, so the two cannot
drift. It publishes seventeen fields and deliberately drops four that `_core`
rows carry: `path`, `trashed_at`, `blob`, and `modified_by`. The first two are
tree bookkeeping a client never addresses, `blob` is a storage id no client may
name (§8.4), and `modified_by` is the framework's row author, not Drive's.

`trash_root` is published because a client addresses it: a trashed folder
opens read-only, and only its trash root can be restored or deleted forever,
so the page names that node and links to it (§5.6, §8.8).

`root` is the effective root node id (§3.1): a root node stores NULL and
reports its own id. `nodes.root_id` is the one place that rule lives.

Coercion is here rather than on the handler signatures because every value in a
query string is a string, and Frappe's own annotation checking answers a bad
one with 417 from outside the handler body, where the Drive error mapping
cannot reach it. These helpers raise `frappe.ValidationError`, which the route
boundary maps to 400.
"""

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Literal, NotRequired, TypedDict

import frappe
from frappe import _
from pydantic import with_config

from suite.drive._core import nodes, times
from suite.drive._core.people import Person, people

EXPANSIONS = ("access", "breadcrumbs", "preview")
USAGE_EXPANSIONS = ("breakdown",)

# §11.5 gives no bound of its own. One gesture is one request, and a page is
# capped at 200 rows, so a batch is capped at the same number: a client cannot
# ask one request to do more work than it can ask one listing to report.
MAX_BATCH_NODES = nodes.MAX_PAGE_SIZE

_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")


class AccessShape(TypedDict, total=False):
    role: int
    via_link: str | None
    source_node: str | None
    source_principal: str | None


class BreadcrumbShape(TypedDict):
    name: str
    title: str
    # A file under a content document has the document as its last crumb, and
    # a document is not a folder a client can list or link to as one.
    kind: str


class PreviewShape(TypedDict):
    url: str
    expires: int


class NodeShape(TypedDict):
    name: str
    title: str
    kind: str
    parent_node: str | None
    root: str
    state: str
    # The node whose trashing trashed this one: its own name on a trash root,
    # an ancestor's inside a trashed folder, None while Active (§3.1).
    trash_root: str | None
    size: int
    mime: str | None
    url: str | None
    content_doctype: str | None
    content_docname: str | None
    is_template: int
    # The user whose row this is, published as a person, never as a bare id.
    owner: Person
    creation: str | None
    modified: str | None
    content_modified: str | None
    access: NotRequired[AccessShape]
    breadcrumbs: NotRequired[list[BreadcrumbShape]]
    preview: NotRequired[PreviewShape | None]
    opened_at: NotRequired[str | None]
    # The caller's own star. Reads (a detail, a children page, a view) carry
    # it; a write answers without it.
    favourite: NotRequired[bool]


class ActivityShape(TypedDict):
    name: str
    node: str
    action: str
    actor: str
    at: str | None
    via_link: str | None
    client: str | None
    detail: dict


class NotificationShape(TypedDict):
    name: str
    read: int
    creation: str | None
    activity: ActivityShape


class Page[T](TypedDict):
    rows: list[T]
    next_cursor: str | None


class Rename(TypedDict):
    title: str


class Move(TypedDict):
    parent_node: str
    # The folder the caller last saw the node in. The move is refused with
    # `DriveMoved` (409) when the node is no longer there (§8.2).
    expect_parent_node: NotRequired[str]


class Trash(TypedDict):
    state: Literal["Trashed"]


class Restore(TypedDict):
    state: Literal["Active"]
    parent_node: NotRequired[str]


class Stamp(TypedDict):
    content_modified: str


# The four things `POST /nodes` creates (§8.3). `kind` picks the alternative,
# so each is one operation in the generated client.
class CreateFolder(TypedDict):
    kind: Literal["folder"]
    parent_node: str
    title: str


class CreateFile(TypedDict):
    """A file from a blob the caller already owns. `size` and `mime` are claims
    `create_file` checks against the stored row (§8.4)."""

    kind: Literal["file"]
    parent_node: str
    title: str
    blob: str
    size: int
    mime: str
    content_modified: NotRequired[str]


class CreateLink(TypedDict):
    kind: Literal["link"]
    parent_node: str
    title: str
    url: str


class CreateDocument(TypedDict):
    """A content document of `content_doctype`, blank or from a template node."""

    kind: Literal["document"]
    parent_node: str
    title: str
    content_doctype: str
    from_node: NotRequired[str]
    is_template: NotRequired[bool]


@with_config(extra="forbid")
class Empty(TypedDict):
    """The body of a write that takes nothing but its path: `{}`."""


class PageQuery(TypedDict, total=False):
    limit: int
    cursor: str


class NodeGetQuery(TypedDict, total=False):
    expand: str


class ChildrenQuery(TypedDict, total=False):
    limit: int
    cursor: str
    order_by: str
    ascending: bool
    # A comma-separated list of `nodes.LISTING_TYPES`, as `listing_types` reads it.
    type: str
    expand: str


class CopyNode(TypedDict):
    parent_node: str
    title: NotRequired[str]


class BatchPatch(TypedDict, total=False):
    title: str
    parent_node: str
    # Only with `parent_node`, as on `Move`.
    expect_parent_node: str
    state: Literal["Active", "Trashed"]
    content_modified: str


class BatchNodes(TypedDict):
    nodes: list[str]
    patch: BatchPatch


class ReplaceContent(TypedDict):
    """`PUT /nodes/<id>/content`: a new head from the caller's finished session."""

    upload_id: str
    checksum: NotRequired[str]
    content_modified: NotRequired[str]


class ContentQuery(TypedDict, total=False):
    # An export format a content app offers; a file ignores it.
    format: str
    # Save a file instead of showing it. A document export always downloads.
    download: bool


class MediaItem(TypedDict):
    node: str
    title: str
    mime: str | None
    size: int
    url: str
    expires: int


class MediaList(TypedDict):
    media: list[MediaItem]


class PreviewPush(TypedDict):
    """`POST /nodes/<id>/preview`: the rendered image, base64, and its MIME type."""

    image: str
    mime: str


class PreviewAnswer(TypedDict):
    preview: PreviewShape | None


class OpenUpload(TypedDict):
    parent_node: str
    filename: str
    size: int
    mime: NotRequired[str]
    replaces: NotRequired[str]


class ChunkedUpload(TypedDict):
    """A session that takes its bytes through `PUT /uploads/<id>/chunk`."""

    upload_id: str
    mode: Literal["chunked"]


class DirectUpload(TypedDict):
    """A session that takes its bytes at the storage `url`, `fields` first."""

    upload_id: str
    mode: Literal["direct"]
    url: str
    fields: dict[str, str]


class ChunkQuery(TypedDict):
    offset: int


class UploadProgress(TypedDict):
    upload_id: str
    # Bytes the server holds for the session after this chunk.
    received: int


class FinishUpload(TypedDict, total=False):
    """`POST /uploads/<id>/finish`: `parent_node` and `title` for a new file, or
    `replaces` for a new head; the session binds which."""

    parent_node: str
    title: str
    replaces: str
    checksum: str
    content_modified: str


class BatchPurge(TypedDict):
    nodes: list[str]


class Count(TypedDict):
    """The answer to a write that removes or touches rows rather than shaping one.

    Every delete answers it, and so does a write whose only result is a
    number of rows: a visit, a star, a read receipt (`http/__init__.py`).
    """

    count: int


class BatchFailure(TypedDict):
    node: str
    type: str
    message: str


class BatchResult(TypedDict):
    ok: list[str]
    failed: list[BatchFailure]


class ViewQuery(TypedDict, total=False):
    limit: int
    cursor: str
    root: str
    content_doctype: str
    term: str
    # As `ChildrenQuery.type`.
    type: str
    expand: str


class NotificationsQuery(TypedDict, total=False):
    limit: int
    cursor: str
    unread: bool


class NotificationNames(TypedDict):
    notifications: list[str]


class AllNotifications(TypedDict):
    all: Literal[True]


class UnreadCount(TypedDict):
    unread: int


class RootLocation(TypedDict):
    node: str
    title: str


class RootLocations(TypedDict):
    personal: RootLocation
    organization: RootLocation | None


class ArchivedRootShape(TypedDict):
    root: str
    user: str | None
    used_bytes: int
    quota_bytes: int


class RootShape(TypedDict):
    """One `Drive Root` with its node's title, as `PATCH /roots/<id>` answers it."""

    name: str
    node: str
    kind: str
    user: str | None
    state: str
    quota_bytes: int
    used_bytes: int
    title: str


class GrantShape(TypedDict):
    name: str
    node: str
    # One of §4.4's five spellings. The row key; `person` is who it names.
    principal: str
    role: int
    # Only when the principal is a user.
    person: NotRequired[Person]
    expires_on: str | None
    has_password: bool
    sent_to: str | None
    # `/l/<token>`, on a link row only.
    url: NotRequired[str]


class RedactedGrantShape(TypedDict):
    """An ancestor's link the caller does not manage: no name, URL, or recipient."""

    node: str
    principal: Literal["$LINK"]
    role: int
    expires_on: str | None
    has_password: bool


class InheritedGrantShape(TypedDict):
    grant: GrantShape | RedactedGrantShape
    redacted: bool
    source_node: str
    source_title: str


# §5.8 names a key `pass`, a Python keyword, so this one is the functional form.
ExplainRowShape = TypedDict(
    "ExplainRowShape",
    {
        "node": str,
        "depth": int,
        "principal": str,
        "role": int,
        "expires_on": str | None,
        "pass": int,
        "held": bool,
        "winner": bool,
    },
)


class ExplainShape(TypedDict):
    role: int
    source: str
    rows: list[ExplainRowShape]


class GrantsShape(TypedDict):
    """`GET /nodes/<id>/grants`: the local rows, who owns the tree, and the asked-for extras."""

    grants: list[GrantShape]
    # The user whose Personal root holds the node. None in the Shared root.
    owner: Person | None
    inherited: NotRequired[list[InheritedGrantShape]]
    explain: NotRequired[ExplainShape]


class GrantWrite(TypedDict):
    """`PUT /nodes/<id>/grants/<principal>`: `role` and `expires_on` replace; `password` patches."""

    role: int
    expires_on: NotRequired[str | None]
    password: NotRequired[str | None]
    send_to: NotRequired[str]
    notify: NotRequired[bool]


class GrantPatch(TypedDict):
    """`PATCH /grants/<id>`: the same write on a row named by its id."""

    role: int
    expires_on: NotRequired[str | None]
    password: NotRequired[str | None]


class GrantsQuery(TypedDict, total=False):
    # `?inherited=1` adds the ancestors' live grants; `?principal=` adds §5.8's explanation.
    inherited: bool
    principal: str


class RevokeQuery(TypedDict, total=False):
    # `?below=1` also removes the principal's grants under the node (§5.10).
    below: bool


class Unlock(TypedDict):
    token: str
    password: str


class UnlockTicket(TypedDict):
    ticket: str
    expires: int


class VersionShape(TypedDict):
    name: str
    node: str
    seq: int
    kind: str
    label: str | None
    pinned: int
    actor: str
    size: int
    creation: str | None


class VersionTake(TypedDict, total=False):
    kind: Literal["auto", "named", "milestone"]
    label: str


class VersionPatch(TypedDict, total=False):
    """Either field; an empty `label` clears it (§9.1)."""

    label: str
    pinned: bool


class CommentShape(TypedDict):
    name: str
    thread: str
    node: str
    content: str
    author: str
    # The name a Guest typed (§6.7). A signed-in author is published as `person`.
    author_name: str | None
    # The signed-in author. Absent for a Guest.
    person: NotRequired[Person]
    mentions: list[str]
    creation: str | None
    modified: str | None


class ThreadShape(TypedDict):
    name: str
    node: str
    anchor: str
    resolved: bool
    resolved_by: str | None
    resolved_at: str | None
    creation: str | None
    comments: list[CommentShape]


class ThreadsQuery(TypedDict, total=False):
    # Absent lists every thread; true or false keeps one side.
    resolved: bool


class ThreadList(TypedDict):
    threads: list[ThreadShape]


class ThreadOpen(TypedDict):
    """`POST /nodes/<id>/threads`: the anchor is the content app's to resolve."""

    anchor: str
    text: str
    # A guest's typed display name; a user's identity comes from the session (§6.7).
    author_name: NotRequired[str]


class ThreadResolve(TypedDict):
    resolved: bool


class CommentWrite(TypedDict):
    text: str
    author_name: NotRequired[str]


class CommentEdit(TypedDict):
    text: str


class ArchiveStatus(TypedDict):
    status: Literal["building", "ready", "failed"]
    file_name: str | None
    size: int | None
    error: str | None


class RootUsageQuery(TypedDict, total=False):
    expand: Literal["breakdown"]


class RootQuota(TypedDict):
    # Bytes; 0 is unlimited.
    quota_bytes: int


class RootArchive(TypedDict):
    # The one state change a root takes: Active to Archived.
    state: Literal["Archived"]


class ClearRecents(TypedDict, total=False):
    # Absent clears every recent row of the caller; named clears those nodes.
    nodes: list[str]


class TypeBytes(TypedDict):
    type: str
    bytes: int


class LargestNode(TypedDict):
    node: str
    title: str
    size: int
    mime: str | None
    kind: Literal["file", "document"]
    type: str


class RootUsage(TypedDict):
    used_bytes: int
    reserved_bytes: int
    quota_bytes: int | None
    effective_quota: int
    by_type: NotRequired[list[TypeBytes]]
    largest: NotRequired[list[LargestNode]]


class UserSettings(TypedDict):
    """The caller's own `Drive Settings` row (§3.14), or its field defaults."""

    webdav_enabled: bool
    writer_settings: dict


class WebdavSwitch(TypedDict):
    """The one field `PATCH /settings` and `PATCH /site-settings` write."""

    webdav_enabled: bool


class SiteSettings(TypedDict):
    """What every signed-in caller reads from `Drive Disk Settings` (§3.13)."""

    is_admin: bool
    preview_size: int


class AdminSiteSettings(SiteSettings):
    """What a Drive admin reads. Quotas are bytes, and 0 is unlimited."""

    webdav_enabled: bool
    webdav_allowed_methods: str
    default_personal_quota: int
    shared_quota: int


# The three `GET /webdav` answers are closed: the exported schema carries
# `additionalProperties: false`. An open empty shape would match any object, so
# the generated client would accept an answer that carried the API secret.
@with_config(extra="forbid")
class WebdavHidden(TypedDict):
    """WebDAV is off for the site and the caller is no admin: nothing to show."""


@with_config(extra="forbid")
class WebdavOff(TypedDict):
    """The site switch, shown to an admin while it is off."""

    globally_enabled: bool
    is_admin: bool


class WebdavConnection(WebdavOff):
    """How to mount `/dav/` while the site switch is on. Closed, as `WebdavOff`.

    `api_key` doubles as the DAV username for key-based sign-in. The secret is
    minted once by `suite.utils.user.generate_user_keys` and never read back.
    """

    server_url: str
    username: str
    enabled_for_user: bool
    two_factor_blocked: bool
    api_key: str | None


def node_shapes(rows: list[Mapping]) -> list[NodeShape]:
    """Shape a page of node rows with one lookup of the people they name."""
    known = people({row.get("owner") for row in rows})
    return [node_shape(row, known) for row in rows]


def node_shape(row: Mapping, known: Mapping[str, Person] | None = None) -> NodeShape:
    """Return one stored node row as §11.3's shape.

    `known` is a page's people, looked up once by `node_shapes`. A single row
    looks its owner up itself.
    """
    owner = row.get("owner")
    if known is None:
        known = people((owner,))
    return {
        "name": row.get("name"),
        "title": row.get("title"),
        "kind": row.get("kind"),
        "parent_node": row.get("parent_node"),
        "root": nodes.root_id(row),
        "state": row.get("state"),
        "trash_root": row.get("trash_root"),
        "size": int(row.get("size") or 0),
        "mime": row.get("mime"),
        "url": row.get("url"),
        "content_doctype": row.get("content_doctype"),
        "content_docname": row.get("content_docname"),
        "is_template": int(row.get("is_template") or 0),
        "owner": known[owner],
        "creation": stamp(row.get("creation")),
        "modified": stamp(row.get("modified")),
        "content_modified": stamp(row.get("content_modified")),
    }


def version_shape(row: Mapping) -> VersionShape:
    """Return one stored version row as the shape `GET .../versions` publishes.

    `blob` is dropped for the reason `node_shape` drops it: a storage id is not
    a client's to name, and the only way to the bytes is
    `GET /nodes/<id>/versions/<seq>/content`, which mints a signature after a
    READ check (§8.4, §6.8).
    """
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "seq": int(row.get("seq") or 0),
        "kind": row.get("kind"),
        "label": row.get("label"),
        "pinned": int(row.get("pinned") or 0),
        "actor": row.get("actor"),
        "size": int(row.get("size") or 0),
        "creation": stamp(row.get("creation")),
    }


def activity_shape(row: Mapping) -> ActivityShape:
    """Return one activity row as §9.4's columns, times formatted.

    Every link token is masked to the bare `$LINK`. §11.2 answers this history
    to READ, and a Guest holding a published node can reach it, while the token
    a `share_add` row names and the `via_link` an ordinary row carries are
    bearer secrets that reach EDIT (§6.1). Rotation would not close that: the
    row naming the new token is written to the same history. `GET
    /nodes/<id>/grants` is where a token is shown, and it needs MANAGE.
    """
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "action": row.get("action"),
        "actor": row.get("actor"),
        "at": stamp(row.get("at")),
        "via_link": mask_link(row.get("via_link")),
        "client": row.get("client"),
        "detail": _masked_detail(row.get("detail") or {}),
    }


def mask_link(value):
    """Reduce `$LINK:<token>` to `$LINK`, and pass anything else through."""
    if isinstance(value, str) and value.startswith("$LINK:"):
        return "$LINK"
    return value


def _masked_detail(detail: Mapping) -> dict:
    """Mask the three §5.12 detail keys that can hold a link principal."""
    if not isinstance(detail, Mapping):
        return detail
    answer = dict(detail)
    for key in ("principal", "old_principal", "new_principal"):
        if key in answer:
            answer[key] = mask_link(answer[key])
    return answer


def notification_shape(row: Mapping) -> NotificationShape:
    """Return one notification pointer with the activity it renders from.

    `to_user` is withheld: §11.2 scopes this route to the caller, so the only
    value it could ever carry is the caller's own address.
    """
    return {
        "name": row.get("name"),
        "read": int(row.get("read") or 0),
        "creation": stamp(row.get("creation")),
        "activity": activity_shape(row.get("activity") or {}),
    }


def grants_shape(answer: Mapping) -> GrantsShape:
    """Shape `grants_for`'s answer with one lookup of every user it names.

    The owner, each local user grant, and each unredacted inherited user grant
    name a person; the lookup is one query for the whole dialog.
    """
    inherited = answer.get("inherited")
    named = [answer.get("owner")]
    named += [row.get("principal") for row in answer["grants"]]
    named += [row["grant"].get("principal") for row in inherited or () if not row.get("redacted")]
    known = people({user for user in named if user and _is_user_principal(user)})
    owner = answer.get("owner")
    shaped: GrantsShape = {
        "grants": [grant_shape(row, known) for row in answer["grants"]],
        "owner": known[owner] if owner else None,
    }
    if inherited is not None:
        shaped["inherited"] = [inherited_grant_shape(row, known) for row in inherited]
    if "explain" in answer:
        shaped["explain"] = explain_shape(answer["explain"])
    return shaped


def grant_shape(row: Mapping, known: Mapping[str, Person] | None = None) -> GrantShape:
    """Return one grant row as §11.2 publishes it: expiry formatted, its person named.

    A write answers one row and looks its person up itself; a list passes the
    people it looked up once.
    """
    principal = row.get("principal")
    answer: GrantShape = {
        "name": row.get("name"),
        "node": row.get("node"),
        "principal": principal,
        "role": row.get("role"),
        "expires_on": stamp(row.get("expires_on")),
        "has_password": bool(row.get("has_password")),
        "sent_to": row.get("sent_to"),
    }
    if principal and _is_user_principal(principal):
        answer["person"] = (known if known is not None else people((principal,)))[principal]
    if row.get("url"):
        answer["url"] = row["url"]
    return answer


def _is_user_principal(principal: str) -> bool:
    """§4.4: every principal that is not a user starts with `$`."""
    return not principal.startswith("$")


def inherited_grant_shape(row: Mapping, known: Mapping[str, Person]) -> InheritedGrantShape:
    """Return one ancestor's grant with the node it sits on (issue 44, D19).

    A `redacted` row is a link on an ancestor the caller does not manage. Its
    grant has only `node`, `principal` (`$LINK`), `role`, `expires_on`, and
    `has_password`: no `name`, `url`, or `sent_to` key at all.
    """
    grant = row.get("grant") or {}
    redacted = bool(row.get("redacted"))
    return {
        "grant": _redacted_grant_shape(grant) if redacted else grant_shape(grant, known),
        "redacted": redacted,
        "source_node": row.get("source_node"),
        "source_title": row.get("source_title"),
    }


def _redacted_grant_shape(row: Mapping) -> RedactedGrantShape:
    return {
        "node": row.get("node"),
        "principal": "$LINK",
        "role": row.get("role"),
        "expires_on": stamp(row.get("expires_on")),
        "has_password": bool(row.get("has_password")),
    }


def root_shape(row: Mapping) -> RootShape:
    """Return one root's metadata as `PATCH /roots/<id>` answers it."""
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "kind": row.get("kind"),
        "user": row.get("user"),
        "state": row.get("state"),
        "quota_bytes": int(row.get("quota_bytes") or 0),
        "used_bytes": int(row.get("used_bytes") or 0),
        "title": row.get("title"),
    }


def explain_shape(result: Mapping) -> ExplainShape:
    """Return §5.8's explanation with its row times formatted.

    The keys are §5.8's exactly - `role`, `source`, and one row per candidate
    carrying `node`, `depth`, `principal`, `role`, `expires_on`, `pass`,
    `held`, and `winner`. `node` and `principal` are the provenance: which node
    a row sits on, and which principal it names. Nothing is added, because the
    accepted decision cites §5.8 for the shape a client may rely on.
    """
    return {
        "role": result.get("role"),
        "source": result.get("source"),
        "rows": [
            {
                "node": row.get("node"),
                "depth": row.get("depth"),
                "principal": row.get("principal"),
                "role": row.get("role"),
                "expires_on": stamp(row.get("expires_on")),
                "pass": row.get("pass"),
                "held": bool(row.get("held")),
                "winner": bool(row.get("winner")),
            }
            for row in result.get("rows") or ()
        ],
    }


def thread_shapes(rows: Iterable[Mapping]) -> list[ThreadShape]:
    """Shape a document's threads with one lookup of every author they name."""
    rows = list(rows)
    known = people(_comment_authors(comment for row in rows for comment in row.get("comments") or ()))
    return [thread_shape(row, known) for row in rows]


def thread_shape(row: Mapping, known: Mapping[str, Person] | None = None) -> ThreadShape:
    """Return one comment thread and its comments, times formatted.

    `known` is a listing's people, looked up once by `thread_shapes`. A single
    thread, the answer to a write, looks up its own authors.
    """
    comments = row.get("comments") or ()
    if known is None:
        known = people(_comment_authors(comments))
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "anchor": row.get("anchor"),
        "resolved": bool(row.get("resolved")),
        "resolved_by": row.get("resolved_by"),
        "resolved_at": stamp(row.get("resolved_at")),
        "creation": stamp(row.get("creation")),
        "comments": [comment_shape(comment, known) for comment in comments],
    }


def comment_shape(row: Mapping, known: Mapping[str, Person] | None = None) -> CommentShape:
    """Return one comment row, times formatted, with its signed-in author as a Person."""
    author = row.get("author")
    answer: CommentShape = {
        "name": row.get("name"),
        "thread": row.get("thread"),
        "node": row.get("node"),
        "content": row.get("content"),
        "author": author,
        "author_name": row.get("author_name"),
        "mentions": list(row.get("mentions") or ()),
        "creation": stamp(row.get("creation")),
        "modified": stamp(row.get("modified")),
    }
    if _is_signed_in_author(author):
        answer["person"] = (known if known is not None else people((author,)))[author]
    return answer


def _comment_authors(comments: Iterable[Mapping]) -> set[str]:
    return {comment.get("author") for comment in comments if _is_signed_in_author(comment.get("author"))}


def _is_signed_in_author(author: str | None) -> bool:
    """A comment's author is a User id, or the literal `Guest` for a link visitor."""
    return bool(author) and author != "Guest"


def stamp(value) -> str | None:
    """Publish one stored time as §11.3 does: RFC 3339 in UTC, to the second."""
    return times.publish(value)


def moment(value, name: str) -> datetime | None:
    """Accept an absent time, or one RFC 3339 time that carries its offset.

    The stored form is site-naive, and the client does not know the site's
    zone, so a naive string is refused rather than read in a zone the sender
    never meant (§11.3).
    """
    if value is None or value == "":
        return None
    return times.parse(value, name)


def page[T](result: Mapping, rows: list[T]) -> Page[T]:
    """Wrap already-shaped rows in §11.4's opaque-cursor page."""
    return {"rows": rows, "next_cursor": result.get("next_cursor")}


def text(value, name: str) -> str | None:
    """Accept an absent or string argument, and refuse any other type."""
    if value is None:
        return None
    if not isinstance(value, str):
        _refuse(name)
    return value


def required_text(value, name: str) -> str:
    """Accept a non-blank string argument."""
    answer = text(value, name)
    if not answer or not answer.strip():
        _refuse(name)
    return answer


def whole(value, name: str, default: int) -> int:
    """Accept an absent, integer, or all-digit argument as a whole number.

    One rule for both spellings. A query string can only deliver digits, so a
    JSON body may not deliver a negative where `?limit=-1` is already refused:
    every argument this coerces is a size, an offset, a page bound, or a quota,
    and none of them has a meaning below zero.
    """
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        _refuse(name)
    if isinstance(value, int):
        if value < 0:
            _refuse(name)
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    _refuse(name)


def flag(value, name: str, default: bool) -> bool:
    """Accept an absent, boolean, or spelled-out truth argument."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.lower() in _TRUE:
            return True
        if value.lower() in _FALSE:
            return False
    _refuse(name)


def expansions(value, name: str = "expand", allowed: tuple[str, ...] = EXPANSIONS) -> frozenset:
    """Accept a comma-separated subset of `allowed`, §11.3's three by default."""
    if value is None or value == "":
        return frozenset()
    if not isinstance(value, str):
        _refuse(name)
    asked = tuple(item.strip() for item in value.split(",") if item.strip())
    unknown = sorted(set(asked) - set(allowed))
    if unknown:
        frappe.throw(
            _("Drive expansion {0} is not supported").format(", ".join(unknown)),
            frappe.ValidationError,
        )
    return frozenset(asked)


def listing_types(value, name: str = "type") -> tuple[str, ...]:
    """Accept a comma-separated list of `?type=` values. `nodes.type_filter` checks each one."""
    if value is None or value == "":
        return ()
    if not isinstance(value, str):
        _refuse(name)
    return tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))


def sequence(value, name: str) -> int:
    """Accept a version sequence: a whole number above zero, never absent."""
    if value is None or value == "":
        _refuse(name)
    answer = whole(value, name, 0)
    if answer < 1:
        _refuse(name)
    return answer


def name_list(value, name: str) -> tuple[str, ...]:
    """Accept a bounded, possibly empty list of distinct non-blank row ids.

    `identifiers` refuses an empty list because a batch that names no node is a
    malformed gesture. Marking no notifications read is not: it is the answer
    `{"read": 0}`, and a client clearing an already-empty badge should not get
    a 400 for it.
    """
    if not isinstance(value, list | tuple):
        _refuse(name)
    if len(value) > MAX_BATCH_NODES:
        frappe.throw(
            _("A Drive request may name at most {0} rows").format(MAX_BATCH_NODES),
            frappe.ValidationError,
        )
    answer = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            _refuse(name)
        if item not in answer:
            answer.append(item)
    return tuple(answer)


def identifiers(value, name: str) -> tuple[str, ...]:
    """Accept a bounded list of distinct non-blank node ids, in the order given."""
    if not isinstance(value, list | tuple) or not value:
        _refuse(name)
    if len(value) > MAX_BATCH_NODES:
        frappe.throw(
            _("A Drive batch may name at most {0} nodes").format(MAX_BATCH_NODES),
            frappe.ValidationError,
        )
    answer = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            _refuse(name)
        if item not in answer:
            answer.append(item)
    return tuple(answer)


def patch(value, name: str) -> dict:
    """Accept a non-empty mapping of the fields `PATCH /nodes/<id>` takes.

    §11.5: "`patch` takes the same fields as `PATCH /nodes/<id>`", which §11.2
    gives five whole bodies. Bytes are not among them on either route.
    """
    if not isinstance(value, Mapping) or not value:
        _refuse(name)
    allowed = ("title", "parent_node", "expect_parent_node", "state", "content_modified")
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        frappe.throw(
            _("A Drive patch does not take {0}").format(", ".join(unknown)),
            frappe.ValidationError,
        )
    return dict(value)


def _refuse(name: str) -> None:
    frappe.throw(_("Drive argument {0} is invalid").format(name), frappe.ValidationError)
