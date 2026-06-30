import json

import frappe

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
		{"sheet": name, "user": user, **identity,
		 "r": int(r), "c": int(c), "sub_sheet": sub_sheet},
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


_YJS_EVENTS = frozenset({
	"yjs_update",
	"yjs_state_request",
	"yjs_state",
	"yjs_awareness",
	"yjs_awareness_bye",
})

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
			"Sheet", name, user=None, write=int(write), share=0,
			everyone=1, notify=False,
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
	frappe.share.add("Sheet", name, user, write=int(write), share=0, notify=False)
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
		frappe.get_doc({
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
		}).insert(ignore_permissions=True)
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
		return {"status": "ok"}
	frappe.share.remove("Sheet", name, user)
	return {"status": "ok"}


@frappe.whitelist()
def list_sheets() -> list:
	# No explicit owner filter — Frappe's get_list already applies the
	# permission query, so this returns sheets the session user owns plus
	# those reaching them via DocShare (per-user or everyone=1). The
	# `owner` field is included so the UI can mark non-owned rows as
	# "Shared with you", and `is_owner` is computed here because the SPA
	# template doesn't inject window.frappe.session — the client has no
	# reliable way to know who it is.
	me = frappe.session.user
	rows = frappe.get_list(
		"Sheet",
		fields=["name", "title", "modified", "owner"],
		order_by="modified desc",
		limit=100,
	)
	for r in rows:
		r["is_owner"] = (r["owner"] == me)
	return rows


@frappe.whitelist()
def get_sheet(name: str, compressed: int = 0) -> dict:
	# `frappe.get_doc` does NOT check read permission by itself — without
	# this guard, any logged-in user who knows a sheet id could exfiltrate
	# its contents.
	frappe.has_permission("Sheet", doc=name, throw=True)
	doc = frappe.get_doc("Sheet", name)
	# When the client can gunzip (DecompressionStream), ship the stored envelope
	# as-is — ~1.5MB instead of the ~20MB decoded JSON for a big sheet — and let
	# it decompress. Clients without it (older Safari) get the decoded payload.
	raw = doc.sheets_data
	return {
		"name": doc.name,
		"title": doc.title,
		"sheets_data": raw if frappe.utils.cint(compressed) else decode_sheets_data(raw),
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
	# Frappe's default link enforcement blocks deletion when child rows exist.
	# We own the lifecycle of Sheet Snapshot / Sheet Op Log / Sheet Seq, so a
	# Sheet delete should cascade across them — atomically and in dependency
	# order. The head pointer on Sheet is cleared first so the snapshot delete
	# doesn't trip the "linked from Sheet" check.
	frappe.has_permission("Sheet", doc=name, ptype="delete", throw=True)
	frappe.db.set_value("Sheet", name, "head_snapshot", None, update_modified=False)
	frappe.db.delete("Sheet Snapshot", {"sheet": name})
	frappe.db.delete("Sheet Op Log",   {"sheet": name})
	frappe.db.delete("Sheet Seq",      {"sheet": name})
	frappe.delete_doc("Sheet", name, ignore_permissions=False)
	return "ok"


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
