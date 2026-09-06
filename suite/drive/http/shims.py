"""The 69 legacy whitelisted names of §11.7, answered by the new workflows.

Every name a released client calls keeps its address on `/api/method/`. This
module holds what each one does now, so the `api/*` modules keep the name and
the `@frappe.whitelist()` decorator they were reached by and hold no second
implementation of a Drive rule. Cleanup deletes this module and those bodies
together, one release after Build (§14.10).

Four classes, and every name is in exactly one of them (`CLASSIFICATION`).

- **Forwarder.** The call is translated into the same private workflow the
  §11.2 route calls, and the answer is translated back into the shape the old
  client reads. No policy is decided here.
- **Permanent.** The name, its signature, and its guest flag outlive Cleanup,
  because the address is written into data or into a shipped artifact:
  `suite.drive.api.s3.fetch` sits inside stored `File.file_url` values,
  `get_file_for_doc` sits inside the checked-in `sdk-o7hlQ1xj.js` bundle, and
  `/dav` sits inside third-party file managers. The nineteen product methods
  stay on `/api/method/` as well: none of them touches a node. Twenty of the
  twenty-one bodies are untouched too. The exception is `api.s3.fetch`, whose
  `except` clause had to name the `_core` refusals once `get_file_content`
  below it became a forwarder; the test compares all twenty-one against
  `e390a4487` and carries that one exception by name.
- **Retired.** §11.7 drops the behavior. The name still answers, and it answers
  a refusal that names its replacement. It never mints a capability and never
  reports a mutation it did not make.
- **Retained.** The legacy body is still the implementation, because the
  replacement §11.7 names does not exist. Recorded, not hidden: see
  `RETAINED_REASON` and the caller inventory.

**Ids are not translated.** §14.3 makes `Drive Node.name = File.name`, so the
id an old client holds is the node id. A forwarder passes it through and lets
the workflow answer. Before Build there is no node for a legacy id, and the
workflow answers `DriveNotFound`: the forwarders and Build ship in one release.

**A refusal is never invented.** Where the old body answered `None` for a row
the caller may not see, the forwarder catches the workflow's `DriveNotFound`
and answers `None` in the same place. It never writes a deny to express one
(§5.9), and it never picks a restore destination for a client that named none
(§8.7): `_restore` refuses with `DriveConflict` and the old client is told.
"""

import functools
import json
import re
from pathlib import Path

import frappe
from frappe import _

from suite.drive import framework
from suite.drive._core import access, content, previews, roots
from suite.drive._core import activity as activity_core
from suite.drive._core import nodes as node_core
from suite.drive._core import upload as upload_core
from suite.drive._core.errors import DriveError, DriveNotFound
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, READ, UPLOAD

# One entry per legacy whitelisted name, keyed the way a client addresses it:
# the dotted path after `suite.drive.`. `File.<method>` is a document method,
# reached through `run_doc_method`, and keeps that spelling.
FORWARDER = "forwarder"
PERMANENT = "permanent"
RETIRED = "retired"
RETAINED = "retained"

CLASSIFICATION = {
    # api/files.py - 26 names
    "api.files.upload_file": FORWARDER,
    "api.files.get_thumbnail": FORWARDER,
    "api.files.create_folder": FORWARDER,
    "api.files.create_link": FORWARDER,
    "api.files.create_auth_token": RETIRED,
    "api.files.get_file_content": FORWARDER,
    "api.files.stream_file_content": FORWARDER,
    "api.files.download_folder": RETAINED,
    "api.files.download_status": RETAINED,
    "api.files.download_archive": RETAINED,
    "api.files.set_favourite": FORWARDER,
    "api.files.remove_or_restore": FORWARDER,
    "api.files.delete_entities": FORWARDER,
    "api.files.rename": FORWARDER,
    "api.files.update_access": FORWARDER,
    "api.files.remove_recents": FORWARDER,
    "api.files.does_entity_exist": FORWARDER,
    "api.files.get_new_title": RETIRED,
    "api.files.move": FORWARDER,
    "api.files.search": FORWARDER,
    "api.files.translate_old_name": FORWARDER,
    "api.files.get_entity_type": FORWARDER,
    "api.files.get_root_folder": FORWARDER,
    "api.files.redirect_to_original": FORWARDER,
    "api.files.track_visit": FORWARDER,
    "api.files.resolve_legacy_route": FORWARDER,
    # api/list.py - 6 names
    "api.list.files": FORWARDER,
    "api.list.shared": FORWARDER,
    "api.list.favourites": FORWARDER,
    "api.list.recents": FORWARDER,
    "api.list.trash": FORWARDER,
    "api.list.get_attachments": RETAINED,
    # api/permissions.py - 4 names
    "api.permissions.get_user_access": FORWARDER,
    "api.permissions.get_general_access": FORWARDER,
    "api.permissions.get_entity_with_permissions": FORWARDER,
    "api.permissions.get_shared_with_list": FORWARDER,
    # api/activity.py - 1 name
    "api.activity.get_entity_activity_log": FORWARDER,
    # api/notifications.py - 3 names
    "api.notifications.get_notifications": FORWARDER,
    "api.notifications.get_unread_count": FORWARDER,
    "api.notifications.mark_as_read": FORWARDER,
    # api/storage.py - 2 names
    "api.storage.storage_breakdown": FORWARDER,
    "api.storage.storage_bar_data": FORWARDER,
    # api/scripts.py - 2 names
    "api.scripts.sync_preview": RETAINED,
    "api.scripts.sync_from_disk": RETIRED,
    # api/embed.py - 1 name
    "api.embed.get_file_content": FORWARDER,
    # api/s3.py - 1 name
    "api.s3.fetch": PERMANENT,
    # api/product.py - 19 names
    "api.product.get_my_invites": PERMANENT,
    "api.product.get_pending_invites": PERMANENT,
    "api.product.signup": PERMANENT,
    "api.product.oauth_providers": PERMANENT,
    "api.product.send_otp": PERMANENT,
    "api.product.verify_otp": PERMANENT,
    "api.product.get_settings": PERMANENT,
    "api.product.set_settings": PERMANENT,
    "api.product.invite_users": PERMANENT,
    "api.product.get_users": PERMANENT,
    "api.product.get_user_groups": PERMANENT,
    "api.product.accept_invite": PERMANENT,
    "api.product.reject_invite": PERMANENT,
    "api.product.get_translations": PERMANENT,
    "api.product.is_site_admin": PERMANENT,
    "api.product.disk_settings": PERMANENT,
    "api.product.webdav_config": PERMANENT,
    "api.product.set_webdav_enabled": PERMANENT,
    "api.product.signup_disabled": PERMANENT,
    # overrides/file.py - 4 names
    "overrides.file.File.share": RETAINED,
    "overrides.file.File.unshare": RETAINED,
    "overrides.file.File.rename": RETAINED,
    "overrides.file.get_file_for_doc": PERMANENT,
}

# Why a name is still answered by its old body. Every entry names the thing
# §11.7 pointed at and what is missing from it; none of them is a decision this
# module makes, and the caller inventory carries the same list.
RETAINED_REASON = {
    "api.files.download_folder": "no §11.2 route builds a folder archive",
    "api.files.download_status": "no §11.2 route reports archive progress",
    "api.files.download_archive": "no §11.2 route streams a built archive",
    "api.list.get_attachments": (
        "§14.4 keeps framework attachments under Home as File rows, so they "
        "never become nodes; §11.7 points at GET /nodes/<id>/media, which "
        "lists a document's embedded media, not a business document's "
        "attachments"
    ),
    "api.scripts.sync_preview": (
        "§11.7 points at POST /nodes/<id>/preview, which pushes a rendered "
        "image; this name lists unregistered files on disk. A name collision, "
        "not a replacement"
    ),
    "overrides.file.File.share": "a document method, reached only from the legacy File doctype",
    "overrides.file.File.unshare": "a document method, reached only from the legacy File doctype",
    "overrides.file.File.rename": "a document method, called by the legacy title sync",
}


class DriveRetired(DriveError):
    """A legacy name whose behavior §11.7 dropped, answered explicitly.

    410, because the capability existed and is gone. It is a `DriveError`, so
    it carries its status through both envelopes and a client catching Drive
    refusals by base class already handles it. It lives here, not in
    `_core/errors.py`: §11.6's class table is the route surface's, and this
    class dies with the shim module.
    """

    http_status_code = 410


def names_of(kind: str) -> tuple[str, ...]:
    """Return every legacy name in one class, in table order."""
    return tuple(name for name, value in CLASSIFICATION.items() if value == kind)


# `msgprint` cleans every message it logs with `clean_html`, and strips tags off
# the exception as well when the caller is a terminal
# (`frappe/utils/messages.py:77-85`). Both delete everything between angle
# brackets, so a value spelled into a refusal can leave without its words:
# `Expected list but got <class 'list'>` reached a legacy client as
# `Expected list but got `. A message this module writes spells no bracket at
# all; a value that arrives at runtime is put through `_spelled` first.
_ANGLE = re.compile(r"[<>]")


def _plain(text: str) -> str:
    """Drop the angle brackets a refusal cannot carry to the reader."""
    return _ANGLE.sub("", text)


def _spelled(value) -> str:
    """Spell a runtime value into a refusal so the reader still gets it.

    A type is named by `__name__`, because `str(type([]))` is `<class 'list'>`
    and none of it survives. Anything else is text the caller sent, so its
    brackets go too.
    """
    if isinstance(value, type):
        return value.__name__
    return _plain(str(value))


def _retire(name: str, replacement: str):
    """Refuse a retired name, and say what took its place.

    A route placeholder is spelled `:id`, not `<id>`. `msgprint` cleans the
    message before a client reads it, and strips tags again when the caller is
    a terminal; both delete everything between angle brackets, so
    `nodes/<id>/content` arrives as `nodes//content` and names no route the
    reader can call.
    """
    frappe.throw(
        _("{0} is no longer supported. {1}").format(name, replacement),
        DriveRetired,
    )


# --------------------------------------------------------------------------
# Translation between the two vocabularies
# --------------------------------------------------------------------------

# §11.7 keeps the five legacy permission bits addressable, and the ladder is
# how they are answered now. The mapping is `roles.PTYPE_ROLE` read backwards:
# a bit is set when the caller's role reaches the rung that bit named.
BIT_ROLE = {
    "read": READ,
    "comment": COMMENT,
    "upload": UPLOAD,
    "write": EDIT,
    "share": MANAGE,
}

NO_ACCESS = dict.fromkeys(BIT_ROLE, 0)

# Legacy `File.file_type` for a row with no mime of its own. Everything else
# goes through the legacy mime table, which is still the client's vocabulary.
KIND_FILE_TYPE = {
    "root": "Folder",
    "folder": "Folder",
    "link": "Link",
}


def _principals():
    return framework.principals_for_request()


def _legacy(shim):
    """Give a legacy caller the message the old body sent it.

    `report_error` names the exception class, and copies a message into the
    body only when `msgprint` stamped one on - which `frappe.throw` does and a
    bare `raise` does not. The workflows raise, which is right for a Python
    caller, so a legacy client read a status code and no text: `FileUploader`
    reads `_server_messages` alone and printed "Please contact support." for a
    full disk, and `ErrorPage` renders `error.messages` before anything else.

    Throwing the same class again fills the message in and keeps the status
    code §11.6 gives it. `routes._route` does this at the other boundary; the
    class is preserved here rather than remapped, because a legacy client
    reads `exc_type` too.

    The message goes through `_plain` on the way. Throwing is what puts a
    `_core` refusal in front of `clean_html` for the first time, and several of
    those refusals spell an id or a kind the caller sent: a node named `a<b>c`
    turned "Drive node a<b>c was not found" into "Drive node ac was not found".
    """

    @functools.wraps(shim)
    def answered(*args, **kwargs):
        try:
            return shim(*args, **kwargs)
        except DriveError as refusal:
            frappe.throw(_plain(str(refusal)), type(refusal))

    answered.legacy_boundary = True
    return answered


def _bits(role: int) -> dict:
    """Answer the five legacy bits from one role on the ladder.

    Lossy in one direction, and it is recorded rather than papered over: a
    legacy `Drive Permission` row decided each type independently, so it could
    say `write=1, comment=0`. The ladder cannot spell that, and §5.9 is why -
    a role is ordered on purpose. Nothing here invents a bit the role does not
    reach.
    """
    return {bit: int(role >= rung) for bit, rung in BIT_ROLE.items()}


def _access_type(role: int) -> str:
    """Answer legacy `type`: admin, user, or guest, from the rung the bits come from.

    Legacy called the site admin and the owner `admin` and handed both every
    bit set. §5.9 resolves an owner like anyone else, so an owner holds less
    than MANAGE on a node they created in somebody else's tree. Reading `owner`
    here made the payload contradict itself: `type: "admin"` beside `share: 0`.

    The bits are the truthful half - they are what the SPA hides its buttons on
    - so the label follows them. Nothing in the tree reads `type`.
    """
    if role >= MANAGE:
        return "admin"
    return "user" if role >= EDIT else "guest"


def _file_type(row) -> str:
    """Answer legacy `file_type` from a node's kind and mime.

    The mime table is still the client's vocabulary, so it is read from the
    legacy module rather than copied. The import is function-local because
    `suite.drive.utils` builds a query-builder DocType at import time, which
    needs a bound `frappe.local`; this module is imported without one.
    """
    from suite.drive.utils import get_file_type

    kind = row.get("kind")
    if kind in KIND_FILE_TYPE:
        return KIND_FILE_TYPE[kind]
    return get_file_type(row.get("mime") or "")


def _legacy_row(row) -> dict:
    """Return one node row under the fourteen `FILE_FIELDS` names.

    Renames only, plus the two derivations above. Three legacy columns have no
    producer on a node and are published as `None` rather than guessed:
    `attached_to_doctype` and `attached_to_name` (§14.4 drops the attachment
    join), and `file_url` for anything but a link, which `hide_storage_key`
    blanked on the old surface too.
    """
    file_type = _file_type(row)
    return {
        "name": row.get("name"),
        "file_name": row.get("title"),
        "folder": row.get("parent"),
        "file_url": row.get("url") if file_type in ("Link", "Presentation") else None,
        "file_size": int(row.get("size") or 0),
        "file_type": file_type,
        "is_folder": int(row.get("kind") in ("folder", "root")),
        "content_doctype": row.get("content_doctype"),
        "content_docname": row.get("content_docname"),
        "creation": row.get("creation"),
        "modified": row.get("content_modified") or row.get("modified"),
        "owner": row.get("owner"),
        "attached_to_doctype": None,
        "attached_to_name": None,
    }


def _user_info(user: str | None, fields: list[str]) -> dict:
    """Read one User row for display, or answer nothing.

    Legacy decorated four payloads with `full_name`, `user_image`, and `email`,
    and no §11.2 shape carries them - §11.3 publishes principals, not people.
    The lookup stays here, in the compatibility layer, so the new surface is
    not widened to keep an old payload whole. A missing User row answers `{}`,
    which is what the old bodies did: a file outlives its owner.
    """
    if not user:
        return {}
    return frappe.db.get_value("User", user, fields, as_dict=True) or {}


def _principal_role(row, principal: str) -> int:
    """Resolve what one named principal reaches on a node, as `require` would."""
    return access.effective_role(row, framework.principals_for_principal(principal))


def _page_read(principals, call):
    """Run a page's own read, and send a signed-out visitor to the login page.

    `ErrorPage.vue` redirects to `/login?redirect-to=` on one condition:
    `error.exc_type == "PermissionError"` while nobody is signed in. The old
    bodies threw exactly that for a row the caller could not read, so following
    a share link while signed out landed on the login screen. §5.2 makes the
    workflow answer `DriveNotFound` instead, and the visitor stopped on "Uh
    oh!" with a Login button that discards the address they arrived on.

    The two pages that render `ErrorPage` are the two wrapped here:
    `File.vue:5` and `GenericPage.vue:5` read `verify.error` from
    `get_entity_with_permissions` and `getEntities.error` from `list.files`.
    `useDocument.ts:19` puts the first one under Writer's own `ErrorPage`,
    which reads the same field.

    The substitution is a Guest's only, and it is uniform: every id a Guest
    cannot read answers the same refusal whether it exists or not, so it
    discloses nothing `DriveNotFound` was hiding. A signed-in caller keeps the
    workflow's own class.
    """
    try:
        return call()
    except DriveNotFound:
        if principals.user != "Guest":
            raise
        frappe.throw(_("You don't have access to this file."), frappe.PermissionError)


def _readable_row(node: str):
    """Read a node the caller may see, or answer `None`.

    The workflow decides. A `DriveNotFound` from `require` is the workflow
    answering "not for you" (§5.2), and the old bodies answered the same
    question with a zeroed dict or a `None`, so it is translated back into
    whichever of those the caller expects. It is never re-raised as a deny and
    never stored.

    Every Drive refusal answers `None`, not `DriveNotFound` alone. A caller
    presenting a link meets `DriveLocked` (401) or `DriveLinkExpired` (410) on
    the same read, and `translate_old_name` is guest-callable and documented
    to answer `None` for anything it cannot read.
    """
    try:
        return node_core.get(_principals(), node)
    except DriveError:
        return None


# --------------------------------------------------------------------------
# api/permissions.py
# --------------------------------------------------------------------------


@_legacy
def get_user_access(entity) -> dict:
    """`get_user_access` -> the `access` expansion of `GET /nodes/<id>`.

    Answers zeros for a node the caller cannot see, because that is what the
    old body answered: `dribble_access` returned an all-zero dict for an entity
    with no decided row, and callers merge this into list rows and test bits.
    Turning that into a 404 would break a payload that only ever asked a
    question.
    """
    node = entity if isinstance(entity, str) else (entity or {}).get("name")
    principals = _principals()
    try:
        row = node_core.stored(node) if node else None
    except DriveNotFound:
        row = None
    if row is None:
        return {**NO_ACCESS, "type": "guest"}
    role = access.effective_role(row, principals)
    return {**_bits(role), "type": _access_type(role)}


@_legacy
def get_general_access(entity) -> dict:
    """`get_general_access` -> what the site-wide principals reach on a node.

    Both legacy site-wide principals survive §4.4 by name: `$PUBLIC` is the
    published one a Guest presents, `$GENERAL` is every signed-in user. So the
    old three-way answer is still decidable, and it is decided by the same
    resolution `require` runs, not by reading grant rows here.

    The gate is the old one: legacy needed `read` on the entity, so a caller
    below READ gets the workflow's 404 rather than an answer about somebody
    else's reach.
    """
    node = entity if isinstance(entity, str) else (entity or {}).get("name")
    row = node_core.get(_principals(), node)
    public = _principal_role(row, "$PUBLIC")
    if public >= READ:
        return {**_bits(public), "type": "public"}
    general = _principal_role(row, "$GENERAL")
    if general >= READ:
        return {**_bits(general), "type": "site"}
    return {**NO_ACCESS, "type": "restricted"}


@_legacy
def get_entity_with_permissions(entity_name: str | None = None) -> dict:
    """`get_entity_with_permissions` -> `GET /nodes/<id>?expand=access,breadcrumbs`.

    The payload `get_file_for_doc` returns, so it is the one shape §11.7 makes
    permanent by reference. Every part of it comes from a workflow: the row and
    the trail from `nodes`, the role from `access`, the favourite mark from
    `activity`, and the general marker from the two site-wide principals.

    Three details of the old body are kept because clients depend on them:
    the leaf is appended to `breadcrumbs` (the SPA slices it off itself), the
    answer is also assigned to `frappe.response["data"]` for frappe-ui's
    `useDoc`, and `file_url` stays blanked for managed files.
    """
    if not entity_name:
        raise DriveNotFound(_("We couldn't find what you're looking for."))
    principals = _principals()
    row = _page_read(principals, lambda: node_core.get(principals, entity_name))
    if row.state != "Active":
        # The old query filtered `status: STATUS_ACTIVE` and answered "We
        # couldn't find what you're looking for." for anything else, so a
        # trashed file opened as a page said so. §8.1 reads a node in any
        # state, which is right for a route that can restore one; this name
        # only ever served a page.
        raise DriveNotFound(_("We couldn't find what you're looking for."))
    role = access.effective_role(row, principals)
    trail = [
        {"name": step["name"], "file_name": step["title"]} for step in node_core.breadcrumbs(row, principals)
    ]
    trail.append({"name": row.name, "file_name": row.title})
    marks = activity_core.personal_marks(principals, [row.name]).get(row.name) or {}

    answer = {
        **_legacy_row(row),
        **_bits(role),
        "type": _access_type(role),
        **_user_info(row.get("owner"), ["user_image", "full_name"]),
        "breadcrumbs": trail,
        "is_favourite": row.name if marks.get("favourite") else None,
        "share_count": _share_marker(row),
        "kind": "native",
    }
    # To work with modern frappe-ui composables.
    frappe.response["data"] = answer
    return answer


def _share_marker(row) -> int:
    """Legacy's general-access marker: -2 published, -1 site, 0 restricted."""
    if _principal_role(row, "$PUBLIC") >= READ:
        return -2
    if _principal_role(row, "$GENERAL") >= READ:
        return -1
    return 0


@_legacy
def get_shared_with_list(entity: str) -> list[dict]:
    """`get_shared_with_list` -> `GET /nodes/<id>/grants`.

    Same gate on both sides: legacy needed the `share` bit, which is MANAGE,
    and `grants_for` requires MANAGE. The old row filter is kept here, not
    pushed into the workflow: legacy hid deny rows and the two site-wide
    principals, because this list is the dialog's "shared with" list and the
    general access sits in its own control.

    Every `$LINK:` row is dropped, expired or not. A link is a credential, not
    a person, and §4.4 gives the dialog no control that would show one.
    """
    principals = _principals()
    rows = access.grants_for(entity, principals)["grants"]
    people = []
    for grant in rows:
        principal = grant.get("principal") or ""
        if principal in ("$PUBLIC", "$GENERAL") or principal.startswith("$LINK:"):
            continue
        if not grant.get("role"):
            continue
        shaped = {"user": principal, **_bits(int(grant.get("role") or 0))}
        if principal.startswith("$GROUP:"):
            shaped["is_group"] = 1
            shaped["full_name"] = principal[len("$GROUP:") :]
        else:
            shaped.update(_user_info(principal, ["user_image", "full_name", "email"]))
        people.append(shaped)
    people.sort(key=lambda person: person["user"])

    owner = frappe.db.get_value("Drive Node", entity, "owner")
    owner_info = _user_info(owner, ["user_image", "full_name", "name as user"])
    if owner_info:
        # The owner's User row can be gone; the node outlives them.
        people.insert(0, owner_info)
    return people


# --------------------------------------------------------------------------
# api/activity.py
# --------------------------------------------------------------------------

# A page walked to the end, for the three legacy names that answered a whole
# list. §11.4 caps a page at 200 rows; a legacy client reads an array and has
# no cursor to follow, so the shim follows it.
MAX_LEGACY_ROWS = 2000


def _walk(page_call) -> list:
    """Collect a cursor-paged workflow into the flat list a legacy name returns."""
    rows: list = []
    cursor = None
    while True:
        page = page_call(cursor)
        rows.extend(page["rows"])
        cursor = page.get("next_cursor")
        if not cursor or len(rows) >= MAX_LEGACY_ROWS:
            return rows[:MAX_LEGACY_ROWS]


@_legacy
def get_entity_activity_log(entity_name: str) -> list[dict]:
    """`get_entity_activity_log` -> `GET /nodes/<id>/activity`.

    The old columns are gone and are not reconstructed: `message` was a
    rendered English sentence built at write time, and §9.5 replaced it with an
    `action` and a `detail` the client renders. Both names are published, so a
    client reading `action_type` still reads a value, and the actor's display
    name is decorated back on because no §11.2 shape carries one.
    """
    principals = _principals()
    rows = _walk(lambda cursor: activity_core.history(principals, entity_name, cursor=cursor))
    people: dict[str, dict] = {}
    log = []
    for row in rows:
        actor = row.get("actor")
        if actor not in people:
            people[actor] = _user_info(actor, ["full_name", "user_image"])
        log.append(
            {
                "name": row.get("name"),
                "action_type": row.get("action"),
                "owner": actor,
                "creation": row.get("at"),
                "detail": row.get("detail"),
                "full_name": people[actor].get("full_name"),
                "user_image": people[actor].get("user_image"),
            }
        )
    return log


# --------------------------------------------------------------------------
# api/notifications.py
# --------------------------------------------------------------------------

# Legacy `type` was one of two words. §9.5's action vocabulary is wider, and
# only these three ever produced a notification row.
NOTIFICATION_TYPE = {
    "comment": "Mention",
    "share_add": "Share",
    "share_edit": "Share",
}


def _notification_nodes(node_ids: list[str]) -> dict[str, dict]:
    """Answer legacy `entity_type` and the title, for a page of nodes, in one read.

    `Drive Notification.entity_type` held "Document", "Folder", or "File", and
    `Notifications.vue` routes on it: `drive-` + the value. Neither it nor the
    title is on the notification row any more, and both are derived here
    rather than published as `None`: a null `entity_type` makes every row on
    that page unclickable, and the title is half of the sentence the row is.
    """
    wanted = sorted({node for node in node_ids if node})
    if not wanted:
        return {}
    rows = frappe.get_all(
        "Drive Node", filters={"name": ("in", wanted)}, fields=["name", "kind", "mime", "title"]
    )
    answer = {}
    for row in rows:
        if _file_type(row) == "Document":
            kind = "Document"
        elif row["kind"] in ("folder", "root"):
            kind = "Folder"
        else:
            kind = "File"
        answer[row["name"]] = {"entity_type": kind, "title": row["title"]}
    return answer


def _notification_message(action: str, node: dict | None, sender_name: str | None) -> str | None:
    """Rebuild the sentence `Drive Notification.message` used to hold.

    §9.5 replaced the rendered message with an `action` and a structured
    `detail`, and no writer puts a `message` in either. `Notifications.vue:51`
    renders `row.message` as the row's only text, so a page of rows with no
    message is a page of blank lines. The two sentences are `notify_share`'s
    and `notify_mentions`', word for word, built from the same three parts.
    """
    if not node:
        return None
    title = node.get("title")
    if action == "comment":
        return _("You were mentioned in a comment in: {0}").format(title)
    kind = (node.get("entity_type") or "File").lower()
    return _('{0} shared a {1} with you: "{2}"').format(sender_name or _("Someone"), kind, title)


@_legacy
def get_notifications(only_unread: bool = False) -> list[dict]:
    """`get_notifications` -> `GET /notifications`.

    Same rows, flattened back into the one-level dict the old page reads. The
    sender's display name is decorated on here for the reason §5 gives: the new
    shape publishes principals, not people.
    """
    principals = _principals()
    rows = _walk(
        lambda cursor: activity_core.notifications(principals, only_unread=bool(only_unread), cursor=cursor)
    )
    kinds = _notification_nodes([(row.get("activity") or {}).get("node") for row in rows])
    people: dict[str, dict] = {}
    answer = []
    for row in rows:
        record = row.get("activity") or {}
        sender = record.get("actor")
        if sender not in people:
            people[sender] = _user_info(sender, ["full_name", "user_image"])
        node = kinds.get(record.get("node"))
        answer.append(
            {
                "name": row.get("name"),
                "to_user": principals.user,
                "from_user": sender,
                "read": int(row.get("read") or 0),
                "type": NOTIFICATION_TYPE.get(record.get("action"), "Share"),
                "message": _notification_message(
                    record.get("action"), node, people[sender].get("full_name")
                ),
                "entity_type": (node or {}).get("entity_type"),
                "notif_doctype": "Drive Node",
                "notif_doctype_name": record.get("node"),
                "creation": row.get("creation"),
                "full_name": people[sender].get("full_name"),
                "user_image": people[sender].get("user_image"),
            }
        )
    return answer


@_legacy
def get_unread_count() -> int:
    """`get_unread_count` -> the count behind `GET /notifications?unread=1`.

    The scalar is kept. §11.2 has no route for it and a badge cannot page, so
    the shim calls the workflow the route would have called. It counts what the
    caller can still see, which the old `frappe.db.count` did not: a
    notification about a node they lost access to no longer shows up.
    """
    return activity_core.unread_count(_principals())


@_legacy
def mark_as_read(name: str | None = None, all: bool = False) -> None:
    """`mark_as_read` -> `POST /notifications/read`.

    Returns `None`, as the old body did. The count the workflow answers is not
    published here: no legacy caller reads a result, and inventing one is how a
    client learns to depend on the shim instead of the route.
    """
    principals = _principals()
    if all:
        activity_core.mark_read(principals, None)
        return
    if not name:
        # The old body wrote a filter that matched nothing and said nothing.
        # It stays a no-op; a refusal here would be new behavior.
        return
    activity_core.mark_read(principals, name)


# --------------------------------------------------------------------------
# api/storage.py
# --------------------------------------------------------------------------


def _own_root(principals):
    """The caller's personal root, or `None` when they have none yet."""
    if principals.user == "Guest":
        return None
    return roots.personal_root_for(principals.user)


@_legacy
def storage_bar_data() -> dict:
    """`storage_bar_data` -> `GET /roots/<id>/usage` on the caller's own root.

    Legacy scoped storage to the owner and scanned `tabFile` on every call; §7
    scopes it to a root and keeps a maintained counter. The caller's personal
    root is the closest thing to "my storage", and it is the only root a legacy
    client ever had.

    `total_size` keeps its old meaning - usage including in-flight
    reservations - because the storage bar is drawn from it and would jump
    backwards mid-upload otherwise.
    """
    root = _own_root(_principals())
    if not root:
        return {"total_size": 0, "reserved_size": 0, "limit": 0}
    usage = roots.usage_for(root, _principals())
    return {
        "total_size": int(usage.used_bytes or 0) + int(usage.reserved_bytes or 0),
        "reserved_size": int(usage.reserved_bytes or 0),
        "limit": int(usage.effective_quota or 0),
    }


@_legacy
def storage_breakdown() -> dict:
    """`storage_breakdown` -> `GET /roots/<id>/usage`, plus the two aggregates.

    §11.2 has no route for a by-type total or a largest-files list, so the two
    lists are read here from the caller's own root. It is a read of node rows
    the caller owns, not a second answer to a permission question: the root is
    authorized by `usage_for` first, and nothing is listed outside it.
    """
    principals = _principals()
    root = _own_root(principals)
    if not root:
        return {"limit": 0, "total": [], "entities": []}
    limit = int(roots.usage_for(root, principals).effective_quota or 0)

    rows = frappe.get_all(
        "Drive Node",
        filters={
            "root": root,
            "owner": principals.user,
            "state": "Active",
            "kind": ["in", ["file", "document", "link"]],
        },
        fields=["name", "title", "owner", "size", "mime", "kind"],
        order_by="size desc",
    )
    by_type: dict[str, int] = {}
    for row in rows:
        by_type[_file_type(row)] = by_type.get(_file_type(row), 0) + int(row.size or 0)
    # Legacy listed only the files worth acting on when a quota existed.
    floor = limit / 200 if limit else 0
    return {
        "limit": limit,
        "total": [{"file_type": name, "file_size": size} for name, size in by_type.items()],
        "entities": [
            {
                "name": row.name,
                "file_name": row.title,
                "owner": row.owner,
                "file_size": int(row.size or 0),
                "file_type": _file_type(row),
            }
            for row in rows
            if int(row.size or 0) >= floor
        ],
    }


# --------------------------------------------------------------------------
# api/embed.py
# --------------------------------------------------------------------------


@_legacy
def embed_file_content(embed_name: str, parent_entity_name: str):
    """`embed.get_file_content` -> `GET /nodes/<id>/media`, then a redirect.

    §6.8 stopped streaming media bytes through a method call and started
    signing them for fifteen minutes. `list_media` authorizes the parent
    document once and answers every picture below it, so the containment check
    the old body ran by hand is now the query's own filter: an embed that is
    not below `parent_entity_name` is simply not in the answer.

    The old body answered a `send_file` response, so this answers a 302 to the
    signed URL rather than a JSON body: an `<img src>` pointing at the old
    method URL keeps working.
    """
    for media in content.list_media(_principals(), parent_entity_name):
        if media["node"] == embed_name:
            frappe.local.response["location"] = media["url"]
            frappe.local.response["type"] = "redirect"
            return
    raise DriveNotFound(_("This Drive document has no such embed"))


# --------------------------------------------------------------------------
# Retired: §11.7 dropped the behavior
# --------------------------------------------------------------------------


@_legacy
def create_auth_token(entity_name: str | None = None) -> None:
    """Retired. §8.4 replaced the download token with a signed URL.

    It never mints anything. The old body handed back a JWT good for one
    download, and a shim that returned any string at all would be a capability
    token this release cannot honour.
    """
    _retire(
        "suite.drive.api.files.create_auth_token",
        _("Drive signs a download URL at GET /api/suite/drive/nodes/:id/content."),
    )


@_legacy
def get_new_title(title: str | None = None, parent_name: str | None = None, folder: bool = False) -> None:
    """Retired. §8.6 refuses a sibling collision instead of renaming around it.

    The old body answered "Report (2)" so a client could pre-empt a clash. A
    shim cannot answer it: a deduplicated title is now chosen inside the write,
    under the same lock that checks the siblings, and a title guessed before
    the write is a guess.
    """
    _retire(
        "suite.drive.api.files.get_new_title",
        _("Drive answers a sibling collision with a 409 refusal at write time."),
    )


@_legacy
def sync_from_disk() -> None:
    """Retired. §14 makes Build the disk import.

    It refuses rather than answering an empty list, because the caller reads
    the length of what comes back and an empty list reads as "it ran, nothing
    was new". Nothing is created and nothing is reported as created.
    """
    _retire(
        "suite.drive.api.scripts.sync_from_disk",
        _("The Drive Build migration imports the storage tree."),
    )


# --------------------------------------------------------------------------
# api/files.py
# --------------------------------------------------------------------------

# The legacy client picks its own upload id and repeats it on every chunk;
# §8.4 makes the id the server's, because it is what binds a session to the
# destination the caller was authorized for. The two are joined here, in the
# caller's own cache namespace, and nowhere else.
LEGACY_UPLOAD_PREFIX = "drive:legacy-upload"
LEGACY_UPLOAD_TTL = 24 * 60 * 60

# Legacy sort columns that survive §11.4's four. Anything else fell back to
# `modified` on the old surface rather than refusing, so it still does.
#
# Legacy `modified` was one column, `COALESCE(file_modified, modified)`, and
# the old query sorted by the same expression it published. A node carries the
# pair apart, and `_legacy_row` publishes the coalesce, so the legacy name maps
# to §11.4's `content_modified` - the ordering that falls back to the row's own
# time. Mapping it to `modified` sorted the page by a value the client is never
# shown, and `upload_file` stamps `content_modified` from the client's own
# `file_modified`, so the two differ on every uploaded file.
ORDER_COLUMN = {
    "file_name": "title",
    "file_size": "size",
    "modified": "content_modified",
}


def _order_column(order_by: str) -> str:
    """The §11.4 column one legacy sort name asks for.

    The toolbar sends five names and §11.4 keeps three, and the old query fell
    back to `modified` for the other two rather than refusing. The fallback is
    mapped like any name the caller does spell, or an unknown column would
    sort by a column the row does not publish while `modified` sorted by the
    one it does.
    """
    return ORDER_COLUMN.get(order_by, ORDER_COLUMN["modified"])


def _home(principals) -> str:
    """The caller's own root node, provisioned on first use as §14.3 says.

    It never answers `None`. `provision_personal_root` refuses `Guest` and
    `Administrator` (§7: a Personal root belongs to an ordinary Suite user),
    and a `None` here travelled: `get_root_folder` published `home: None`, and
    the next `files()`, `trash()`, `move()`, or `delete_entities(clear_all=1)`
    failed somewhere else with a message about a missing node or an invalid
    root. The refusal is named where the reason is.
    """
    if principals.user == "Guest":
        frappe.throw(_("A Drive folder is required"), frappe.ValidationError)
    home = roots.personal_root_for(principals.user) or roots.provision_personal_root(principals.user)
    if not home:
        frappe.throw(
            _("{0} has no personal Drive folder").format(_spelled(principals.user)),
            frappe.ValidationError,
        )
    return home


def _child_named(principals, parent: str, title: str) -> str | None:
    """The active child of `parent` called `title`, if the caller may ask.

    `title_taken` is the gate: it requires UPLOAD on the parent for the reason
    `does_entity_exist` did, so the id read after it is never an answer to a
    caller who could not have asked the question.
    """
    if not node_core.title_taken(principals, parent, title):
        return None
    return frappe.db.get_value("Drive Node", {"parent": parent, "title": title, "state": "Active"}, "name")


def _ensure_path(principals, fullpath: str, parent: str) -> str:
    """Create the folders a browser's directory upload names, and return the leaf."""
    for segment in Path(fullpath).parts[:-1]:
        found = _child_named(principals, parent, segment)
        parent = found or node_core.create_folder(principals, parent, segment)
    return parent


def _upload_key(principals, session: str) -> str:
    return f"{LEGACY_UPLOAD_PREFIX}:{principals.user}:{session}"


@_legacy
def upload_file(
    total_file_size: int = 0,
    file_modified: int | None = None,
    fullpath: str | None = None,
    parent: str | None = None,
    embed: int = 0,
):
    """`upload_file` -> `POST /uploads`, `PUT .../chunk`, `POST .../finish`.

    One legacy call is one chunk. The old body accumulated chunks in a temp
    file and inserted the row on the last one; the three new calls do the same
    work with the session id issued by the server, so the client's own `uuid`
    is bound to it for the length of the upload and thrown away after.

    `embed=1` is not a placement any more. §9.4 makes an embed a media node
    below the document it is in, which is the `parent` the caller already
    named, so the flag decides nothing here.

    The filename is deduplicated before the write, as the old body's
    `get_new_file_name` did. §8.6 refuses a sibling collision and tells the
    user to pick another title; this caller has no dialog to ask with and its
    contract was to rename around a clash, so `available_title` answers §8.6's
    own suffix rule for it. The route still refuses.
    """
    principals = _principals()
    parent = parent or _home(principals)
    if fullpath:
        parent = _ensure_path(principals, fullpath, parent)

    upload = frappe.request.files["file"]
    if frappe.form_dict.chunk_index:
        index = int(frappe.form_dict.chunk_index)
        total_chunks = int(frappe.form_dict.total_chunk_count)
        offset = int(frappe.form_dict.chunk_byte_offset)
    else:
        index, total_chunks, offset = 0, 1, 0

    # The old body minted a session id only for a single-chunk upload, and
    # refused a chunked one that named none. Minting here instead binds every
    # chunk to a new `upload_id`, and the last one finishes a file with holes.
    session = frappe.form_dict.uuid
    if not session and total_chunks == 1:
        session = frappe.generate_hash(12)
    if not isinstance(session, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,64}", session):
        frappe.throw(_("Invalid upload session."), frappe.ValidationError)

    # The old body never read `total_file_size` to size the file - it wrote to
    # a temp file and read the bytes back off disk - and `FileUploader.vue`
    # only sends the field on a chunked upload, so every file below Dropzone's
    # twenty megabyte chunk size arrives declaring nothing. A session that
    # declares zero refuses its own first chunk with "Upload exceeds the
    # declared file size" and deletes itself. The body in hand is the whole
    # file whenever there is one chunk, so it is what the session declares.
    body = upload.stream.read()
    declared = int(total_file_size or 0) or offset + len(body)

    key = _upload_key(principals, session)
    upload_id = frappe.cache().get_value(key)
    if not upload_id:
        opened = upload_core.create_upload(
            principals,
            parent,
            upload.filename,
            declared,
            mime=upload.mimetype,
        )
        if opened["mode"] == "direct":
            # The driver handed back a presigned target for the client to PUT
            # to. This caller has already sent its bytes here instead, and
            # §11.7 has no way to hand them on: a presigned POST pins the
            # object to one request and the whole declared length, which a
            # chunked legacy upload does not have. Named here, because the
            # framework's own refusal is "expects a direct upload, not chunks".
            frappe.throw(
                _("This site stores Drive files directly. Upload from the Drive app instead."),
                frappe.ValidationError,
            )
        upload_id = opened["upload_id"]
        frappe.cache().set_value(key, upload_id, expires_in_sec=LEGACY_UPLOAD_TTL)

    upload_core.upload_chunk(principals, upload_id, offset, body)
    if index != total_chunks - 1:
        return None

    frappe.cache().delete_value(key)
    node = upload_core.finish_upload(
        principals,
        upload_id,
        parent=parent,
        title=node_core.available_title(principals, parent, upload.filename),
        content_modified=int(file_modified) / 1000 if file_modified else None,
    )
    row = node_core.stored(node)
    # `GenericPage.vue` still listens for `list-add` and appends the row to the
    # open folder. Without it the uploaded file only appears on a reload. The
    # old body broadcast the row to every connected session; it is sent to the
    # uploader alone here, because §5 does not let a node row travel to a
    # session that was never authorized for it.
    frappe.publish_realtime(
        "list-add", {"file": _legacy_list_rows(principals, [row])[0]}, user=principals.user
    )
    return _legacy_row(row)


@_legacy
def get_thumbnail(entity_name: str):
    """`get_thumbnail` -> `GET /nodes/<id>?expand=preview`.

    §6.8 stopped streaming a thumbnail through a method call and started
    signing it, so this redirects to the signed URL instead of answering webp
    bytes. A node with no rendered preview still answers `""`, which is what
    the old body answered and what the caller's `<img>` already handles.
    """
    principals = _principals()
    row = node_core.get(principals, entity_name)
    preview = previews.preview_expansions([row.name]).get(row.name)
    if not preview:
        return ""
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = preview["url"]
    return None


@_legacy
def create_folder(file_name: str, parent: str | None = None):
    """`create_folder` -> `POST /nodes` with `kind=folder`."""
    principals = _principals()
    node = node_core.create_folder(principals, parent or _home(principals), file_name)
    return _legacy_row(node_core.stored(node))


@_legacy
def create_link(file_name: str, link: str, parent: str | None = None):
    """`create_link` -> `POST /nodes` with `kind=link`."""
    principals = _principals()
    node = node_core.create_link(principals, parent or _home(principals), file_name, url=link)
    return _legacy_row(node_core.stored(node))


@_legacy
def get_file_content(entity_name: str, trigger_download: bool = False, token: str | None = None):
    """`get_file_content` -> `GET /nodes/<id>/content`.

    A 302 to a signature that lives fifteen minutes, which is what §6.8 makes
    every byte path. `trigger_download` is carried by the signature's own
    filename, so it decides nothing here.

    A `token` is refused rather than honoured. `create_auth_token` is retired
    and mints nothing, so any token presented here is either expired or forged,
    and answering bytes for one would be the capability this release removed.
    """
    if token:
        _retire(
            "the suite.drive.api.files.get_file_content download token",
            _("Drive signs a download URL at GET /api/suite/drive/nodes/:id/content."),
        )
    principals = _principals()
    row = node_core.get(principals, entity_name)
    if row.kind == "document":
        frappe.local.response["type"] = "redirect"
        frappe.local.response["location"] = "/drive/w/" + row.name
        return None
    signed = node_core.signed_content_url(row)
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = signed["url"]
    return None


@_legacy
def stream_file_content(entity_name: str):
    """`stream_file_content` -> `GET /nodes/<id>/content`.

    The same redirect. Range requests are answered by storage behind the
    signed URL now, not by this worker reading twenty megabytes into memory,
    so there is nothing left for a separate streaming entry point to do.
    """
    return get_file_content(entity_name)


@_legacy
def set_favourite(entities: list | None = None, clear_all: bool = False):
    """`set_favourite` -> `PUT`/`DELETE /nodes/<id>/favourite`.

    `clear_all` has no route of its own, so it is walked: every favourite the
    caller still holds is cleared through the same workflow one mark uses.
    """
    principals = _principals()
    if clear_all:
        # `_visible_personal_rows` replaces `row.node` with the node row it
        # authorized, so the id is one level in. Passing the dict filtered
        # `Drive Favourite` on a dict, matched nothing, and cleared nothing.
        for row in _walk(lambda cursor: activity_core.favourites(principals, cursor=cursor)):
            activity_core.set_favourite(principals, row["node"]["name"], False)
        return None
    if not isinstance(entities, list):
        frappe.throw(_("Expected list but got {0}").format(_spelled(type(entities))), frappe.ValidationError)

    marks = activity_core.personal_marks(principals, [entity.get("name") for entity in entities])
    for entity in entities:
        node = entity.get("name")
        value = entity.get("is_favourite")
        if value is None or value == "":
            # The old body toggled when the client said nothing.
            value = not (marks.get(node) or {}).get("favourite")
        if isinstance(value, str):
            value = json.loads(value)
        activity_core.set_favourite(principals, node, bool(value))
    return None


@_legacy
def remove_or_restore(entity_names):
    """`remove_or_restore` -> `PATCH /nodes/<id>` `{state}`.

    The old name is one gesture with two meanings, so the current state
    decides which, exactly as `toggle_entity_status` did. A restore names no
    destination: §8.7 puts a node back where it was and refuses when that place
    is gone, and this shim will not pick a different one to avoid the refusal.
    """
    principals = _principals()
    if isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    if not isinstance(entity_names, list):
        frappe.throw(
            _("Expected list but got {0}").format(_spelled(type(entity_names))), frappe.ValidationError
        )
    for node in entity_names:
        row = node_core.get(principals, node)
        state = "Trashed" if row.state == "Active" else "Active"
        node_core.update(principals, node, state=state)
    return None


@_legacy
def delete_entities(entity_names: list[str] | None = None, clear_all: bool = False):
    """`delete_entities` -> `DELETE /nodes/<id>`.

    `clear_all` is walked over the caller's own trash view, so the rows it
    purges are the rows §11.2 would have listed and nothing else.
    """
    principals = _principals()
    if clear_all:
        root = _home(principals)
        entity_names = [
            row["name"]
            for row in _walk(lambda cursor: node_core.views(principals, "trash", cursor=cursor, root=root))
        ]
    elif isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    elif not isinstance(entity_names, list) or not entity_names:
        frappe.throw(
            _("Expected non-empty list but got {0}").format(_spelled(type(entity_names))),
            frappe.ValidationError,
        )
    for node in entity_names:
        node_core.purge(principals, node)
    return None


@_legacy
def rename(entity_name: str, new_title: str):
    """`rename` -> `PATCH /nodes/<id>` `{title}`."""
    principals = _principals()
    node_core.update(principals, entity_name, title=new_title)
    return _legacy_row(node_core.stored(entity_name))


@_legacy
def move(entity_names: list[str], new_parent: str | None = None):
    """`move` -> `PATCH /nodes/<id>` `{parent}`.

    Answers the destination, not the moved file. `File.move` returned
    `frappe.get_value("File", new_parent, ["file_name", "name", "folder"])`,
    and both frontend `move` resources read it that way: the toast says "Moved
    to <file_name>", "Go" opens `name` as a folder, and `updateMoved(name)`
    refreshes that folder's page. Returning the moved node instead sent the
    user into a file and refreshed the wrong listing.
    """
    principals = _principals()
    if isinstance(entity_names, str):
        entity_names = json.loads(entity_names)
    if not entity_names or not isinstance(entity_names, list):
        frappe.throw(
            _("Expected a non-empty list but got {0}").format(_spelled(type(entity_names))),
            frappe.ValidationError,
        )
    destination = new_parent or _home(principals)
    for node in entity_names:
        node_core.update(principals, node, parent=destination)
    row = node_core.stored(destination)
    return {"file_name": row.get("title"), "name": row.get("name"), "folder": row.get("parent")}


# The two site-wide principals were one setting on the old surface: a
# `Drive Permission` row naming `""` or `$GENERAL`, and `File._clear_general`
# dropped both of them together. §4.4 keeps them as two principals, so a
# legacy caller naming either one is naming that whole setting.
SITE_WIDE = ("$PUBLIC", "$GENERAL")


def _legacy_role(kwargs) -> int:
    """Read one rung from the five legacy bits, granting no verb unasked.

    The old bits were independent; §5.9's rungs are ordered, and a rung carries
    every verb below it. So the rung is the highest one whose bit is set *and*
    all of whose lower bits are set, not the highest bit on its own: a row that
    says `read, comment, share` is asking to re-share something it may not
    edit, and the highest bit alone would answer MANAGE and hand out edit,
    move, and purge with it.

    Lossy downwards, and recorded: `share` without `write` cannot be spelled,
    so the answer stops below it. Nothing here reaches a rung the caller did
    not ask for every verb of.
    """
    role = 0
    for bit, rung in sorted(BIT_ROLE.items(), key=lambda pair: pair[1]):
        if not _flag(kwargs.get(bit)):
            break
        role = rung
    return role


@_legacy
def update_access(entity_name: str, method: str, **kwargs):
    """`update_access` -> `PUT`/`DELETE /nodes/<id>/grants/<principal>`.

    The five independent bits become one rung through `_legacy_role`, and
    `$PUBLIC` is held at §6.5's ceiling: a published node is the one row
    `(node, $PUBLIC, READ)`, so that is what a legacy publish writes. Granting
    less than the old row named is the safe direction and the only legal one.

    Two rules this cannot break. `deny=1` is the caller asking for role 0 and
    is passed through as one; `unshare` removes rows and writes none. §5.10
    keeps removal and denial apart, so the old body's habit of inserting a deny
    to cut inheritance stops here: a client that wants a denial has to say so.
    """
    principals = _principals()
    kwargs.pop("cmd", None)
    principal = kwargs.get("user") or "$PUBLIC"
    if not isinstance(principal, str):
        # `**kwargs` is the request body. `access._principal_kind` refuses a
        # non-string cleanly; reaching `startswith` first answers a traceback.
        frappe.throw(_("Drive grant principal is invalid"), frappe.ValidationError)
    if principal == "":
        principal = "$PUBLIC"
    if principal == "$LINK" or principal.startswith("$LINK:"):
        # `access.grant("$LINK", ...)` mints a token and answers its `/drive/l/`
        # URL. §11.7 gives no legacy name that contract, and `File.share` had
        # no branch for it: an unknown principal went to `create_invites`, which
        # refused an address that is not one. A share link is §8.5's route to
        # issue, not a capability this shim hands back.
        frappe.throw(
            _("Drive issues a share link at PUT /api/suite/drive/nodes/:id/grants/$LINK"),
            frappe.ValidationError,
        )

    if method == "unshare":
        # One gesture, both rows. `File.unshare("$GENERAL")` called
        # `_clear_general`, which dropped the public row with it, and the
        # dialog's "Restricted" still sends only `$GENERAL`. Revoking one row
        # would leave a published file published.
        for target in SITE_WIDE if principal in SITE_WIDE else (principal,):
            access.revoke(entity_name, target, principals)
        return None
    if method != "share":
        frappe.throw(
            _("Drive access method {0} is not supported").format(_spelled(method)), frappe.ValidationError
        )

    expires_on = _kept_expiry(entity_name, principal, principals)
    if _flag(kwargs.get("deny")):
        return access.grant(entity_name, principal, 0, principals, expires_on=expires_on)
    role = _legacy_role(kwargs)
    if principal == "$PUBLIC":
        role = min(role, READ)
    if not role:
        # A share that reaches no rung must not be written. Role 0 is §5.10's
        # deny, and the old row was not one: `File.share` left an unnamed bit
        # at whatever the existing row held and set `deny=0` regardless, so an
        # all-zero row was "no access", never "denied". Writing 0 here would
        # turn a partial share into a deny that cuts inheritance from above.
        frappe.throw(
            _("A Drive share must name at least read access."),
            frappe.ValidationError,
        )
    return access.grant(entity_name, principal, role, principals, expires_on=expires_on)


def _kept_expiry(entity_name: str, principal: str, principals):
    """The expiry a grant already carries, so a legacy re-share keeps it.

    `access.grant` replaces the whole row: §11.2 spells it `PUT`. This caller
    has no field for an expiry and never had one, so re-sharing through it
    cleared an expiry set from the new surface and turned a time-limited share
    into a permanent one. `grants_for` needs MANAGE, which `grant` needs too.
    """
    for row in access.grants_for(entity_name, principals)["grants"]:
        if row["principal"] == principal:
            return row["expires_on"]
    return None


def _flag(value) -> bool:
    """Read one legacy permission bit, which arrives as a bool, an int, or a word."""
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


@_legacy
def remove_recents(entity_names: list[str] | None = None, clear_all: bool = False):
    """`remove_recents` -> `DELETE /views/recents`.

    `clear_all` clears everything and a named list clears those rows. An empty
    list clears nothing, which is the one difference from the workflow's own
    default: `clear_recents(None)` means "all", and forwarding a missing list
    onto it would empty an inbox the old call left alone.
    """
    principals = _principals()
    if clear_all:
        return activity_core.clear_recents(principals, None)
    if not isinstance(entity_names, list | type(None)):
        frappe.throw(
            _("Expected list but got {0}").format(_spelled(type(entity_names))), frappe.ValidationError
        )
    return activity_core.clear_recents(principals, entity_names or [])


@_legacy
def does_entity_exist(name: str | None = None, folder: str | None = None):
    """`does_entity_exist` -> the sibling check inside `POST /nodes`.

    Same UPLOAD gate as the old body, for the same reason: the answer is
    derived from names in a folder, so a caller who could not write there is
    not entitled to it.
    """
    principals = _principals()
    return node_core.title_taken(principals, folder or _home(principals), name)


# The old scan, in the new window size: `SEARCH_PAGE_LENGTH` readable rows out
# of at most `MAX_SEARCH_WINDOWS * MAX_PAGE_SIZE` raw ones. `api/files.search`
# read ten windows of a hundred for the same thousand.
SEARCH_PAGE_LENGTH = 50
MAX_SEARCH_WINDOWS = 5


@_legacy
def search(query: str):
    """`search` -> `GET /views/search`, walked until the page is full.

    The view's permission filter runs after the SQL window (`page_of`), so one
    fixed window makes the reply depend on how many rows the caller *cannot*
    read happen to sort first: someone shared on few files gets a short page,
    or an empty one, while matches they can read sit just past row fifty. The
    old body walked successive windows for exactly this reason and said so.
    """
    principals = _principals()
    if not query or not query.strip():
        return []
    rows: list = []
    cursor = None
    for _window in range(MAX_SEARCH_WINDOWS):
        page = node_core.views(
            principals,
            "search",
            term=query.strip(),
            cursor=cursor,
            limit=node_core.MAX_PAGE_SIZE,
        )
        rows.extend(page["rows"])
        cursor = page["next_cursor"]
        if not cursor or len(rows) >= SEARCH_PAGE_LENGTH:
            break
    return [_legacy_search_row(row) for row in rows[:SEARCH_PAGE_LENGTH]]


def _legacy_search_row(row) -> dict:
    """The eleven columns `SEARCH_QUERY` selected, from one node row."""
    owner = _user_info(row.get("owner"), ["name as user_name", "user_image", "full_name"])
    return {
        "name": row.get("name"),
        "file_name": row.get("title"),
        "file_type": _file_type(row),
        "is_folder": int(row.get("kind") in ("folder", "root")),
        "owner": row.get("owner"),
        "attached_to_doctype": None,
        "attached_to_name": None,
        "content_doctype": row.get("content_doctype"),
        "content_docname": row.get("content_docname"),
        "user_name": owner.get("user_name"),
        "user_image": owner.get("user_image"),
        "full_name": owner.get("full_name"),
    }


@_legacy
def translate_old_name(old_name: str):
    """`translate_old_name` -> a readability check on the id itself.

    §14.3 gives every node the id its `File` row had, so a pre-migration id
    needs no translation: it either names a node the caller may read, or it
    answers `None`. Missing and unreadable answer the same thing, so a guest
    cannot probe which private files exist.
    """
    return old_name if _readable_row(old_name) else None


@_legacy
def get_entity_type(entity_name: str):
    """`get_entity_type` -> `GET /nodes/<id>`."""
    row = node_core.get(_principals(), entity_name)
    return {
        "name": row.name,
        "file_type": _file_type(row),
        "type": "folder" if row.kind in ("folder", "root") else "file",
    }


@_legacy
def get_root_folder():
    """`get_root_folder` -> the two root nodes a client bootstraps from.

    §11.2 has no root-discovery route: `GET /roots/<id>/usage` needs the id it
    would have answered. The two roots are read from `_core.roots`, which is
    where the route would have read them.
    """
    principals = _principals()
    shared = roots.active_root_for(kind=roots.SHARED)
    if not shared:
        # Legacy answered `drive_root().name`, which made the row when it was
        # missing. §7 makes the Shared root part of Build, not of a read, and a
        # `None` here travelled: the client stored it and asked for its
        # children. The refusal is named where the reason is, as `_home` does.
        frappe.throw(_("This site has no shared Drive folder"), frappe.ValidationError)
    return {"root": shared, "home": _home(principals)}


@_legacy
def redirect_to_original(file_id: str):
    """`redirect_to_original` -> `GET /nodes/<id>`, then the original document.

    §14.4 turns an adopted library attachment into a plain file node and drops
    its content link, so after Build no node answers this and every call meets
    the same refusal the old body gave a non-attachment. It is not made to
    answer one by pointing somewhere else.
    """
    row = node_core.get(_principals(), file_id)
    if row.content_doctype != "File":
        frappe.throw(_("This is not an attachment"), frappe.ValidationError)
    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = "/drive/g/" + row.content_docname
    return None


@_legacy
def track_visit(
    entity_name: str | None = None,
    doctype: str | None = None,
    docname: str | None = None,
):
    """`track_visit` -> `POST /nodes/<id>/visit`.

    The old body also cleared the caller's unread notifications about the node
    it opened. That is kept, through `mark_read`, because a badge that never
    clears is the visible half of this call.
    """
    principals = _principals()
    if not entity_name and doctype and docname:
        entity_name = frappe.db.get_value(
            "Drive Node", {"content_doctype": doctype, "content_docname": docname}, "name"
        )
    if not entity_name:
        frappe.throw(_("A Drive file or content document is required"), frappe.ValidationError)
    activity_core.visit(principals, entity_name)
    unread = _walk(lambda cursor: activity_core.notifications(principals, only_unread=True, cursor=cursor))
    here = [row["name"] for row in unread if (row.get("activity") or {}).get("node") == entity_name]
    if here:
        activity_core.mark_read(principals, here)
    return None


@_legacy
def resolve_legacy_route(old_id: str):
    """`resolve_legacy_route` -> `Drive Legacy Route`, then the node it names.

    The mapping table is the only answer to a pre-team-restructure link, so it
    is read here and the id it yields is checked for readability like any
    other. Nothing exists, nothing readable, and nothing active all answer
    `None`, so the caller 404s without being told which of the three it was.
    """
    entity = frappe.db.get_value("Drive Legacy Route", old_id, "entity")
    if not entity:
        return None
    row = _readable_row(entity)
    if row is None or row.state != "Active":
        return None
    return {"name": row.name, "is_folder": row.kind in ("folder", "root")}


# --------------------------------------------------------------------------
# api/list.py
# --------------------------------------------------------------------------

# The legacy default page. §11.4 caps at 200; the old surface capped at 100 and
# a client that asked for nothing got that, so it still does.
LEGACY_PAGE_SIZE = 100


def _share_counts(names: list[str]) -> dict[str, int]:
    """Answer each listed node's share marker from its own grant rows.

    Legacy's `-2` and `-1` meant "published" and "everyone signed in", and its
    positive count meant "shared with this many people". All three are read
    from the local rows here, and only the local rows: §5.10 keeps what an
    ancestor decides in `explain`, and a list that folded inheritance into a
    per-row count would report a share this node does not hold.
    """
    if not names:
        return {}
    rows = frappe.get_all(
        "Drive Grant",
        filters={"node": ["in", names], "role": [">", 0]},
        fields=["node", "principal"],
    )
    counts: dict[str, int] = dict.fromkeys(names, 0)
    public: set[str] = set()
    general: set[str] = set()
    for row in rows:
        principal = row["principal"]
        if principal == "$PUBLIC":
            public.add(row["node"])
        elif principal == "$GENERAL":
            general.add(row["node"])
        elif not principal.startswith("$LINK:"):
            counts[row["node"]] += 1
    for name in names:
        if name in public:
            counts[name] = -2
        elif name in general:
            counts[name] = -1
    return counts


def _legacy_list_rows(principals, rows: list) -> list[dict]:
    """Build the twenty-eight column legacy list row for one page of nodes.

    Five decorations the §11.3 node shape does not carry, and each is read
    once for the whole page rather than once per row: the owner's display
    fields, the caller's own favourite and recent marks, the folder child
    count, the share marker, and a presentation's slide count.

    `slide_count` is carried only on presentation rows, as `_visible_rows`
    carried it. `DriveListRow.sizeLabel` reads `row.slide_count != null` to
    decide between "12 slides" and a byte size, so setting it on every row
    would relabel every file on the page.
    """
    names = [row["name"] for row in rows]
    marks = activity_core.personal_marks(principals, names)
    children = node_core.readable_child_counts(principals, names)
    shares = _share_counts(names)
    slides = _slide_counts(rows)
    owners = {}
    answer = []
    for row in rows:
        owner = row.get("owner")
        if owner not in owners:
            owners[owner] = _user_info(owner, ["full_name", "user_image"])
        role = access.effective_role(row, principals)
        mark = marks.get(row["name"]) or {}
        shaped = {
            **_legacy_row(row),
            "owner_full_name": owners[owner].get("full_name"),
            "owner_image": owners[owner].get("user_image"),
            "is_favourite": mark.get("favourite"),
            "accessed": mark.get("opened_at"),
            "child_count": children.get(row["name"], 0),
            "share_count": shares.get(row["name"], 0),
            "kind": "native",
            **_bits(role),
            "type": _access_type(role),
        }
        if row.get("content_doctype") == "Presentation":
            shaped["slide_count"] = slides.get(row.get("content_docname"), 0)
        answer.append(shaped)
    return answer


def _slide_counts(rows: list) -> dict[str, int]:
    """Count the slides behind each presentation row, in one query.

    `api/list._get_slide_counts` is retained and already answers this. It is
    reached rather than copied because reaching the producer directly would
    put a second Drive-to-content-product import in the tree, and that import
    is owned debt held against one file (see `tests/test_architecture.py`).
    The import is function-local because `api/list` imports this module.
    """
    from suite.drive.api.list import _get_slide_counts

    return _get_slide_counts(rows)


def _matching_kinds(rows: list, file_kinds) -> list:
    """Keep the rows whose legacy `file_type` the caller asked for.

    §11.2 replaced the family filter with one `mime_prefix`, which cannot spell
    `Folder` and cannot spell two families at once. The old vocabulary is kept
    and applied to the page instead, so a client's saved filter still selects
    what it selected before.
    """
    if not file_kinds:
        return rows
    if isinstance(file_kinds, str):
        file_kinds = json.loads(file_kinds)
    if not file_kinds:
        return rows
    from suite.drive.utils import MIME_LIST_MAP

    # `get_file_type` answers the first table key holding the mime, so a row
    # has one family and `frappe_doc` is under `Document` before it is under
    # `Frappe Document`: that second family selected nothing at all. The old
    # filter was `mime_type IN (...)` over the union of the named families and
    # matched both, so the mimes are read here as well as the family.
    wanted = set(file_kinds)
    mimes = {mime for kind in wanted for mime in MIME_LIST_MAP.get(kind, [])}
    return [row for row in rows if _file_type(row) in wanted or row.get("mime") in mimes]


def _matching_titles(rows: list, term: str | None) -> list:
    """Keep the rows whose title contains `term`, as the old `LIKE` did.

    §11.2 gives the tree-wide search its own view and gives the other five
    listings no search argument at all. The old surface accepted one on every
    one of them and answered `file_name LIKE '%term%'`, so the same filter is
    applied to the page here rather than dropping an argument the toolbar still
    sends. Case-insensitive, because the column's collation is.
    """
    if not term:
        return rows
    needle = term.strip().casefold()
    if not needle:
        return rows
    return [row for row in rows if needle in (row.get("title") or "").casefold()]


# The most rows this module will hold in memory to sort a view the workflow
# does not sort. A list longer than this keeps the view's own order rather
# than losing the rows past the bound: `_ordered_listing` says why.
MAX_SORTABLE_ROWS = 2000

# The ceiling on an unfiltered listing walk. The permission filter
# runs after the SQL window on the old surface and on this one, so a caller who
# can read almost nothing in a large folder walks it a page at a time either
# way; `decode_cursor` refuses only at offset ten million, which is not a
# bound. Two hundred full windows is forty thousand rows, past any folder the
# tree sidebar or the move dialog asks for whole, and `has_next` stays true.
MAX_WALK_WINDOWS = 200

# The ceiling on a whole-view walk, which reads full windows and keeps only
# the rows a filter of this module's own matches. Ten of them is the same two
# thousand rows `MAX_SORTABLE_ROWS` allows, counted in reads instead of keeps:
# without it a filter matching nothing reads the whole view on every call, and
# `list.files` is `allow_guest`.
MAX_VIEW_WINDOWS = MAX_SORTABLE_ROWS // node_core.MAX_PAGE_SIZE


def _sort_key(row, column: str):
    """One row's value under a legacy sort column, in the old collation."""
    if column == "title":
        return (row.get("title") or "").casefold()
    if column == "size":
        return int(row.get("size") or 0)
    return str(row.get("content_modified") or row.get("modified") or "")


def _ordered(rows: list, order_by: str, ascending: bool) -> list:
    """Sort a whole listing the way `get_query_data` sorted it.

    Three levels, and the old query had all three: the named column, then
    `file_name` in the same direction, then `name` ascending to break the
    remaining ties. The tertiary level runs first and Python's sort is stable,
    so it survives the pass above it whichever way that one points.

    The column vocabulary is `ORDER_COLUMN`'s, the same three §11.4 kept, and
    an unknown name falls back to `modified` here exactly as it does on the
    folder page. Nothing wider is invented for a view than a folder can answer.
    """
    column = _order_column(order_by)
    rows = sorted(rows, key=lambda row: row.get("name") or "")
    return sorted(
        rows,
        key=lambda row: (_sort_key(row, column), _sort_key(row, "title")),
        reverse=not ascending,
    )


def _whole_view(page_call, file_kinds, search) -> tuple[list, bool]:
    """Collect every row of a view, and say whether it ran past either bound.

    Two bounds, because the rows kept and the rows read are not the same
    number once `file_kinds` or `search` is applied here: `MAX_SORTABLE_ROWS`
    caps what is sorted, and `MAX_VIEW_WINDOWS` caps what is read. Without the
    second one a filter matching nothing walks the whole view every call.
    """
    rows: list = []
    cursor = None
    for window in range(MAX_VIEW_WINDOWS):
        page = page_call(cursor, node_core.MAX_PAGE_SIZE)
        rows.extend(_matching_titles(_matching_kinds(page["rows"], file_kinds), search))
        cursor = page["next_cursor"]
        if not cursor:
            return rows, False
        if len(rows) >= MAX_SORTABLE_ROWS:
            return rows, True
    return rows, True


def _ordered_listing(principals, page_call, *, file_kinds, search, start, limit, paginated, order):
    """Answer a listing whose source has no sort of its own.

    `_core.nodes.children` takes the caller's column and sorts in SQL. The
    discovery views do not: §11.2 froze one order per view, and `shared`,
    `favourites`, and `trash` each carry theirs. The old `get_query_data`
    sorted all three by the column the toolbar names, so the argument arrives
    here still meaning something and must not be accepted and dropped -
    clicking a column header did nothing on those three lists.

    A page cannot be sorted on its own: the second page would restart the
    order. So the view is walked whole, sorted, and cut into the page the
    caller asked for. `next_start` indexes the sorted list rather than the raw
    window, which is the same contract the client already has - an opaque
    offset it hands back - and one listing never mixes the two, because the
    sort argument is what chooses this path.

    Past `MAX_SORTABLE_ROWS` the walk stops and the listing falls back to the
    view's own order. Truncating instead would drop rows the caller can see,
    and a wrong order is recoverable where a missing file is not.
    """
    rows, over_bound = _whole_view(page_call, file_kinds, search)
    if over_bound:
        return _listing(
            principals,
            page_call,
            file_kinds=file_kinds,
            search=search,
            start=start,
            limit=limit,
            paginated=paginated,
        )
    rows = _ordered(rows, *order)
    offset = int(start or 0)
    window = int(limit) if limit else (LEGACY_PAGE_SIZE if paginated else None)
    page = rows[offset:] if window is None else rows[offset : offset + window]
    shaped = _legacy_list_rows(principals, page)
    if not paginated:
        return shaped
    return {
        "rows": shaped,
        "has_next": offset + len(page) < len(rows),
        "next_start": offset + len(page),
    }


def _listing(principals, page_call, *, file_kinds, search, start, limit, paginated, order=None):
    """Answer one legacy listing, paged the way the old surface paged.

    Legacy walked raw windows until the page was full, because its permission
    filter ran after the SQL, and it published `has_next` and a raw
    `next_start`. §11.4's cursor is that same offset, encoded, so the walk is
    kept and the two envelopes translate exactly.

    Each window asks for only what the page still needs. Asking for the whole
    window every time overshoots: the surplus rows are cut to fit the page
    while `next_cursor` has already moved past them, so the client's next call
    resumes beyond rows it was never shown.

    A caller that names no `limit` and does not page gets the whole listing.
    The old `get_query_data` capped at `MAX_PAGE_SIZE` only on its paginated
    branch; the other branch ran the query with no `LIMIT` at all. The folder
    tree (`data/folderTree.js`) and the move dialog both call that way, so a
    default page here hid every child past the first hundred from the sidebar
    and from the move target list.

    `order` is set only by a caller whose source does not sort; it hands the
    whole listing to `_ordered_listing` instead of walking it a page at a time.
    """
    if order is not None:
        return _ordered_listing(
            principals,
            page_call,
            file_kinds=file_kinds,
            search=search,
            start=start,
            limit=limit,
            paginated=paginated,
            order=order,
        )
    window = int(limit) if limit else (LEGACY_PAGE_SIZE if paginated else None)
    offset = int(start or 0)
    if file_kinds or search:
        return _filtered_listing(
            principals,
            page_call,
            file_kinds=file_kinds,
            search=search,
            offset=offset,
            window=window,
            paginated=paginated,
        )
    cursor = node_core.encode_cursor(offset) if offset else None
    rows: list = []
    walked = 0
    while window is None or len(rows) < window:
        if walked >= MAX_WALK_WINDOWS:
            break
        walked += 1
        page = page_call(cursor, node_core.MAX_PAGE_SIZE if window is None else window - len(rows))
        rows.extend(page["rows"])
        cursor = page["next_cursor"]
        if not cursor:
            break
    rows = _legacy_list_rows(principals, rows if window is None else rows[:window])
    if not paginated:
        return rows
    return {
        "rows": rows,
        "has_next": bool(cursor),
        "next_start": node_core.decode_cursor(cursor) if cursor else offset + len(rows),
    }


def _filtered_listing(principals, page_call, *, file_kinds, search, offset, window, paginated):
    """Answer a listing whose `file_kinds` or `search` this module applies.

    Both were SQL predicates on the old surface, so `start` and `limit`
    counted matching rows: page two of a PDF-only folder began at the
    twenty-first PDF, not at the twenty-first child. §11.2 can spell neither,
    so the filter runs here, and a cursor built from `start` would count the
    wrong rows entirely.

    So the view is walked from the top, filtered, and cut - the same answer
    `_ordered_listing` gives to the same problem. Resuming from the caller's
    cursor instead would also read a folder one row at a time whenever the
    filter matches little, and `list.files` is `allow_guest`.
    """
    rows, over_bound = _whole_view(page_call, file_kinds, search)
    page = rows[offset:] if window is None else rows[offset : offset + window]
    shaped = _legacy_list_rows(principals, page)
    if not paginated:
        return shaped
    return {
        "rows": shaped,
        # Past the bound the walk stopped reading, so `rows` is not the whole
        # match set and its length cannot say there is nothing more.
        "has_next": offset + len(page) < len(rows) or over_bound,
        "next_start": offset + len(page),
    }


@_legacy
def files(
    entity_name: str | None = None,
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds=None,
    search: str | None = None,
    start: int = 0,
    limit: int | None = None,
    paginated: bool = False,
):
    """`list.files` -> `GET /nodes/<id>/children`, or `GET /views/search`.

    `search` made the old query tree-wide and dropped the folder filter, and
    §11.2 gave that its own view, so a search here is forwarded there. An
    unknown `order_by` still falls back to `modified` instead of refusing:
    the toolbar sends five column names and only three of them survive §11.4.

    A folder page is sorted by `children` in SQL, on the index [004] measured.
    The search view has one order of its own, so a search is sorted here.
    """
    principals = _principals()
    if search:
        return _listing(
            principals,
            lambda cursor, window: node_core.views(
                principals, "search", term=search, cursor=cursor, limit=window
            ),
            file_kinds=file_kinds,
            search=None,
            start=start,
            limit=limit,
            paginated=paginated,
            order=(order_by, bool(ascending)),
        )
    parent = entity_name or _home(principals)
    return _page_read(
        principals,
        lambda: _listing(
            principals,
            lambda cursor, window: node_core.children(
                principals,
                parent,
                cursor=cursor,
                limit=window,
                order_by=_order_column(order_by),
                ascending=bool(ascending),
            ),
            file_kinds=file_kinds,
            search=None,
            start=start,
            limit=limit,
            paginated=paginated,
        ),
    )


def _view(name, principals, *, file_kinds, search, start, limit, paginated, order=None, **filters):
    return _listing(
        principals,
        lambda cursor, window: node_core.views(principals, name, cursor=cursor, limit=window, **filters),
        file_kinds=file_kinds,
        search=search,
        start=start,
        limit=limit,
        paginated=paginated,
        order=order,
    )


@_legacy
def shared(
    shared_type: str = "with",
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds=None,
    search: str | None = None,
    start: int = 0,
    limit: int | None = None,
    paginated: bool = False,
):
    """`list.shared` -> `GET /views/shared`.

    §11.2 freezes one shared view, "shared with me", and it is top-most only.
    `shared_type="public"` named a second list that no view answers, and it is
    refused rather than answered with the first one: a caller asking which of
    their files are published must not be handed the files other people shared
    with them.
    """
    if shared_type not in ("with", None, ""):
        frappe.throw(
            _("Drive lists only the files shared with you"),
            frappe.ValidationError,
        )
    return _view(
        "shared",
        _principals(),
        file_kinds=file_kinds,
        search=search,
        start=start,
        limit=limit,
        paginated=paginated,
        order=(order_by, bool(ascending)),
    )


@_legacy
def favourites(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds=None,
    search: str | None = None,
    start: int = 0,
    limit: int | None = None,
    paginated: bool = False,
):
    """`list.favourites` -> `GET /views/favourites`.

    The view is ordered by when the mark was made. The old list was ordered by
    the column the toolbar names, and `Favourites.vue` still shows that
    control, so the page is sorted here.
    """
    return _view(
        "favourites",
        _principals(),
        file_kinds=file_kinds,
        search=search,
        start=start,
        limit=limit,
        paginated=paginated,
        order=(order_by, bool(ascending)),
    )


@_legacy
def recents(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds=None,
    search: str | None = None,
    start: int = 0,
    limit: int | None = None,
    paginated: bool = False,
):
    """`list.recents` -> `GET /views/recents`.

    `accessed` survives: it is the caller's own `Drive Recent.opened_at`, read
    through `personal_marks` with the favourite mark, so the page can still
    group rows by the day they were opened.

    The one list that keeps the view's order and drops `order_by`, because the
    old body dropped it too: `get_query_data`'s `recents_only` branch ordered
    by `last_interaction` whatever the caller named, and `Recents.vue` passes
    `show-sort="false"` so the toolbar offers no column here.
    """
    return _view(
        "recents",
        _principals(),
        file_kinds=file_kinds,
        search=search,
        start=start,
        limit=limit,
        paginated=paginated,
    )


@_legacy
def trash(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds=None,
    search: str | None = None,
    start: int = 0,
    limit: int | None = None,
    paginated: bool = False,
):
    """`list.trash` -> `GET /views/trash` on the caller's own root.

    The view needs a root and §11.2 has no route that names one, so the
    caller's personal root is used - the only trash a legacy client ever saw,
    because the old query was scoped to rows they owned.

    One visible difference, and it is the view's rule, not this shim's: §8.7
    lists trash roots, so a deleted folder is one row here where the old list
    showed the folder and everything under it.
    """
    principals = _principals()
    return _view(
        "trash",
        principals,
        file_kinds=file_kinds,
        search=search,
        start=start,
        limit=limit,
        paginated=paginated,
        order=(order_by, bool(ascending)),
        root=_home(principals),
    )
