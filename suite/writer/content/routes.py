"""HTTP routes for Writer's collaborative documents.

Bodies and answers are binary frames, so these handlers answer with their own
responses instead of the JSON envelope. Every request names the principal the
tab expects, and that is checked before Drive is asked, so an expired sign-in
answers `signed_out` rather than a permission verdict. Guests are heard for
the same reason, but only to read: guest editing waits for stage G.
"""

import json

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import Route
from suite.suite_core import content
from suite.suite_core.content.documents import consider_compaction, report_suspect
from suite.writer.content import ADAPTER, SCHEMA

# The Writer table resolves every handler here, the contract-only ones too
from suite.writer.http.routes import document as document
from suite.writer.http.routes import save_comments as save_comments
from suite.writer.http.routes import save_doc as save_doc
from suite.writer.http.routes import save_html as save_html
from suite.writer.http.routes import update_settings as update_settings

# Every row reads or writes its own bytes, so each is a stream; a POST answers JSON
ROUTES = (
    Route(
        "GET",
        "documents/{node}/collab",
        "collab_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
        kind="query",
        public_name="collab.open",
    ),
    Route(
        "GET",
        "documents/{node}/collab/updates",
        "collab_updates_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
        kind="query",
        public_name="collab.pull",
    ),
    Route(
        "POST",
        "documents/{node}/collab/updates",
        "collab_updates_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="collab.push",
    ),
    Route(
        "PUT",
        "documents/{node}/collab/stage/{stage_id}/{idx}",
        "collab_stage_put",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="collab.stage",
    ),
    Route(
        "POST",
        "documents/{node}/collab/sessions",
        "collab_sessions_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="collab.startSession",
    ),
    Route(
        "POST",
        "documents/{node}/collab/suspect",
        "collab_suspect_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="collab.reportSuspect",
    ),
)

PRINCIPAL_HEADER = "X-Collab-Principal"

DRIVE_REFUSALS = (
    (drive.DriveNotFound, 404, "not_found"),
    (drive.DriveForbidden, 403, "forbidden"),
    (drive.DriveLinkExpired, 403, "link_expired"),
    (drive.DriveLocked, 401, "locked"),
)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def collab_get(node: str):
    return _answer(lambda: _open(node))


@frappe.whitelist(allow_guest=True, methods=["GET"])
def collab_updates_get(node: str, since: str | None = None, q_epoch: str | None = None):
    return _answer(lambda: _pull(node, since, q_epoch))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def collab_updates_post(node: str):
    return _answer(lambda: _push(node))


@frappe.whitelist(allow_guest=True, methods=["PUT"])
def collab_stage_put(node: str, stage_id: str, idx: str):
    return _answer(lambda: _stage(node, stage_id, idx))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def collab_sessions_post(node: str):
    return _answer(lambda: _session(node))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def collab_suspect_post(node: str):
    return _answer(lambda: _suspect(node))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


def _open(node: str) -> Response:
    if not content.enabled():
        return _frame({"state": "disabled", "proto": content.PROTO})
    _authorize(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    doc = content.find(ADAPTER, node)
    if doc is None:
        return _frame({"state": "unconverted", "proto": content.PROTO})
    can_write = frappe.session.user != "Guest" and _can(node, drive.EDIT)
    try:
        snapshot = content.read(ADAPTER, doc.id)
    except content.ChainBroken:
        frappe.log_error(title="Collab open: chain_break", message=f"{ADAPTER} document {doc.id}")
        raise content.Refusal(503, "chain_break") from None
    if snapshot is None:
        return _frame({"state": "unconverted", "proto": content.PROTO})
    consider_compaction(ADAPTER, doc.id)
    return _frame(
        {
            **content.open_header(snapshot, can_write=can_write),
            "limits": content.limits(doc),
            "rooms": content.rooms(ADAPTER, doc.id, doc.lineage),
        },
        content.with_tombstones(snapshot),
        snapshot["checkpoint"],
    )


def _pull(node: str, since: str | None, q_epoch: str | None) -> Response:
    content.require_enabled()
    _authorize(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    # The epoch is read before the rows, so a quarantine between them shows on the next pull
    doc = _doc(node)
    try:
        after = int(since or 0)
        seen_epoch = int(q_epoch) if q_epoch is not None else None
    except ValueError:
        raise content.Refusal(400, "malformed") from None
    epoch = int(doc.q_epoch)
    if seen_epoch is not None and seen_epoch < epoch:
        # The tab may hold a row now quarantined
        return _frame({"state": "rebuild", "proto": content.PROTO, "q_epoch": epoch})
    rows = content.rows_after(ADAPTER, doc.id, max(after, 0))
    consider_compaction(ADAPTER, doc.id)
    header = {
        "state": "live",
        "proto": content.PROTO,
        "q_epoch": epoch,
        "judged": int(doc.judged),
        "schema": json.loads(doc.schema_steps)[-1][1],
        "limits": content.limits(doc),
        "rooms": content.rooms(ADAPTER, doc.id, doc.lineage),
    }
    if doc.verdict:
        header["verdict"] = doc.verdict
    if doc.suspect_held:
        # Readers learn only whether one change or the document is in question; the cause is for admins
        header["held"] = "bad_checkpoint" if doc.suspect_held == "bad_checkpoint" else "change"
    return _frame(header, rows)


def _push(node: str) -> Response:
    content.require_enabled()
    header, payload = content.parse_push(frappe.request.get_data())
    _authorize(node, drive.EDIT, header.get("principal"))
    doc = _doc(node)
    try:
        answer = content.push(ADAPTER, doc.id, header, payload, frappe.session.user, SCHEMA)
    except content.Refusal as refusal:
        if refusal.body["collab"] == "compacting":
            consider_compaction(ADAPTER, doc.id, refused=True)
        raise
    consider_compaction(ADAPTER, doc.id, final_from=header["sid"] if header.get("final") is True else None)
    return _json(200, answer)


def _stage(node: str, stage_id: str, idx: str) -> Response:
    content.require_enabled()
    _authorize(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    header, index, piece = content.parse_piece(frappe.request.get_data(), stage_id, idx)
    doc = _doc(node)
    return _json(200, content.put_piece(ADAPTER, doc.id, stage_id, header, index, piece, frappe.session.user))


def _suspect(node: str) -> Response:
    """A tab's row threw when it applied it; anyone who can read the document may say so."""
    content.require_enabled()
    _authorize(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    doc = _doc(node)
    try:
        rev = json.loads(frappe.request.get_data() or b"{}").get("rev")
    except (ValueError, AttributeError):
        rev = None
    if type(rev) is not int:
        raise content.Refusal(400, "malformed")
    return _json(*report_suspect(ADAPTER, doc.id, rev))


def _session(node: str) -> Response:
    content.require_enabled()
    _authorize(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    doc = _doc(node)
    try:
        body = json.loads(frappe.request.get_data() or b"{}")
        sid, claim = body.get("sid"), body.get("claim")
    except (ValueError, AttributeError):
        sid = claim = None
    if not isinstance(sid, str) or len(sid) != 32 or not sid.isalnum():
        raise content.Refusal(400, "malformed")
    if claim is not None:
        return _json(200, {"claim": content.claim_session(ADAPTER, doc, sid, claim, frappe.session.user)})
    client_id = content.issue_session(ADAPTER, doc.id, sid, frappe.session.user)
    return _json(200, {"client_id": client_id})


def _doc(node: str):
    doc = content.find(ADAPTER, node)
    if doc is None:
        raise content.Refusal(409, "unconverted")
    return doc


def _authorize(node: str, role: int, principal) -> None:
    """Who the tab says it is, then what Drive says it may do. Editing needs a signed-in user."""
    _require_principal(principal)
    if role == drive.EDIT and frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")
    _check(node, role)


def _check(node: str, role: int) -> None:
    try:
        drive.check(node, role)
    except drive.DriveError as error:
        for kind, status, reason in DRIVE_REFUSALS:
            if isinstance(error, kind):
                raise content.Refusal(status, reason) from None
        raise


def _can(node: str, role: int) -> bool:
    try:
        _check(node, role)
    except (content.Refusal, drive.DriveError):
        return False
    return True


def _require_principal(principal) -> None:
    if principal == frappe.session.user:
        return
    if frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")
    raise content.Refusal(409, "principal_changed")


def _answer(handle) -> Response:
    try:
        return handle()
    except content.Refusal as refusal:
        return _json(refusal.status, refusal.body)


def _frame(header: dict, rows=(), checkpoint: bytes | None = None) -> Response:
    return Response(content.frame(header, rows, checkpoint), status=200, mimetype="application/octet-stream")


def _json(status: int, body: dict) -> Response:
    return Response(json.dumps(body), status=status, mimetype="application/json")
