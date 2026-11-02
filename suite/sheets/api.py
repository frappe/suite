import json

import frappe
from frappe import _

from suite import drive
from suite.sheets import drive as sheets_drive
from suite.sheets.doctype.sheet.cell_codec import cell_map as unpack_cell_map
from suite.sheets.doctype.sheet.storage import decode_sheets_data
from suite.sheets.drive import DOCTYPE, NODE_FIELD, docname_for_node
from suite.sheets.versioning import save as save_mod

MAX_TITLE_LEN = 280


# ── Presence ──────────────────────────────────────────────────────────────────


@frappe.whitelist()
def ping_presence(name: str) -> None:
    """Broadcast caller's identity to all clients watching this sheet."""
    # Refuse presence for sheets the caller can't read — keeps random
    # logged-in users from spoofing presence in private sheets they
    # shouldn't even know exist.
    frappe.has_permission("Sheet", doc=name, throw=True)
    user = frappe.session.user
    identity = _user_identity(user)
    frappe.publish_realtime(
        "sheet_presence",
        {"sheet": name, "user": user, **identity},
        doctype=DOCTYPE,
        docname=name,
        after_commit=False,
    )


# ── Real-time collaboration ───────────────────────────────────────────────────
#
# Every event here goes to the sheet's own room, `doc:Sheet/<name>`, never to
# the site room every signed-in user joins. The socket server lets a client
# into that room only after `frappe.realtime.has_permission("Sheet", name)`,
# which Drive answers from the node. That check sees the caller's session, not
# the link credentials of the page, so a reader who holds only a link does not
# receive these events.
#
# Broadcasts split by whether the event represents a mutation or pure presence:
#
#   * mutation-shaped events (`broadcast_op`, `yjs_update`, `yjs_state`) require
#     *write* permission on the sheet — a read-only sharee must not be able to
#     push ops or full-state dumps that other clients' tabs will apply locally
#     to their Yjs document, even though those changes can't be persisted
#     server-side.
#
#   * presence-shaped events (`ping_presence`, `broadcast_cursor`,
#     `yjs_awareness*`, `yjs_state_request`) require only *read* permission
#     — viewers showing their avatar / cursor is an intended Google-Docs-style
#     affordance and forging another user's position is bounded griefing, not
#     state corruption.


@frappe.whitelist()
def broadcast_op(name: str, op: str) -> None:
    """Broadcast a cell-op JSON string to all clients watching this sheet."""
    frappe.has_permission("Sheet", doc=name, ptype="write", throw=True)
    frappe.publish_realtime(
        "sheet_op",
        {"sheet": name, "user": frappe.session.user, "op": op},
        doctype=DOCTYPE,
        docname=name,
        after_commit=False,
    )


@frappe.whitelist()
def broadcast_cursor(name: str, r: int, c: int, sub_sheet: str) -> None:
    """Broadcast cursor position to all clients watching this sheet."""
    frappe.has_permission("Sheet", doc=name, throw=True)
    user = frappe.session.user
    identity = _user_identity(user)
    frappe.publish_realtime(
        "sheet_cursor",
        {"sheet": name, "user": user, **identity, "r": int(r), "c": int(c), "sub_sheet": sub_sheet},
        doctype=DOCTYPE,
        docname=name,
        after_commit=False,
    )


# ── Yjs realtime relay ────────────────────────────────────────────────────────
#
# The frontend ships a Yjs document for CRDT-safe multiplayer editing.
# These endpoints are pure relays: the server validates permission and
# republishes the (already-base64-encoded) Y.Doc updates to every client
# subscribed to the sheet's room. The server never decodes the binary
# updates — it only sees opaque base64 blobs.
#
# Three events sit on the same channel:
#   yjs_update          — incremental doc update
#   yjs_state_request   — a newly-joined peer asks for the current state
#   yjs_state           — another peer's reply carrying a full state dump
# Plus two awareness events for presence/cursors:
#   yjs_awareness       — volatile per-client state (cursor, selection, user)
#   yjs_awareness_bye   — peer is leaving, drop them from presence


@frappe.whitelist(allow_guest=True)
def yjs_relay(name: str, event: str, payload: str) -> None:
    """Relay a single Yjs realtime event to peers watching this sheet.

    `payload` is an opaque JSON string built by the client (we forward it
    verbatim so the server stays out of the CRDT protocol). The sender's
    `from` tag inside the payload is what other clients use to ignore
    their own echo.

    Mutation-shaped events (``yjs_update``, ``yjs_state``) require write
    permission so a read-only viewer can't push CRDT updates that other
    clients will apply locally. Presence and state-request events are
    read-side affordances.

    Access is Drive's answer, so a Guest holding a link may relay.
    """
    if event not in _YJS_EVENTS:
        frappe.throw(f"Unknown yjs event: {event}")
    sheets_drive.require_sheet(name, write=event in _YJS_WRITE_EVENTS)
    frappe.publish_realtime(
        event,
        {"sheet": name, "user": frappe.session.user, "payload": payload},
        doctype=DOCTYPE,
        docname=name,
        after_commit=False,
    )


_YJS_EVENTS = frozenset(
    {
        "yjs_update",
        "yjs_state_request",
        "yjs_state",
        "yjs_awareness",
        "yjs_awareness_bye",
    }
)

# Events that mutate co-editors' local Yjs document. A read-only sharee
# may still ask for state (`yjs_state_request`) and emit awareness/presence
# events, but they must not be able to inject updates or full-state dumps.
_YJS_WRITE_EVENTS = frozenset({"yjs_update", "yjs_state"})


# ── The body ──────────────────────────────────────────────────────────────────


@frappe.whitelist(allow_guest=True)
def get_sheet(name: str, compressed: int = 0) -> dict:
    # `frappe.get_doc` does NOT check read permission by itself — without
    # this guard, any logged-in user who knows a sheet id could exfiltrate
    # its contents. Drive answers with this request's link credentials, so a
    # Guest holding a link opens it too. A trashed sheet opens read-only:
    # `can_write` below is false for it.
    sheets_drive.require_sheet(name)
    doc = frappe.get_doc("Sheet", name)
    # When the client can gunzip (DecompressionStream), ship the stored envelope
    # as-is — ~1.5MB instead of the ~20MB decoded JSON for a big sheet — and let
    # it decompress. Clients without it (older Safari) get the decoded payload.
    raw = doc.sheets_data
    # The read guard above only proves the caller can *view* the sheet. Ship an
    # explicit write flag so the editor can render read-only (dim the toolbar,
    # lock the grid, hide the save path) instead of letting a viewer type into a
    # doc they can't persist and only discovering it when save_sheet throws.
    return {
        "name": doc.name,
        # Drive owns the title (§10.2); the row carries none.
        "title": doc.node_title,
        "can_write": sheets_drive.may_write_sheet(name),
        "sheets_data": raw if frappe.utils.cint(compressed) else decode_sheets_data(raw),
        # The sheet's true creator, so the Share dialog can label the owner row
        # with the real person (and "Owner (you)" only for them) instead of
        # falling back to whoever happens to have the dialog open.
        "owner": doc.owner,
        # The Drive node, so the editor can record a visit through
        # `POST /api/suite/drive/nodes/<id>/visit`.
        "node": doc.get(NODE_FIELD),
    }


@frappe.whitelist(allow_guest=True)
def save_sheet(
    title: str = "",
    sheets_data: str = "",
    name: str = "",
    ops: str = "",
    request_id: str = "",
) -> dict:
    # Delegates to versioning.save — appends a batch of ops + the implicit
    # save op atomically, advances head_seq, and takes a Drive version when
    # one is due. Returns {"name": <sheet_id>, "head_seq": <int>} so the
    # caller knows where its ops landed in the canonical order.
    #
    # `title` is accepted and ignored: the editor still sends it with every
    # save, but Drive owns the title and a rename is a Drive workflow.
    return save_mod.save_sheet(name, sheets_data, ops or None, request_id=request_id or None)


@frappe.whitelist()
def create_sheet(title: str = "", parent: str = "") -> str:
    # Create a blank sheet and return its id. Used by Drive's "New > Spreadsheet"
    # so the sheet is born inside the folder the user is looking at.
    #
    # An atomic adapter over `drive.create_document`: the node and the Sheet
    # are written together, in Drive's own savepoint, so `content.require_node`
    # never sees a Sheet with no node. Drive runs the UPLOAD check on `parent`
    # itself, so there is no separate pre-check here.
    #
    # `parent` is the Drive folder the caller is looking at. Empty means "my
    # Drive": resolve the caller's own root, provisioning it on first use.
    parent_node = parent or _home_folder()
    node = drive.create_document(parent_node, _clean_title(title), content_doctype=DOCTYPE)
    docname = docname_for_node(node)
    if not docname:
        frappe.throw(_("The new sheet could not be found"), frappe.ValidationError)
    return docname


def _home_folder() -> str:
    """The caller's own Drive root, provisioned on first use.

    A fresh user has no Personal root until something asks for one, and Guest
    and Administrator never get one.
    """
    user = frappe.session.user
    home = drive.personal_root_for(user) or drive.ensure_personal_root(user)
    if not home:
        frappe.throw(_("A Drive folder is required"), frappe.ValidationError)
    return home


@frappe.whitelist()
def record_op(
    sheet: str,
    op_type: str,
    sub_sheet: str = "",
    cell_refs: str = "",
    before: str = "",
    after: str = "",
    summary: str = "",
) -> dict:
    # Append a single op outside the save path. Used by collaboration
    # broadcasts and any other UI affordance that wants to log an action
    # without forcing a save.
    new_seq = save_mod.append_op(
        sheet,
        {
            "op_type": op_type,
            "sub_sheet": sub_sheet or None,
            "cell_refs": cell_refs or None,
            "before": before or None,
            "after": after or None,
            "summary": summary,
        },
    )
    return {"seq": new_seq}


# ── AI Assist ───────────────────────────────────────────────────────────────
#
# Configuration lives in the "Sheets AI Settings" singleton but is driven
# entirely from the in-app settings panel — never the desk form. The key is a
# Password field (encrypted at rest) and is NEVER returned to the browser:
# `get_ai_settings` reports only whether a key is on file, and the cleartext is
# read server-side via `get_password` only at the moment of the Anthropic call.

AI_SETTINGS = "Sheets AI Settings"
DEFAULT_AI_MODEL = "claude-opus-4-8"


def _ai_key(doc) -> str:
    """Return the decrypted API key, or '' if none is stored.

    `get_password` raises when the field is empty unless `raise_exception` is
    off — coerce the absent case to '' so callers can treat it as a plain bool.
    """
    return doc.get_password("api_key", raise_exception=False) or ""


@frappe.whitelist()
def get_ai_settings() -> dict:
    # Read is ungated: the response only reveals whether AI is available
    # (enabled + a key is configured), never the key itself, so any logged-in
    # user can decide whether to show the "Ask" entry point.
    doc = frappe.get_cached_doc(AI_SETTINGS)
    return {
        "enabled": bool(doc.enabled),
        "model": doc.model or DEFAULT_AI_MODEL,
        "keyIsSet": bool(_ai_key(doc)),
    }


@frappe.whitelist()
def save_ai_settings(api_key: str = "", enabled: int = 0, model: str = "") -> dict:
    # Write is gated to System Manager — this is org-level config, not per-sheet.
    if "System Manager" not in frappe.get_roles():
        frappe.throw("Not permitted to change AI settings", frappe.PermissionError)
    doc = frappe.get_doc(AI_SETTINGS)
    doc.enabled = 1 if int(enabled or 0) else 0
    if model:
        doc.model = model
    # An empty api_key means "leave the existing key untouched" — the panel
    # never receives the real key back, so it submits "" unless the admin
    # deliberately types a new one.
    if api_key:
        doc.api_key = api_key
    doc.save(ignore_permissions=True)
    frappe.clear_document_cache(AI_SETTINGS, AI_SETTINGS)
    return get_ai_settings()


MAX_PROMPT_LEN = 2000


@frappe.whitelist()
def ai_assist(name: str, prompt: str, selection: str) -> dict:
    """Turn a plain-language request into a validated spreadsheet action plan.

    `selection` is a JSON string describing the active selection
    ({sheet, r0, c0, r1, c1, active}). The sheet is decoded server-side, a
    compact context is assembled, and the model is asked for actions — which
    are validated here before returning. We do NOT mutate the sheet: the
    frontend applies the actions through the engine so they join the existing
    undo / op-log / autosave pipeline.
    """
    # AI mutates the grid → require write permission, matching save/record_op.
    frappe.has_permission("Sheet", doc=name, ptype="write", throw=True)

    prompt = (prompt or "").strip()
    if not prompt:
        frappe.throw("Type what you'd like to do first.")
    if len(prompt) > MAX_PROMPT_LEN:
        frappe.throw("That request is too long.")

    cfg = frappe.get_cached_doc(AI_SETTINGS)
    if not cfg.enabled:
        frappe.throw("AI Assist isn't enabled for this site.")
    model = cfg.model or DEFAULT_AI_MODEL

    sel = frappe.parse_json(selection) if selection else {}
    if not isinstance(sel, dict):
        sel = {}
    sheet_name = sel.get("sheet") or "Sheet1"

    data = json.loads(decode_sheets_data(frappe.get_doc("Sheet", name).sheets_data) or "{}")
    cell_map = unpack_cell_map((data or {}).get("sheet") or {}, sheet_name)

    from suite.sheets.ai import context as ai_context
    from suite.sheets.ai import heuristics as ai_heuristics
    from suite.sheets.ai import validate as ai_validate

    ctx = ai_context.build_context(cell_map, sheet_name, sel)

    # Heuristic-first cascade: common, unambiguous asks resolve locally —
    # instant, free, deterministic — and only fall through to the model when
    # they can't. `mock`/`demo` is the keyless mode: heuristic only, no call.
    raw = ai_heuristics.resolve(prompt, ctx, sel)
    source = "heuristic"
    if raw is None:
        if model.strip().lower() in ("mock", "demo"):
            raw = [{"type": "answer", "text": _DEMO_HINT}]
            source = "demo"
        else:
            key = _ai_key(cfg)
            if not key:
                frappe.throw("No Anthropic API key is configured.")
            from suite.sheets.ai import client as ai_client

            raw = ai_client.generate_actions(prompt, ctx, key, model)
            source = "model"

    return {"actions": ai_validate.clean_actions(raw), "model": model, "source": source}


_DEMO_HINT = (
    "Local demo (no API key). I can do: sum / average / count / min / max / median over a "
    "selection, running totals and percent-of-total down a column, and text transforms "
    "(uppercase, lowercase, proper case, trim, length, email domain, first/last name). "
    "For anything beyond that, add an Anthropic API key in AI settings."
)


# ── internal helpers ──────────────────────────────────────────────────────────


def _user_identity(user: str) -> dict:
    """Return full_name, initials, and user_image for the given user."""
    full_name = frappe.db.get_value("User", user, "full_name") or user
    user_image = frappe.db.get_value("User", user, "user_image") or ""
    parts = full_name.split()
    initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
    return {"full_name": full_name, "initials": initials, "user_image": user_image}


def _clean_title(title: str) -> str:
    title = (title or "").strip() or "Untitled Spreadsheet"
    if len(title) > MAX_TITLE_LEN:
        title = title[:MAX_TITLE_LEN]
    return title
