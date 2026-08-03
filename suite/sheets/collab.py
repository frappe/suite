"""Frappe endpoints that back the Hocuspocus collab server.

Three responsibilities, split by who calls them and how they authenticate:

  1. ``check_collab_access`` — called by Hocuspocus' ``onAuthenticate`` hook
     with the user's session cookie forwarded from the browser. Returns the
     read/write flags + identity bundle (name, initials, avatar) the server
     attaches to the connection.

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
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac

import frappe
import pycrdt

# Header the collab server sends with every server-to-server call.
_COLLAB_SECRET_HEADER = "X-Collab-Secret"

# Concurrent flushes from two peers race on the same row. Neither loses data
# (the CRDT already holds both sides), so we swallow these rather than surface
# a save error to one of the editors.
_COLLISION_ERRORS = (
	frappe.exceptions.QueryDeadlockError,
	frappe.exceptions.TimestampMismatchError,
)

# ── P2P (y-webrtc) defaults ───────────────────────────────────────────────────
#
# Frappe operates a shared signaling + TURN box at signal.frappe.cloud, and
# Suite's own Writer already points at it (see its `REALTIME_CONFIG`). The TURN
# credentials below are the shared ones published in that config — they are not
# secret and are not meant to be. Override per-site via `collab_signaling` /
# `collab_ice_servers` in site_config.json.
_DEFAULT_SIGNALING = ["wss://signal.frappe.cloud"]
_DEFAULT_ICE_SERVERS = [
	{"urls": "stun:stun.l.google.com:19302"},
	{
		"urls": [
			"turn:signal.frappe.cloud:3478?transport=udp",
			"turn:signal.frappe.cloud:3478?transport=tcp",
		],
		"username": "turnuser",
		"credential": "turnpass",
	},
]


# ── Browser-side: auth hook called by Hocuspocus ──────────────────────────────


@frappe.whitelist()
def check_collab_access(name: str) -> dict:
	"""Return the caller's read/write capability + identity for a given sheet.

	Cookie-authenticated. Hocuspocus' ``onAuthenticate`` calls this with the
	user's session forwarded; the response decides whether the websocket is
	accepted and whether it's allowed to push updates.

	Read access without write means "viewer" — the connection still receives
	updates and emits awareness (cursor, presence), but writes are dropped
	at the server before fan-out.
	"""
	if frappe.session.user == "Guest":
		frappe.throw("Login required", frappe.AuthenticationError)

	can_read = bool(frappe.has_permission("Sheet", doc=name, ptype="read", throw=False))
	if not can_read:
		# Don't 403 here — the collab server treats {canRead: False} as a
		# clean refusal and closes the socket. Returning structured data
		# is easier to surface to the client than parsing exception text.
		return {"canRead": False, "canWrite": False}

	can_write = bool(frappe.has_permission("Sheet", doc=name, ptype="write", throw=False))
	user = frappe.session.user
	identity = _user_identity(user)
	return {
		"canRead": True,
		"canWrite": can_write,
		"user": user,
		"fullName": identity["full_name"],
		"initials": identity["initials"],
		"userImage": identity["user_image"],
	}


# ── Browser-side: P2P session bootstrap + persistence ─────────────────────────


@frappe.whitelist()
def get_collab_session(name: str) -> dict:
	"""Everything a browser needs to join the peer-to-peer session for ``name``.

	There is no server in the data plane here: peers exchange updates directly
	and the signaling box only introduces them to each other. It authenticates
	nobody, so anyone who can reach it and guess a room name can join that
	room. The room key returned below is what actually gates access — y-webrtc
	encrypts all room traffic with it, so an uninvited peer sees ciphertext.

	Handing out that key *is* the permission check, and it happens once per
	open. Read access is sufficient to get one: P2P can't enforce read-only
	downstream (any peer can send to any other), so a viewer who joins is
	technically able to publish. :func:`save_collab_state` is the backstop —
	it re-checks write permission before anything reaches the database, so a
	viewer still cannot make an edit that outlives the session.
	"""
	if frappe.session.user == "Guest":
		frappe.throw("Login required", frappe.AuthenticationError)

	if not _can_read_sheet(name):
		frappe.throw("Not permitted to open this sheet", frappe.PermissionError)

	# One read for both fields — the epoch and the stored doc live on the same
	# row, and this runs on every sheet open.
	state = (
		frappe.db.get_value(
			"Sheet Collab State", name, ("room_epoch", "ydoc_state"), as_dict=True
		)
		or {}
	)

	return {
		"room": _room_name(name),
		"password": _room_key(name, int(state.get("room_epoch") or 0)),
		"signaling": frappe.conf.get("collab_signaling") or _DEFAULT_SIGNALING,
		"iceServers": frappe.conf.get("collab_ice_servers") or _DEFAULT_ICE_SERVERS,
		"ydocState": state.get("ydoc_state") or None,
		"canWrite": _can_write_sheet(name),
	}


@frappe.whitelist(methods=["POST"])
def save_collab_state(name: str, update: str) -> dict:
	"""Merge one peer's Y.Doc update into the stored state for ``name``.

	Writer overwrites its stored blob with whatever the last saver sent. That
	is safe only while every peer is connected P2P and therefore holds a
	superset of everyone's edits — an assumption that breaks the moment one
	participant sits behind a NAT even TURN can't traverse. Their save would
	then clobber edits they never received.

	Merging server-side with the same CRDT the clients run removes the
	assumption entirely: applying updates is commutative and idempotent, so
	the stored state converges to the union no matter what order saves land
	in or how many are lost.
	"""
	if not _can_write_sheet(name):
		frappe.throw("Not permitted to edit this sheet", frappe.PermissionError)

	payload = _decode_update(update)
	# Before this endpoint existed, `ydoc_state` could only be written by the
	# collab server behind the shared secret. It's now reachable by every user
	# with write access, so the size that used to be implicitly trusted has to
	# be checked. Generous enough that no real workbook hits it — this is a
	# guard against a runaway or hostile client, not a quota.
	if len(payload) > _max_state_bytes():
		frappe.throw("Collab update too large", frappe.ValidationError)

	merged = _merge_update(name, payload)
	encoded = base64.b64encode(merged).decode()
	now = frappe.utils.now()

	try:
		if frappe.db.exists("Sheet Collab State", name):
			frappe.db.set_value(
				"Sheet Collab State",
				name,
				{"ydoc_state": encoded, "byte_size": len(merged), "last_persisted_at": now},
				update_modified=True,
			)
		else:
			doc = frappe.new_doc("Sheet Collab State")
			doc.sheet = name
			doc.ydoc_state = encoded
			doc.byte_size = len(merged)
			doc.last_persisted_at = now
			doc.insert(ignore_permissions=True)
	except _COLLISION_ERRORS:
		# Two peers flushing at once. Both updates are already in the CRDT they
		# share, and each retries on its next debounce window, so dropping this
		# write loses nothing — same reasoning as Writer's `save_doc`, which
		# swallows the identical pair of exceptions.
		return {"sheet": name, "byte_size": len(merged), "persisted_at": None, "skipped": True}

	return {"sheet": name, "byte_size": len(merged), "persisted_at": now, "skipped": False}


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
	row = frappe.db.get_value(
		"Sheet Collab State",
		name,
		("ydoc_state", "byte_size"),
		as_dict=True,
	) or {}
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
			"Collab server secret is not configured "
			"(set `collab_server_secret` in site_config.json)",
			frappe.AuthenticationError,
		)
	sent = (frappe.get_request_header(_COLLAB_SECRET_HEADER) or "").strip()
	# Constant-time compare — secrets are short enough that timing attacks
	# are vanishingly improbable, but hmac.compare_digest is the right
	# habit anyway.
	if not sent or not hmac.compare_digest(expected, sent):
		frappe.throw("Invalid collab server credentials", frappe.AuthenticationError)


def _can_read_sheet(name: str) -> bool:
	"""True when the session user may read sheet ``name``."""
	return bool(frappe.has_permission("Sheet", doc=name, ptype="read", throw=False))


def _can_write_sheet(name: str) -> bool:
	"""True when the session user may edit sheet ``name``."""
	return bool(frappe.has_permission("Sheet", doc=name, ptype="write", throw=False))


def _room_name(name: str) -> str:
	"""Signaling room id. Visible to anyone watching the signaling server."""
	return f"fsheet-{name}"


def _room_epoch(name: str) -> int:
	"""Rotation counter for ``name``'s room key. See :func:`bump_room_epoch`."""
	return int(frappe.db.get_value("Sheet Collab State", name, "room_epoch") or 0)


def bump_room_epoch(name: str) -> int:
	"""Invalidate the current room key for ``name``.

	Called when someone loses access. Without it the key is a permanent
	grant: every other input to the derivation is fixed for the life of the
	sheet, so a user whose access was revoked could keep decrypting the room
	indefinitely. The signaling server won't stop them rejoining, and there
	is nothing else in a P2P session that would.

	Deliberately *not* called when access is granted. Rotating splits any
	live session until every peer reloads and picks up the new key — the
	desired outcome for a revocation, pure disruption for a grant.
	"""
	if frappe.db.exists("Sheet Collab State", name):
		epoch = _room_epoch(name) + 1
		frappe.db.set_value("Sheet Collab State", name, "room_epoch", epoch)
		return epoch

	# No collab state row yet — this sheet has never been opened
	# collaboratively. Record the bump anyway: a key handed out before the
	# row existed must not survive the revocation.
	doc = frappe.new_doc("Sheet Collab State")
	doc.sheet = name
	doc.room_epoch = 1
	doc.insert(ignore_permissions=True)
	return 1


def _room_key(name: str, epoch: int) -> str:
	"""Per-sheet symmetric key that y-webrtc encrypts room traffic with.

	Derived rather than stored, so there's no key material to back up or
	leak and none to coordinate across restarts.

	Three inputs. The site's encryption key is the secret. ``name`` keeps each
	sheet's key independent, so compromising one room reveals nothing about
	any other. ``epoch`` is what makes the key *revocable* — changing it
	changes the derived key, and that is the only way to take back a key
	someone already holds.
	"""
	from frappe.utils.password import get_encryption_key

	secret = frappe.conf.get("collab_room_secret") or get_encryption_key()
	return hmac.new(
		secret.encode() if isinstance(secret, str) else secret,
		f"sheets-collab-room:{name}:{epoch}".encode(),
		hashlib.sha256,
	).hexdigest()


def _max_state_bytes() -> int:
	"""Ceiling on a single decoded Y.Doc update, overridable per site."""
	return int(frappe.conf.get("collab_max_state_bytes") or 10 * 1024 * 1024)


def _decode_update(update: str) -> bytes:
	"""Base64 → raw Y.Doc update bytes, with a legible error on garbage."""
	try:
		return base64.b64decode(update or "", validate=True)
	except (binascii.Error, ValueError):
		frappe.throw("Malformed collab update payload", frappe.ValidationError)


def _apply_update(doc: pycrdt.Doc, payload: bytes) -> bool:
	"""Apply ``payload`` to ``doc``; ``False`` when it isn't a valid Y update.

	pycrdt is a Rust extension, and it surfaces a malformed update as a pyo3
	``PanicException`` — which inherits straight from ``BaseException``, so a
	plain ``except Exception`` sails right past it. There is no importable
	symbol to name that class (``pyo3_runtime`` exists only as a ``__module__``
	label), which is why the catch here has to be broad. Keeping it inside this
	one small helper is what stops that breadth leaking into the callers, and
	the two BaseExceptions that must never be swallowed are re-raised.

	A doc that panicked mid-apply is not reused by either caller.
	"""
	try:
		doc.apply_update(payload)
		return True
	except (KeyboardInterrupt, SystemExit):
		raise
	except BaseException:
		return False


def _merge_update(name: str, incoming: bytes) -> bytes:
	"""Apply ``incoming`` on top of the stored state, returning the merged doc.

	The Y.Doc binary stays opaque to us — pycrdt is only doing the merge, it
	never inspects the spreadsheet's contents.
	"""
	doc = pycrdt.Doc()
	stored = frappe.db.get_value("Sheet Collab State", name, "ydoc_state")
	if stored and not _apply_update(doc, base64.b64decode(stored)):
		# A corrupt stored blob shouldn't strand the sheet forever — start from
		# a clean doc and let the incoming update become the new base.
		frappe.log_error(f"Unreadable collab state for {name}", frappe.get_traceback())
		doc = pycrdt.Doc()

	if not _apply_update(doc, incoming):
		# Client-supplied bytes, so this is reachable by anyone who can edit.
		# Without the guard the panic would bypass Frappe's error handling
		# entirely and surface as a bare 500.
		frappe.throw("Malformed collab update payload", frappe.ValidationError)

	return doc.get_update()


def _user_identity(user: str) -> dict:
	"""Return full_name, initials, and user_image — mirrors api._user_identity."""
	full_name = frappe.db.get_value("User", user, "full_name") or user
	user_image = frappe.db.get_value("User", user, "user_image") or ""
	parts = full_name.split()
	initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
	return {"full_name": full_name, "initials": initials, "user_image": user_image}
