"""HTTP routes for Writer's collaborative documents.

Bodies and answers are binary frames, so these handlers answer with their own
responses instead of the JSON envelope.
"""

import json

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import HttpOwner, Route
from suite.suite_core import collab
from suite.writer.collab import ADAPTER

ROUTES = (
    Route("GET", "documents/{node}/collab", "collab_get"),
    Route("GET", "documents/{node}/collab/updates", "collab_updates_get"),
    Route("POST", "documents/{node}/collab/updates", "collab_updates_post"),
    Route("POST", "documents/{node}/collab/sessions", "collab_sessions_post"),
)

HTTP = HttpOwner(
    owner="writer",
    prefix="/api/suite/writer/",
    target="suite.writer.collab.routes",
    routes=ROUTES,
    strip_owner=False,
)

DRIVE_REFUSALS = (
    (drive.DriveNotFound, 404, "not_found"),
    (drive.DriveForbidden, 403, "forbidden"),
    (drive.DriveLinkExpired, 403, "link_expired"),
    (drive.DriveLocked, 401, "locked"),
)


@frappe.whitelist(methods=["GET"])
def collab_get(node: str):
    return _answer(lambda: _open(node))


@frappe.whitelist(methods=["GET"])
def collab_updates_get(node: str, since: str | None = None):
    return _answer(lambda: _pull(node, since))


@frappe.whitelist(methods=["POST"])
def collab_updates_post(node: str):
    return _answer(lambda: _push(node))


@frappe.whitelist(methods=["POST"])
def collab_sessions_post(node: str):
    return _answer(lambda: _session(node))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Writer address does not exist"))


def _open(node: str) -> Response:
    if not collab.enabled():
        return _frame({"state": "disabled", "proto": collab.PROTO})
    _check(node, drive.READ)
    doc = collab.find(ADAPTER, node)
    if doc is None:
        return _frame({"state": "unconverted", "proto": collab.PROTO})
    header = collab.open_header(doc, can_write=_can(node, drive.EDIT))
    return _frame(header, collab.rows_after(ADAPTER, doc.id, 0))


def _pull(node: str, since: str | None) -> Response:
    collab.require_enabled()
    _check(node, drive.READ)
    doc = _doc(node)
    try:
        after = int(since or 0)
    except ValueError:
        raise collab.Refusal(400, "malformed") from None
    return _frame({"state": "live", "proto": collab.PROTO}, collab.rows_after(ADAPTER, doc.id, max(after, 0)))


def _push(node: str) -> Response:
    collab.require_enabled()
    _check(node, drive.EDIT)
    doc = _doc(node)
    header, payload = collab.parse_push(frappe.request.get_data())
    _require_principal(header)
    return _json(200, collab.push(ADAPTER, doc.id, header, payload, frappe.session.user))


def _session(node: str) -> Response:
    collab.require_enabled()
    _check(node, drive.EDIT)
    doc = _doc(node)
    try:
        sid = json.loads(frappe.request.get_data() or b"{}").get("sid")
    except (ValueError, AttributeError):
        sid = None
    if not isinstance(sid, str) or len(sid) != 32 or not sid.isalnum():
        raise collab.Refusal(400, "malformed")
    client_id = collab.issue_session(ADAPTER, doc.id, sid, frappe.session.user)
    return _json(200, {"client_id": client_id})


def _doc(node: str):
    doc = collab.find(ADAPTER, node)
    if doc is None:
        raise collab.Refusal(409, "unconverted")
    return doc


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
        drive.check(node, role)
    except drive.DriveError:
        return False
    return True


def _require_principal(header: dict) -> None:
    if header.get("principal") == frappe.session.user:
        return
    if frappe.session.user == "Guest":
        raise collab.Refusal(401, "signed_out")
    raise collab.Refusal(409, "principal_changed")


def _answer(handle) -> Response:
    try:
        return handle()
    except collab.Refusal as refusal:
        return _json(refusal.status, refusal.body)


def _frame(header: dict, rows=()) -> Response:
    return Response(collab.frame(header, rows), status=200, mimetype="application/octet-stream")


def _json(status: int, body: dict) -> Response:
    return Response(json.dumps(body), status=status, mimetype="application/json")
