import frappe
from frappe import _

from suite import drive
from suite.content import log
from suite.content.conversions import conversion_status
from suite.sheets import content as sheets_content
from suite.sheets import drive as sheets_drive
from suite.sheets.doctype.sheet.storage import decode_sheets_data
from suite.sheets.drive import DOCTYPE, NODE_FIELD, docname_for_node

MAX_TITLE_LEN = 280


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
    # The old body, read-only: the editor saves only through the live room
    # (`suite.sheets.content`), and shows this to a guest on a share link or
    # while the sheet waits for its conversion. `can_write` says what the
    # caller may do once the room opens it.
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
def get_conversion(name: str) -> dict:
    """Answer whether the sheet is converted, waits for its conversion, or was refused; the reason for System Managers."""
    sheets_drive.require_sheet(name)
    node = frappe.db.get_value(DOCTYPE, name, NODE_FIELD)
    if log.find(sheets_content.APP, node):
        return {"state": "converted"}

    status = conversion_status(sheets_content.APP, node)
    answer = {"state": status["state"]}
    if "reason" in status:
        answer["reason"] = status["reason"]

    return answer


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
# The context cells the editor sends: its top-left block, one row and column
# past what `ai.context` samples, so it can say the view is partial
MAX_CONTEXT_CELLS = 2000
MAX_CONTEXT_VALUE_LEN = 500


@frappe.whitelist()
def ai_assist(name: str, prompt: str, selection: str, cells: str = "") -> dict:
    """Turn a plain-language request into a validated spreadsheet action plan.

    `selection` is a JSON string describing the active selection
    ({sheet, r0, c0, r1, c1, active}). `cells` is a JSON object of the
    selection's sheet as the editor shows it ({cellId: value}): the live room
    holds the sheet, and only the browser has formula results, so the server
    never reads `sheets_data` for it. A compact context is assembled from it,
    and the model is asked for actions — which are validated here before
    returning. We do NOT mutate the sheet: the
    frontend applies the actions through the engine, as one undoable edit
    the live room saves.
    """
    # AI mutates the grid → require write permission.
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

    cell_map = _context_cells(cells)

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


def _context_cells(cells: str) -> dict[str, str]:
    """The editor's context cells, as {cellId: text}, refused when they aren't that shape."""
    try:
        parsed = frappe.parse_json(cells) if cells else {}
    except ValueError:
        parsed = None
    if not isinstance(parsed, dict) or len(parsed) > MAX_CONTEXT_CELLS:
        frappe.throw(_("The sheet's cells could not be read."))
    return {
        str(cid): str(value)[:MAX_CONTEXT_VALUE_LEN]
        for cid, value in parsed.items()
        if isinstance(value, str | int | float) and value != ""
    }


def _clean_title(title: str) -> str:
    title = (title or "").strip() or "Untitled Spreadsheet"
    if len(title) > MAX_TITLE_LEN:
        title = title[:MAX_TITLE_LEN]
    return title
