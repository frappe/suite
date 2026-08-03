import json

import frappe

from suite.sheets.collab import bump_room_epoch
from suite.sheets.doctype.sheet.cell_codec import cell_map as unpack_cell_map
from suite.sheets.doctype.sheet.storage import decode_sheets_data
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
		after_commit=False,
	)


# ── Real-time collaboration ───────────────────────────────────────────────────
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


@frappe.whitelist()
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
	"""
	if event not in _YJS_EVENTS:
		frappe.throw(f"Unknown yjs event: {event}")
	ptype = "write" if event in _YJS_WRITE_EVENTS else "read"
	frappe.has_permission("Sheet", doc=name, ptype=ptype, throw=True)
	frappe.publish_realtime(
		event,
		{"sheet": name, "user": frappe.session.user, "payload": payload},
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


# ── Sharing ───────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_sheet_shares(name: str) -> list:
	"""Return users who have explicit share access to this sheet."""
	frappe.has_permission("Sheet", doc=name, throw=True)
	rows = frappe.get_all(
		"DocShare",
		filters={"share_doctype": "Sheet", "share_name": name},
		fields=["user", "read", "write", "share", "everyone"],
	)
	for row in rows:
		if row.get("everyone"):
			row["full_name"] = ""
			row["initials"] = ""
			row["user_image"] = ""
			continue
		identity = _user_identity(row["user"])
		row.update(identity)
		row["user_image"] = frappe.db.get_value("User", row["user"], "user_image") or ""
	return rows


@frappe.whitelist()
def share_sheet(name: str, user: str = "", write: int = 0, everyone: int = 0) -> dict:
	# `ptype="share"` — only users who themselves hold the share right
	# may grant access to others. Default `read` was too permissive
	# (any viewer could re-share a sheet to anyone).
	frappe.has_permission("Sheet", doc=name, ptype="share", throw=True)
	if int(everyone or 0):
		# "Accessible to all" → single DocShare with everyone=1, user=NULL.
		# notify=False because there's no individual to email.
		frappe.share.add(
			"Sheet",
			name,
			user=None,
			write=int(write),
			share=0,
			everyone=1,
			notify=False,
		)
		return {"status": "ok"}
	# Reject disabled users (and non-existent ones) up front — silently
	# carrying a share to an account that's been turned off lets it light
	# up again the moment the account is re-enabled, which is rarely what
	# the granter expected.
	enabled = frappe.db.get_value("User", user, "enabled")
	if enabled is None:
		frappe.throw(f"User {user} not found")
	if not enabled:
		frappe.throw(f"User {user} is disabled")
	# Pass notify=False to Frappe's generic share path — the default
	# notification renders as "Asif shared a document Sheet 'Title' with
	# you" and the click destination is the Desk doctype form, not our
	# SPA. We dispatch our own branded notification below.
	# A write→read downgrade revokes edit rights, so it must rotate the collab
	# room key exactly as unsharing does — otherwise the demoted user keeps a
	# working key and can still transmit into the live session. Read the old
	# value before `share.add` overwrites the row.
	was_editor = bool(
		frappe.db.get_value(
			"DocShare",
			{"share_doctype": "Sheet", "share_name": name, "user": user},
			"write",
		)
	)
	frappe.share.add("Sheet", name, user, write=int(write), share=0, notify=False)
	if was_editor and not int(write):
		bump_room_epoch(name)
	_notify_sheet_shared(name, user, can_edit=bool(int(write)))
	return {"status": "ok"}


def _notify_sheet_shared(sheet_name: str, recipient: str, can_edit: bool) -> None:
	"""Send the recipient a branded share notification.

	Two surfaces:

	  * **In-app notification** (Notification Log) — shows in the bell
	    icon. Subject is plain text; clicking lands on /sheets?id=…
	    instead of /app/sheet/<hash> (the Desk form view of the doctype,
	    which is a raw JSON blob).
	  * **Email** — only if the site has SMTP configured. `now=False`
	    enqueues it so the share API stays fast and a flaky mailer
	    doesn't break the user's flow. The email body links to the SPA
	    URL using `frappe.utils.get_url` so it works in dev (localhost)
	    and prod (https) without us hard-coding anything.

	Anything that throws below is swallowed: a notification failure must
	not roll back the DocShare row — the access grant has already
	committed and the recipient now has access, the email is sugar.
	"""
	try:
		share_doc = frappe.get_doc("Sheet", sheet_name)
		title = share_doc.title or "Untitled Spreadsheet"
		sharer = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
		role = "edit" if can_edit else "view"
		# Link points at the SPA, not the Desk. `get_url` respects the
		# site's `host_name`, so this works behind reverse proxies too.
		link = f"{frappe.utils.get_url()}/sheets?id={sheet_name}"
		subject = f"{sharer} shared a sheet with you"
		# Frappe's Notification Log surfaces in the bell-icon dropdown.
		frappe.get_doc(
			{
				"doctype": "Notification Log",
				"subject": (
					f"{frappe.utils.escape_html(sharer)} shared the sheet "
					f"<b>{frappe.utils.escape_html(title)}</b> with you "
					f"(can {role})"
				),
				"for_user": recipient,
				"type": "Share",
				"document_type": "Sheet",
				"document_name": sheet_name,
				"from_user": frappe.session.user,
				"email_content": (
					f"<p>{frappe.utils.escape_html(sharer)} shared the sheet "
					f"<b>{frappe.utils.escape_html(title)}</b> with you. "
					f"You can {role} it.</p>"
					f"<p><a href='{link}'>Open sheet</a></p>"
				),
			}
		).insert(ignore_permissions=True)
		# Best-effort email — silently skipped if the site has no mailer.
		frappe.sendmail(
			recipients=[recipient],
			subject=subject,
			message=(
				f"<p>{frappe.utils.escape_html(sharer)} shared the sheet "
				f"<b>{frappe.utils.escape_html(title)}</b> with you. "
				f"You can {role} it.</p>"
				f"<p><a href='{link}'>Open the sheet</a></p>"
			),
			reference_doctype="Sheet",
			reference_name=sheet_name,
			now=False,
		)
	except Exception:
		# Don't let notification failures roll back the share — the
		# DocShare has already committed and the access grant stands.
		frappe.log_error(title="Sheet share notification failed")


@frappe.whitelist()
def unshare_sheet(name: str, user: str = "", everyone: int = 0) -> dict:
	frappe.has_permission("Sheet", doc=name, ptype="share", throw=True)
	if int(everyone or 0):
		# frappe.share.remove() looks up by user; for the everyone row we
		# locate the DocShare directly and delete it.
		share_name = frappe.db.get_value(
			"DocShare",
			{"share_doctype": "Sheet", "share_name": name, "everyone": 1},
		)
		if share_name:
			frappe.delete_doc("DocShare", share_name, ignore_permissions=True)
			# Losing access must also lose the collab room key — see
			# `sheets.collab.bump_room_epoch`.
			bump_room_epoch(name)
		return {"status": "ok"}
	frappe.share.remove("Sheet", name, user)
	bump_room_epoch(name)
	return {"status": "ok"}


# Caller's `order_by` is resolved through this dict — a key lookup, never
# string interpolation — so arbitrary SQL can't reach the ORDER BY clause.
# The direction is likewise clamped to a literal "asc"/"desc" in
# `_list_sheets_order_by`, so neither the column nor the direction is ever
# free text.
_LIST_SHEETS_SORT_FIELDS = {
	"modified": "`tabSheet`.`modified`",
	"title": "`tabSheet`.`title`",
	"owner": "`tabSheet`.`owner`",
}


def _list_sheets_order_by(order_by: str, sort_dir: str) -> str:
	field = _LIST_SHEETS_SORT_FIELDS.get(order_by) or _LIST_SHEETS_SORT_FIELDS["modified"]
	direction = "asc" if str(sort_dir).lower() == "asc" else "desc"
	order = f"{field} {direction}"
	# Owner is a low-cardinality column, so a secondary `modified desc` keeps
	# rows within one owner in a stable, useful order regardless of direction.
	if order_by == "owner":
		order += ", `tabSheet`.`modified` desc"
	return order


@frappe.whitelist()
def list_sheets(
	start: int = 0,
	limit: int = 50,
	search: str = "",
	owner_filter: str = "all",
	order_by: str = "modified",
	sort_dir: str = "desc",
) -> dict:
	# Frappe's get_list applies the permission query, so the base result is
	# sheets the session user owns plus those shared via DocShare (per-user
	# or everyone=1). `owner_filter` narrows within that visible set:
	# "mine" / "shared" split on ownership, anything else means "all".
	# `is_owner` is computed here because the SPA template doesn't inject
	# window.frappe.session — the client can't know who it is on its own.
	me = frappe.session.user
	start = max(frappe.utils.cint(start), 0)
	limit = min(max(frappe.utils.cint(limit) or 50, 1), 100)

	filters = {"trashed": 0}
	search = (search or "").strip()
	if search:
		filters["title"] = ["like", f"%{search}%"]
	if owner_filter == "mine":
		filters["owner"] = me
	elif owner_filter == "shared":
		filters["owner"] = ["!=", me]

	rows = frappe.get_list(
		"Sheet",
		filters=filters,
		fields=["name", "title", "modified", "owner"],
		order_by=_list_sheets_order_by(order_by, sort_dir),
		limit_start=start,
		limit_page_length=limit,
	)
	for r in rows:
		r["is_owner"] = r["owner"] == me

	# Permission-aware total for the same filters — an aggregate get_list
	# keeps the owner + DocShare conditions that frappe.db.count would drop.
	# Dict field syntax: newer Frappe rejects string SQL functions in SELECT.
	total = frappe.get_list(
		"Sheet",
		filters=filters,
		fields=[{"COUNT": "*", "as": "total"}],
	)[0]["total"]
	# `now` shares the naive server-local frame of `modified`, so the client
	# can bucket rows by recency without mixing server and client clocks.
	return {"sheets": rows, "total": total, "now": str(frappe.utils.now())}


@frappe.whitelist()
def get_sheet(name: str, compressed: int = 0) -> dict:
	# `frappe.get_doc` does NOT check read permission by itself — without
	# this guard, any logged-in user who knows a sheet id could exfiltrate
	# its contents.
	frappe.has_permission("Sheet", doc=name, throw=True)
	doc = frappe.get_doc("Sheet", name)
	# A trashed sheet must not open from a bookmarked/shared link — it's
	# "deleted" as far as the app is concerned until restored.
	if doc.trashed:
		frappe.throw("This sheet is in the trash.", frappe.DoesNotExistError)
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
		"title": doc.title,
		"can_write": bool(frappe.has_permission("Sheet", doc=name, ptype="write", throw=False)),
		"sheets_data": raw if frappe.utils.cint(compressed) else decode_sheets_data(raw),
		# The sheet's true creator, so the Share dialog can label the owner row
		# with the real person (and "Owner (you)" only for them) instead of
		# falling back to whoever happens to have the dialog open.
		"owner": doc.owner,
	}


@frappe.whitelist()
def save_sheet(
	title: str,
	sheets_data: str,
	name: str = "",
	ops: str = "",
) -> dict:
	# Delegates to versioning.save — appends a batch of ops + the implicit
	# save op atomically, advances head_seq, enqueues an async snapshot.
	# Returns {"name": <sheet_id>, "head_seq": <int>} so the caller knows
	# where its ops landed in the canonical order.
	return save_mod.save_sheet(title, sheets_data, name or None, ops or None)


@frappe.whitelist()
def create_sheet(title: str = "", parent: str = "") -> str:
	# Create a blank sheet and return its id. Used by Drive's "New > Spreadsheet"
	# so the sheet is born inside the folder the user is looking at — `parent`
	# is the Drive folder its backing File should land in (validated for upload
	# access here, then threaded to Sheet.after_insert). Mirrors Writer's
	# create_document. "{}" is a valid empty workbook — the editor's loader
	# falls back to a fresh Sheet1 when the packed payload is absent.
	if parent:
		from suite.drive.api.permissions import user_has_permission

		if not user_has_permission(parent, "upload"):
			frappe.throw(
				"Cannot access folder due to insufficient permissions",
				frappe.PermissionError,
			)
	result = save_mod.save_sheet(title or "Untitled Spreadsheet", "{}", name=None, parent=parent or None)
	return result["name"]


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


@frappe.whitelist()
def delete_sheet(name: str) -> str:
	# Soft delete: flag the sheet as trashed instead of destroying it, so the
	# owner can restore it within the retention window. The `delete` ptype gate
	# is owner-only (the "All" role's delete perm is `if_owner`), so a shared
	# collaborator can't trash someone else's sheet. Versioning tables are left
	# fully intact — a restore is a perfect restore, not a last-save recovery.
	# The nightly purge (suite.sheets.trash.purge_trashed_sheets) does the real erase.
	frappe.has_permission("Sheet", doc=name, ptype="delete", throw=True)
	# Flip the flag through the ORM so on_update fires and Drive drops the backing
	# File from the listing in lockstep (see hooks.py) — no Sheets-specific Drive
	# call, same front door as a Writer/Slides delete.
	doc = frappe.get_doc("Sheet", name)
	doc.trashed = 1
	doc.trashed_on = frappe.utils.now_datetime()
	doc.trashed_by = frappe.session.user
	doc.save()
	return "ok"


@frappe.whitelist()
def restore_sheet(name: str) -> str:
	# Same owner-only gate as trashing — restore is the inverse of delete.
	frappe.has_permission("Sheet", doc=name, ptype="delete", throw=True)
	# Inverse of trashing: clear the flag through the ORM so on_update returns the
	# backing File to the Drive listing.
	doc = frappe.get_doc("Sheet", name)
	doc.trashed = 0
	doc.trashed_on = None
	doc.trashed_by = None
	doc.save()
	return "ok"


@frappe.whitelist()
def delete_sheet_permanent(name: str) -> str:
	# Irreversible "delete forever" from the trash. Owner-only, same as trashing.
	# The cascade lives in suite.sheets.trash so it stays in lockstep with the purge.
	frappe.has_permission("Sheet", doc=name, ptype="delete", throw=True)
	# Only ever fire from the trash flow: a direct call on a live sheet must not
	# skip the recovery window and destroy it in one shot.
	if not frappe.db.get_value("Sheet", name, "trashed"):
		frappe.throw("Only sheets in the trash can be permanently deleted.")
	from suite.sheets.trash import hard_delete_sheet

	hard_delete_sheet(name)
	return "ok"


@frappe.whitelist()
def list_trash() -> dict:
	# Trash is owner-scoped: only the owner can trash/restore, so a shared
	# collaborator has no business seeing another user's trash. Filter to the
	# caller's own trashed sheets explicitly rather than leaning on the share
	# grant that list_sheets uses. `retention_days` rides along so the UI can
	# state the exact purge window instead of assuming the default.
	from suite.sheets.trash import retention_days

	sheets = frappe.get_list(
		"Sheet",
		filters={"trashed": 1, "owner": frappe.session.user},
		fields=["name", "title", "trashed_on"],
		order_by="trashed_on desc",
		limit=100,
	)
	return {"sheets": sheets, "retention_days": retention_days()}


@frappe.whitelist()
def rename_sheet(name: str, title: str) -> str:
	# Explicit gate up-front so the failure mode is the same as the rest of
	# this module — `doc.save()` would ultimately enforce write perm too,
	# but defence-in-depth keeps the surface uniform if the controller ever
	# changes.
	frappe.has_permission("Sheet", doc=name, ptype="write", throw=True)
	title = _clean_title(title)
	if not title:
		frappe.throw("Title is required")
	doc = frappe.get_doc("Sheet", name)
	doc.title = title
	doc.save()
	return doc.name


@frappe.whitelist()
def duplicate_sheet(name: str) -> str:
	# Route through the versioning save flow so the copy gets its own op-log
	# seq, head pointer, and async snapshot — keeps the architecture's single
	# write path intact and doesn't leak shared state with the source. The
	# new save flow returns {"name": ..., "head_seq": ...}; the caller (the
	# Home page) only needs the new sheet name, so we unwrap here.
	# Read permission on the SOURCE is required — without this, anyone who
	# knows a sheet id could clone its contents into a sheet they own.
	frappe.has_permission("Sheet", doc=name, throw=True)
	src = frappe.get_doc("Sheet", name)
	plain = decode_sheets_data(src.sheets_data)
	result = save_mod.save_sheet(f"{src.title} (copy)", plain, name=None)
	return result["name"] if isinstance(result, dict) else result


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
