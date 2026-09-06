"""Frappe endpoints that back the Hocuspocus collab server.

Three responsibilities, split by who calls them and how they authenticate:

  1. ``check_collab_access`` — called by Hocuspocus' ``onAuthenticate`` hook
     with the user's session cookie and link credentials forwarded from the
     browser. Returns the read/write flags + identity bundle (name, initials,
     avatar) the server attaches to the connection.

  2. ``load_collab_state`` / ``persist_collab_state`` — server-to-server
     calls from the Node process to read/write the persisted Y.Doc binary
     in ``Sheet Collab State``. No browser cookie is available on these,
     so they authenticate with a shared secret (``collab_server_secret``
     in ``site_config.json``) sent in the ``X-Collab-Secret`` header.

The Y.Doc binary itself is opaque to Frappe — we move base64 blobs in
and out of MariaDB and never decode them.

Bootstrap is *not* an endpoint: the first browser to open a sheet whose
Y.Doc is empty hydrates it from the ``sheets_data`` blob it already
loaded for the editor, then sets a ``bootstrapped`` flag inside the
Y.Doc so concurrent first-openers don't double-hydrate. Keeps the
collab server schema-agnostic.

## A linked sheet answers from Drive (§6.7)

``check_collab_access`` reads the sheet's ``node`` column and answers on one of
two sides, the same split every other staged Sheets guard makes:

  node set    `Drive Grant` decides, through one point check. EDIT and above
              writes, READ or COMMENT connects read-only, anything lower is
              refused. The caller's link credentials arrive in the request's
              ``X-Drive-Links`` header, which the collab server forwards from
              the browser, so `suite.drive` builds the same principals it would
              for any other request and the 20-item limit is enforced in the
              one place that owns it
              (`suite.drive._core.principals.parse_link_header`).
  no node     A legacy row Build has not linked. Unchanged Frappe permission
              behaviour, and a Guest is still refused: a legacy sheet has no
              link grant to hold.

Access is not decided once. Every answer carries ``recheckSeconds``, and the
collab server rechecks each live connection on that cadence: a revoked or
expired grant closes the socket, and a downgrade from EDIT turns the connection
read-only in place (§6.7).

A Guest gets a server-controlled identity. Nothing the browser sends names the
person on the wire, because a link grant proves a capability and not an
identity: a Guest is "Guest", with no email, no avatar, and no display name a
caller can choose. The collab server tells two Guests apart by the connection
it made, never by anything either of them said.
"""

from __future__ import annotations

import hmac

import frappe

from suite import drive

# Header the collab server sends with every server-to-server call.
_COLLAB_SECRET_HEADER = "X-Collab-Secret"

# §6.7: how often the collab server re-asks this endpoint for a live
# connection. It travels in every answer so the cadence has one definition and
# the server never hard-codes it.
RECHECK_SECONDS = 5 * 60

# What a Guest is called on the wire. Server-controlled, so a link holder
# cannot present themselves as somebody else.
GUEST_LABEL = "Guest"


# ── Browser-side: auth hook called by Hocuspocus ──────────────────────────────


@frappe.whitelist(allow_guest=True)
def check_collab_access(name: str) -> dict:
    """Return the caller's read/write capability + identity for a given sheet.

    Hocuspocus' ``onAuthenticate`` calls this with the user's session forwarded,
    and calls it again every ``recheckSeconds`` for as long as the connection
    lives. The answer decides whether the websocket is accepted, whether it may
    push updates, and whether it stays open.

    Read access without write means "viewer" — the connection still receives
    updates and emits awareness (cursor, presence), but writes are dropped
    at the server before fan-out.

    ``allow_guest=True`` is what lets a link grant work. A Guest with no link
    credential still gets nothing: `Drive Grant` is the only thing that can
    answer for them, and a legacy sheet has none.
    """
    node = frappe.db.get_value("Sheet", name, "node")
    if node:
        return _drive_access(node)
    return _legacy_access(name)


def _drive_access(node: str) -> dict:
    """Answer one linked sheet from `Drive Grant` alone (§1, §6.7).

    Two point checks, not one: the ladder decides the capability, so EDIT is
    asked separately from READ. Each is one indexed grant query over the node's
    materialised ancestry, which is what makes a five-minute recheck per live
    connection affordable.

    A refusal is returned, not raised. The collab server reads ``canRead: False``
    as a clean close, and the reason tells a revoked grant from an expired link
    so the browser can say which happened. `DriveNotFound` is Drive masking a
    node below READ (§5.4); it is answered exactly like a refusal, so the reply
    never says whether the sheet exists.
    """
    try:
        drive.check(node, drive.READ)
    except drive.DriveError as refusal:
        return _refused(type(refusal).__name__)
    can_write = _may_edit(node)
    return _granted(frappe.session.user, can_write)


def _may_edit(node: str) -> bool:
    """True when the caller holds EDIT or above at `node`.

    UPLOAD sits between COMMENT and EDIT on the ladder and does not write a
    body: it places new nodes. So the write flag asks for EDIT and nothing
    lower answers it.
    """
    try:
        drive.check(node, drive.EDIT)
    except drive.DriveError:
        return False
    return True


def _legacy_access(name: str) -> dict:
    """Answer one sheet Build has not linked, exactly as before ticket 19."""
    if frappe.session.user == "Guest":
        frappe.throw("Login required", frappe.AuthenticationError)

    can_read = bool(frappe.has_permission("Sheet", doc=name, ptype="read", throw=False))
    if not can_read:
        # Don't 403 here — the collab server treats {canRead: False} as a
        # clean refusal and closes the socket. Returning structured data
        # is easier to surface to the client than parsing exception text.
        return _refused("DriveForbidden")

    can_write = bool(frappe.has_permission("Sheet", doc=name, ptype="write", throw=False))
    return _granted(frappe.session.user, can_write)


def _refused(reason: str) -> dict:
    return {
        "canRead": False,
        "canWrite": False,
        "reason": reason,
        "recheckSeconds": RECHECK_SECONDS,
    }


def _granted(user: str, can_write: bool) -> dict:
    identity = _identity(user)
    return {
        "canRead": True,
        "canWrite": can_write,
        "recheckSeconds": RECHECK_SECONDS,
        "user": user,
        **identity,
    }


def _identity(user: str) -> dict:
    """Name the connected caller, on the server's terms.

    A Guest holds a link, and a link proves a capability rather than an
    identity, so there is nothing about them to look up and nothing they may
    tell us. They are "Guest" with no avatar. The collab server is what tells
    two of them apart, from the connection it made.
    """
    if user == "Guest":
        return {
            "isGuest": True,
            "fullName": GUEST_LABEL,
            "initials": GUEST_LABEL[0],
            "userImage": "",
        }
    identity = _user_identity(user)
    return {
        "isGuest": False,
        "fullName": identity["full_name"],
        "initials": identity["initials"],
        "userImage": identity["user_image"],
    }


# ── Server-to-server: persistence endpoints ───────────────────────────────────


@frappe.whitelist(allow_guest=True)
def load_collab_state(name: str) -> dict:
    """Return the persisted Y.Doc binary for ``name``, or ``None``.

    ``allow_guest=True`` because this is invoked from the Hocuspocus process
    without a user session — auth is via the shared ``collab_server_secret``
    checked below. The endpoint never accepts cookie-only callers.
    """
    _require_collab_secret()

    if not frappe.db.exists("Sheet Collab State", name):
        return {"sheet": name, "ydoc_state": None, "byte_size": 0}

    # Direct DB read — the doctype has System-Manager-only perms, but the
    # secret check above is the gate that matters here.
    row = (
        frappe.db.get_value(
            "Sheet Collab State",
            name,
            ("ydoc_state", "byte_size"),
            as_dict=True,
        )
        or {}
    )
    return {
        "sheet": name,
        "ydoc_state": row.get("ydoc_state"),
        "byte_size": int(row.get("byte_size") or 0),
    }


@frappe.whitelist(allow_guest=True)
def persist_collab_state(name: str, ydoc_state: str, byte_size: int = 0) -> dict:
    """Upsert the Y.Doc binary for ``name``.

    The collab server debounces this — expect roughly one call every few
    seconds of active editing per sheet, plus one on last-client-disconnect.

    The ``Sheet`` must exist (it always does — sheets are created via the
    save path before any collab session opens against them). We don't
    create the parent here.
    """
    _require_collab_secret()

    if not frappe.db.exists("Sheet", name):
        frappe.throw(f"Sheet {name!r} does not exist", frappe.DoesNotExistError)

    byte_size = int(byte_size or 0)
    now = frappe.utils.now()

    if frappe.db.exists("Sheet Collab State", name):
        # Direct UPDATE — avoids loading the doc + permission noise on a
        # hot persistence path. The doctype has only data fields, no
        # Document hooks that need to run.
        frappe.db.set_value(
            "Sheet Collab State",
            name,
            {
                "ydoc_state": ydoc_state,
                "byte_size": byte_size,
                "last_persisted_at": now,
            },
            update_modified=True,
        )
    else:
        doc = frappe.new_doc("Sheet Collab State")
        doc.sheet = name
        doc.ydoc_state = ydoc_state
        doc.byte_size = byte_size
        doc.last_persisted_at = now
        doc.insert(ignore_permissions=True)

    return {"sheet": name, "byte_size": byte_size, "persisted_at": now}


# ── helpers ───────────────────────────────────────────────────────────────────


def _require_collab_secret() -> None:
    """Reject the call unless the request carries the configured shared secret.

    Misconfiguration (no secret in ``site_config.json``) is a deploy bug, not
    a runtime accident — raise loudly so it surfaces in the collab server
    logs on first boot rather than silently allowing unauthenticated writes.
    """
    expected = (frappe.conf.get("collab_server_secret") or "").strip()
    if not expected:
        frappe.throw(
            "Collab server secret is not configured (set `collab_server_secret` in site_config.json)",
            frappe.AuthenticationError,
        )
    sent = (frappe.get_request_header(_COLLAB_SECRET_HEADER) or "").strip()
    # Constant-time compare — secrets are short enough that timing attacks
    # are vanishingly improbable, but hmac.compare_digest is the right
    # habit anyway.
    if not sent or not hmac.compare_digest(expected, sent):
        frappe.throw("Invalid collab server credentials", frappe.AuthenticationError)


def _user_identity(user: str) -> dict:
    """Return full_name, initials, and user_image — mirrors api._user_identity."""
    full_name = frappe.db.get_value("User", user, "full_name") or user
    user_image = frappe.db.get_value("User", user, "user_image") or ""
    parts = full_name.split()
    initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
    return {"full_name": full_name, "initials": initials, "user_image": user_image}
