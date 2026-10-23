"""Supported product-facing Drive workflows.

`suite.drive` is the only Python interface into Drive for code outside
`suite/drive/`. Import it as `from suite import drive`. Callers never import
`suite.drive._core`, `suite.drive.doctype`, or a Drive DocType controller, and
never write a `Drive *` table themselves: every byte charged to a root must go
through one of the workflows below so that `Drive Root.used_bytes` stays the
one source of truth (ARCHITECTURE.md, rules 2.2, 3.2, and 5.5).

## Content apps

A content app declares one `ContentTypeSpec` and registers it through the
`drive_content_types` hook. Its document controller inherits `DriveContent`,
which supplies the node id, the node title, `drive_check`, `drive_touch`, and
`drive_take_version`, and refuses a document with no node. Drive owns the
title, the grants, the lifecycle, the versions, the comments, and the byte
charge; the app owns the body.

The ten calls an app makes are `check`, `touch`, `take_version`,
`create_document`, `import_document`, `copy`, `adopt_media`, `read_file`,
`push_preview`, and `record_comment`. Nothing lower flows from an app to Drive. The `ContentTypeSpec` callbacks flow the other
way, when Drive asks an app to work with its own document body. Each one
imports its workflow inside the call, so importing `suite.drive` for byte
accounting alone does not load the node, preview, and imaging modules.

## Producers

A producer is a job that holds bytes of its own and files them in Drive with
no user in the loop: Meet publishing a finished recording. It makes two calls.
`ensure_folder` answers the caller's folder of a given title below a parent,
creating it once. `store_file` stores the bytes as a private blob, creates the
file node under a free title, charges the root, and consumes the storage
reservation the producer charged those bytes to in advance, all in one step.
Both run as the Frappe session user, so a job sets the owner with
`frappe.set_user` around them.

`create_document` writes the node and the document in one transaction and
links them reciprocally. Both sides are set once and never change, so a
document with no node cannot exist. `copy` runs the app's `duplicate` factory,
copies the document's media one node per blob, and hands the app the old-to-new
node map through `remap_media`. `adopt_media` is the same media step for a
paste: it brings named media under one document, sharing blobs, and answers the
id remapping the app applies to its own body.

`import_document` is the fourth create shape of §10.1: a foreign file becoming a
content document. It runs the app's `import_from_file` factory, which reads the
source bytes back through `read_file` because only the app can parse its own
format and no app may read a `Drive Node` blob itself. The source file is left
exactly as it was: an import is neither a move nor a copy.

## Errors

Every workflow raises a `DriveError` subclass. They are caught by type, not by
message, and every documented subclass is exported here so an app can catch
one refusal, or the base class to catch them all, without reaching below this
package. `DriveError` subclasses `frappe.ValidationError` and carries an
`http_status_code`, so an unhandled one still aborts the request with the
right status.

| Error | Raised when |
|---|---|
| `DriveNotFound` | the root, root pair, reservation key, or node does not exist |
| `DriveOverQuota` | the admission UPDATE would push `used_bytes` past the effective quota |
| `DriveForbidden` | the caller's role at the node is below the one the workflow needs |
| `DriveConflict` | a reservation exists with different values, names another root, or a resize runs in the wrong direction; a content type is unregistered, invalid, or already linked to another node |
| `DriveLinkExpired` | the share link a caller presents has expired or been revoked |
| `DriveLocked` | a share link needs its password, or the caller's password guess was wrong |
| `frappe.ValidationError` | an argument is malformed: a negative or non-integer byte count, an empty key, a key longer than 140 characters |

## Transactions

Every reservation workflow runs inside its own SQL savepoint and rolls that
savepoint back on any failure, so a refused call leaves the counter, the
reservation row, and the caller's own writes in the state they had on entry.
None of them commits: they join the caller's transaction, and the caller
decides when to commit. A caller that must not keep a reservation on failure
therefore needs no compensation step of its own.

A caller that opens its own savepoint around a Drive workflow rolls it back
through `rollback_savepoint(savepoint, error)`, not through
`frappe.db.rollback(save_point=...)`. Drive workflows take `FOR UPDATE` locks,
so any of them can be the InnoDB deadlock victim, and InnoDB rolls the victim's
whole transaction back including its savepoints. The bare call then fails with
"SAVEPOINT does not exist" and that second error replaces the
`QueryDeadlockError` the caller has to retry on. The helper keeps the original
error and resets the handle with a full rollback; every other failure keeps the
narrow rollback unchanged. This is the same helper every Drive workflow uses.

Ordering, which callers must respect to stay deadlock-free:

1. `User`, when Drive provisions or archives a Personal Root.
2. The tree lock: the root `Drive Node` row of every tree the workflow writes,
   in id order. Every workflow that writes a tree takes it before any other
   row of that tree, so two writes to one tree queue at the root. A comment
   and a pushed or rendered preview skip it: each locks one node and then
   only rows of that node, so it never waits for a second tree row while it
   holds one.
3. The tree's other `Drive Node` rows: an ancestry chain top-down, then a
   subtree. Grant, version, preview and comment rows follow their node.
4. The `Drive Root` row (through its root pair), then the
   `Drive Storage Reservation` row.

A caller that takes its own locks in the same transaction takes them in that
order: `User`, then its own tables, then Drive.

Drive's HTTP and WebDAV write requests run at READ COMMITTED
(`framework.begin_drive_write`). Under REPEATABLE READ the range reads and
range updates of a tree write also lock the gaps beside the rows they touch,
and those gaps reach into the neighbouring rows of other trees, so two writes
to two different trees could deadlock with no row in common. READ COMMITTED
takes no gap locks; the tree lock is what keeps a sibling title unique.

A reservation is bound to its root when it is created and never moves. The
binding survives archiving: pass `root=None` to `grow`, `reduce`, and
`release` and Drive resolves the bound root itself. This is what keeps a
recording that started before its owner was offboarded charged to the archived
root rather than to a same-email replacement root.

## Permissions

The reservation workflows are byte accounting, not access control. They do not
check the session user and they do not require one: `create_storage_reservation`
and its siblings run under whatever user the caller has set, including a
background job. The caller owns the decision that the reservation may be made.

`refuse_shared_row`, `refuse_shared_linked_rows`, and
`refuse_shared_child_rows` exist for the expand phase only. An app whose
permission hooks are still its own has to refuse a `DocShare` the same way this
package does after activation, because Frappe widens both a denied row check and
a list predicate with shared names. The three differ in where the node lives:
on the shared row itself, on a node column the shared row carries, and on the
parent document a shared child row points at.

The content workflows do check. `check`, `create_document`,
`import_document`, `copy`, `adopt_media`, `read_file`, `touch`, `take_version`,
and `push_preview` build the caller's
principals from the current Frappe session and this request's `X-Drive-Links`
header, then run the same point check every other Drive workflow runs. A caller never constructs
principals itself and never composes partial steps.

`ensure_personal_root` refuses `Guest` and `Administrator` by returning `None`
rather than raising, and returns `None` for any user it will not provision.
`personal_root_for` returns `None` when the user has no Active Personal Root,
which is what an offboarded user looks like.

## Performance

| Workflow | Cost |
|---|---|
| `personal_root_for` | one indexed read of `Drive Root (kind, user, state)` |
| `ensure_personal_root` | the same read; on a miss, one `User` row lock plus three inserts |
| `get_storage_usage` | the root-pair read plus one `SUM(reserved_bytes)` on the `root` index |
| `get_storage_reservation` | one primary-key read, no lock |
| `create` / `grow` / `reduce` / `release` | two locking row reads and one counter UPDATE; no table scan |
| `bind_legacy_storage_reservation` | the same, plus one read to detect an already-bound row |
| `legacy_node` | one primary-key read of `Drive Legacy Route` |
| `node_url` | one primary-key read of the node's kind |
| `ensure_folder` | one indexed read of the parent's children; on a miss, one folder create under the parent-chain lock |
| `store_file` | one pass over the bytes to hash and store them, then one file create under the parent-chain lock |

No workflow scans `Drive Node`. Every one is bounded work per call, so a
migration or a per-request caller can run them in a loop. They hold row locks
until the caller commits, so a caller must not keep a Drive transaction open
across a network call.
"""


def administration_usage() -> list[dict]:
    """Read root accounting for authorized cross-product administration."""
    from suite.suite_core.administration import require_admin

    require_admin()
    from suite.drive._core.quota import administration_usage as read

    return read()


def set_user_active(user: str, *, active: bool) -> str:
    """Archive or restore the same personal root during Suite's authorized User lifecycle.

    Takes the User identity lock before root-node/root metadata locks. Explicit grants,
    retained versions and trash remain unchanged. No new root is substituted on reactivation.
    """
    from suite.suite_core.administration import require_admin

    require_admin()
    from suite.drive._core.roots import set_user_active as transition

    return transition(user, active=active)


def preview_user_transfer(user: str, destination: str) -> dict:
    """Preview retained bytes and destination inheritance without exposing content bodies."""
    from suite.suite_core.administration import require_admin

    require_admin()
    from suite.drive._core.offboarding import preview

    return preview(user, destination, _principals())


def transfer_user_drive(user: str, destination: str, fingerprint: str, *, confirm_access: bool) -> dict:
    """Move up to fifty retained top-level subtrees and report per-item outcomes.

    The caller's transaction commits successful items. Failures roll back only
    their subtree; a fresh preview/retry includes remaining items, preserving
    stable links, versions, explicit grants and still-deleted trash.
    """
    from suite.suite_core.administration import require_admin

    require_admin()
    from suite.drive._core.offboarding import transfer

    return transfer(user, destination, fingerprint, _principals(), confirm_access=confirm_access)


from collections.abc import Iterable
from datetime import datetime
from typing import IO

from suite.drive._core.content import (
    ContentTypeSpec,
    DriveContent,
    Satellite,
)
from suite.drive._core.errors import (
    DriveConflict,
    DriveError,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
    DriveOverQuota,
    rollback_savepoint,
)
from suite.drive._core.quota import (
    bind_legacy_storage_reservation,
    create_storage_reservation,
    get_storage_reservation,
    get_storage_usage,
    grow_storage_reservation,
    reduce_storage_reservation,
    release_storage_reservation,
)
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, READ, UPLOAD
from suite.drive._core.roots import (
    personal_root_for,
)
from suite.drive._core.roots import (
    provision_personal_root as ensure_personal_root,
)


def check(node: str, role: int) -> None:
    """Raise unless the current caller holds `role` at `node`.

    A role above READ also requires an Active node. §8.8 opens a trashed
    document read-only, and this is an app-facing call, so it refuses one the
    same way `DriveContent.drive_check` does. Drive's own restore and purge
    workflows act on a trashed node through `_core` and are unaffected.
    """
    from suite.drive._core.access import require
    from suite.drive._core.content import _refuse_trashed_write
    from suite.drive._core.nodes import _node

    row = _node(node)
    require(row, role, _principals())
    _refuse_trashed_write(row, role)


def create_document(
    parent: str,
    title: str,
    *,
    content_doctype: str,
    from_node: str | None = None,
    is_template: bool = False,
) -> str:
    """Create one content node and its document in a single transaction."""
    from suite.drive._core.nodes import create_document as _create_document

    return _create_document(
        _principals(),
        parent,
        title,
        content_doctype=content_doctype,
        from_node=from_node,
        is_template=is_template,
    )


def create_file(
    parent: str,
    title: str,
    *,
    blob: str,
    size: int,
    mime: str,
    content_modified: datetime | int | float | str | None = None,
) -> str:
    """Create one private blob-backed file, already stored, and charge its root.

    `blob` names bytes this call did not just store: a cross-product caller
    reaching this facade holds no bound upload session of its own (§8.4's
    binding is a Drive-internal detail), so the id necessarily arrived some
    other way. That is the same provenance §11.2's client door has, so this
    facade makes the same proof `create` does: the caller must already be
    able to read a node or version that holds `blob` (`_require_readable_blob`).
    """
    from suite.drive._core.nodes import create_file as _create_file

    return _create_file(
        _principals(),
        parent,
        title,
        blob=blob,
        size=size,
        mime=mime,
        content_modified=content_modified,
        _client_named_blob=True,
    )


def list_versions(node: str, *, cursor: str | None = None, limit: int | None = None) -> dict:
    """Page one readable node's versions, newest sequence first (§9.1)."""
    from suite.drive._core.nodes import DEFAULT_PAGE_SIZE
    from suite.drive._core.versions import list_versions as _list_versions

    return _list_versions(
        _principals(), node, cursor=cursor, limit=DEFAULT_PAGE_SIZE if limit is None else limit
    )


def copy(node: str, parent: str, *, title: str | None = None) -> str:
    """Copy one readable tree, sharing blobs but no authority and no history."""
    from suite.drive._core.nodes import copy as _copy

    return _copy(_principals(), node, parent, title=title)


def import_document(parent: str, title: str, *, content_doctype: str, from_node: str) -> str:
    """Create one content document from an ordinary file's bytes, in one transaction."""
    from suite.drive._core.nodes import import_document as _import_document

    return _import_document(
        _principals(),
        parent,
        title,
        content_doctype=content_doctype,
        from_node=from_node,
    )


def resolve_share_link(token: str) -> dict:
    """Answer which node one share-link token addresses (§6.2).

    The share-link page, `suite/www/drive_link.py`, is the one caller. It runs
    outside Drive, so it comes through this interface rather than reaching into
    the engine, and it needs exactly this much: the node id, and enough of the
    grant to render a page when the token is unknown or expired.

    No role is checked and no password is asked for. Resolution says which node
    a link addresses; whether the holder may read it is decided on every
    following request from the token they present.
    """
    from suite.drive._core.access import resolve_link

    return resolve_link(token)


def node_url(node: str) -> str:
    """Answer the browser address of one node, for a link the server sends.

    Server code that sends a node link builds it here, so the link matches the
    router (unified frontend spec §14.5). A folder or a root gives
    `/drive/f/<id>` and every other kind `/d/<id>`. No role is checked, and an
    unknown node raises `DriveNotFound`.
    """
    from suite.drive._core.nodes import node_url as _node_url

    return _node_url(node)


def legacy_node(old_id: str) -> str:
    """Answer the node id a pre-migration Drive id names now.

    An old Drive Team id answers the folder the team became, through `Drive
    Legacy Route`; every other old id is returned unchanged, because Build kept
    each `File` name as its node id. The answer may name no node: pass it to
    `node_url`, which raises `DriveNotFound` for one. No role is checked.
    """
    from suite.drive._core.nodes import legacy_node as _legacy_node

    return _legacy_node(old_id)


def read_file(node: str) -> tuple[IO[bytes], str]:
    """Answer one readable file node's bytes as a stream, with its mime type."""
    from suite.drive._core.nodes import read_file as _read_file

    return _read_file(_principals(), node)


def adopt_media(document_node: str, media_nodes) -> dict[str, str]:
    """Bring named media under one content document and answer the id remapping."""
    from suite.drive._core.content import adopt_media as _adopt_media

    return _adopt_media(_principals(), document_node, media_nodes)


def refuse_shared_row(doctype: str, docname, ptype: str | None = None, user: str | None = None) -> None:
    """Refuse when a `DocShare` would grant one row a staged app guard denied."""
    from suite.drive.framework import refuse_shared_row as _refuse_shared_row

    _refuse_shared_row(doctype, docname, ptype, user)


def refuse_shared_linked_rows(doctype: str, node_field: str, user: str | None = None) -> None:
    """Refuse a staged app's list when a `DocShare` would reopen a linked row."""
    from suite.drive.framework import refuse_shared_linked_rows as _refuse_shared_linked_rows

    _refuse_shared_linked_rows(doctype, node_field, user)


def refuse_shared_child_rows(
    doctype: str,
    parent_doctype: str,
    parent_field: str,
    node_field: str,
    user: str | None = None,
) -> None:
    """Refuse a staged app's history list when a share reaches a linked parent."""
    from suite.drive.framework import refuse_shared_child_rows as _refuse_shared_child_rows

    _refuse_shared_child_rows(doctype, parent_doctype, parent_field, node_field, user)


def touch(doctype: str, docname: str) -> None:
    """Record that one content document's body changed now."""
    from suite.drive._core.content import touch as _touch

    _touch(_principals(), doctype, docname)


def record_comment(node: str, *, thread: str, comment: str, resolved: bool, mentions: Iterable[str]) -> None:
    """Record a comment an app keeps in its own body and notify the people it mentions.

    Writer's inline comments are anchored Yjs data only Writer can read, so
    Writer stores them and reports each one here. Drive writes the same
    `comment` activity a Drive thread writes, with the app's own `thread` and
    `comment` ids in its detail, and each mentioned user gets the same
    notification. Needs COMMENT on an Active document node.
    """
    from suite.drive._core.comments import record_comment as _record_comment

    _record_comment(_principals(), node, thread=thread, comment=comment, resolved=resolved, mentions=mentions)


def take_version(node: str, *, kind: str = "auto", label: str | None = None) -> int:
    """Store a node's current bytes as an immutable version and return its seq."""
    from suite.drive._core.versions import take_version as _take_version

    return _take_version(_principals(), node, kind=kind, label=label)


def push_preview(node: str, image_bytes: bytes, mime: str) -> None:
    """Replace one content document's preview with an app-supplied image."""
    from suite.drive._core.previews import push_preview as _push_preview

    _push_preview(_principals(), node, image_bytes, mime)


def ensure_folder(parent: str, title: str) -> str:
    """Answer the caller's Active folder titled `title` below `parent`, creating it if absent.

    Only a folder the caller created is reused; one somebody else created with
    that title is theirs to share, so the new folder takes the free title
    (`Meet Recordings (2)`). Needs UPLOAD on `parent`.
    """
    from suite.drive._core.nodes import ensure_folder as _ensure_folder

    return _ensure_folder(_principals(), parent, title)


def store_file(
    parent: str,
    title: str,
    stream: IO[bytes],
    *,
    content_modified: datetime | int | float | str | None = None,
    reservation: str | None = None,
) -> str:
    """Store bytes this process holds as a private file node below `parent`.

    For a producer that holds the bytes itself, with no browser upload and no
    blob a client could name: a background job publishing an artifact. The
    bytes are stored, deduplicated, and charged to the root in one call; the
    title is deduplicated the way §8.6 says. `reservation` names a storage
    reservation the caller charged these bytes to in advance; it is consumed
    in the same step, so the bytes never count twice against the root.
    Needs UPLOAD on `parent`.
    """
    from suite.drive._core.nodes import store_file as _store_file

    return _store_file(
        _principals(),
        parent,
        title,
        stream,
        content_modified=content_modified,
        reservation=reservation,
    )


def _principals():
    from suite.drive.framework import principals_for_request

    return principals_for_request()


__all__ = (
    "COMMENT",
    "EDIT",
    "MANAGE",
    "READ",
    "UPLOAD",
    "ContentTypeSpec",
    "DriveConflict",
    "DriveContent",
    "DriveError",
    "DriveForbidden",
    "DriveLinkExpired",
    "DriveLocked",
    "DriveNotFound",
    "DriveOverQuota",
    "Satellite",
    "administration_usage",
    "adopt_media",
    "bind_legacy_storage_reservation",
    "check",
    "copy",
    "create_document",
    "create_file",
    "create_storage_reservation",
    "ensure_folder",
    "ensure_personal_root",
    "get_storage_reservation",
    "get_storage_usage",
    "grow_storage_reservation",
    "import_document",
    "legacy_node",
    "list_versions",
    "node_url",
    "personal_root_for",
    "preview_user_transfer",
    "push_preview",
    "read_file",
    "record_comment",
    "reduce_storage_reservation",
    "refuse_shared_child_rows",
    "refuse_shared_linked_rows",
    "refuse_shared_row",
    "release_storage_reservation",
    "resolve_share_link",
    "rollback_savepoint",
    "set_user_active",
    "store_file",
    "take_version",
    "touch",
    "transfer_user_drive",
)
