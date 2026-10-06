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
from suite.composition.http import HttpOwner, Route
from suite.suite_core import collab
from suite.writer.collab import ADAPTER, SCHEMA, consider_compaction

# Every row reads or writes its own bytes, so each is a stream; a POST answers JSON
ROUTES = (
    Route(
        "GET",
        "documents/{node}/collab",
        "collab_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
    ),
    Route(
        "GET",
        "documents/{node}/collab/updates",
        "collab_updates_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
    ),
    Route(
        "POST",
        "documents/{node}/collab/updates",
        "collab_updates_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
    ),
    Route(
        "POST",
        "documents/{node}/collab/sessions",
        "collab_sessions_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
    ),
)

HTTP = HttpOwner(
    owner="writer",
    prefix="/api/suite/writer/",
    target="suite.writer.collab.routes",
    routes=ROUTES,
    strip_owner=False,
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
def collab_sessions_post(node: str):
    return _answer(lambda: _session(node))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


def _open(node: str) -> Response:
    if not collab.enabled():
        return _frame({"state": "disabled", "proto": collab.PROTO})
    _authorize(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    doc = collab.find(ADAPTER, node)
    if doc is None:
        return _frame({"state": "unconverted", "proto": collab.PROTO})
    can_write = frappe.session.user != "Guest" and _can(node, drive.EDIT)
    try:
        snapshot = collab.read(ADAPTER, doc.id)
    except collab.ChainBroken:
        frappe.log_error(title="Collab open: chain_break", message=f"{ADAPTER} document {doc.id}")
        raise collab.Refusal(503, "chain_break") from None
    consider_compaction(doc.id)
    return _frame(
        collab.open_header(snapshot, can_write=can_write),
        collab.with_tombstones(snapshot),
        snapshot["checkpoint"],
    )


def _pull(node: str, since: str | None, q_epoch: str | None) -> Response:
    collab.require_enabled()
    _authorize(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    # The epoch is read before the rows, so a quarantine between them shows on the next pull
    doc = _doc(node)
    try:
        after = int(since or 0)
        seen_epoch = int(q_epoch) if q_epoch is not None else None
    except ValueError:
        raise collab.Refusal(400, "malformed") from None
    epoch = int(doc.q_epoch)
    if seen_epoch is not None and seen_epoch < epoch:
        # The tab may hold a row now quarantined
        return _frame({"state": "rebuild", "proto": collab.PROTO, "q_epoch": epoch})
    rows = collab.rows_after(ADAPTER, doc.id, max(after, 0))
    consider_compaction(doc.id)
    return _frame({"state": "live", "proto": collab.PROTO, "q_epoch": epoch}, rows)


def _push(node: str) -> Response:
    collab.require_enabled()
    header, payload = collab.parse_push(frappe.request.get_data())
    _authorize(node, drive.EDIT, header.get("principal"))
    doc = _doc(node)
    answer = collab.push(ADAPTER, doc.id, header, payload, frappe.session.user, SCHEMA)
    consider_compaction(doc.id, final_from=header["sid"] if header.get("final") is True else None)
    return _json(200, answer)


def _session(node: str) -> Response:
    collab.require_enabled()
    _authorize(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    doc = _doc(node)
    try:
        body = json.loads(frappe.request.get_data() or b"{}")
        sid, claim = body.get("sid"), body.get("claim")
    except (ValueError, AttributeError):
        sid = claim = None
    if not isinstance(sid, str) or len(sid) != 32 or not sid.isalnum():
        raise collab.Refusal(400, "malformed")
    if claim is not None:
        return _json(200, {"claim": collab.claim_session(ADAPTER, doc, sid, claim, frappe.session.user)})
    client_id = collab.issue_session(ADAPTER, doc.id, sid, frappe.session.user)
    return _json(200, {"client_id": client_id})


def _doc(node: str):
    doc = collab.find(ADAPTER, node)
    if doc is None:
        raise collab.Refusal(409, "unconverted")
    return doc


def _authorize(node: str, role: int, principal) -> None:
    """Who the tab says it is, then what Drive says it may do. Editing needs a signed-in user."""
    _require_principal(principal)
    if role == drive.EDIT and frappe.session.user == "Guest":
        raise collab.Refusal(401, "signed_out")
    _check(node, role)


def _check(node: str, role: int) -> None:
    try:
        drive.check(node, role)
    except drive.DriveError as error:
        for kind, status, reason in DRIVE_REFUSALS:
            if isinstance(error, kind):
                raise collab.Refusal(status, reason) from None
        raise


def _can(node: str, role: int) -> bool:
    try:
        _check(node, role)
    except (collab.Refusal, drive.DriveError):
        return False
    return True


def _require_principal(principal) -> None:
    if principal == frappe.session.user:
        return
    if frappe.session.user == "Guest":
        raise collab.Refusal(401, "signed_out")
    raise collab.Refusal(409, "principal_changed")


def _answer(handle) -> Response:
    try:
        return handle()
    except collab.Refusal as refusal:
        return _json(refusal.status, refusal.body)


def _frame(header: dict, rows=(), checkpoint: bytes | None = None) -> Response:
    return Response(collab.frame(header, rows, checkpoint), status=200, mimetype="application/octet-stream")


def _json(status: int, body: dict) -> Response:
    return Response(json.dumps(body), status=status, mimetype="application/json")
