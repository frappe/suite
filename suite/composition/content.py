"""The content layer's routes: /api/suite/content/{node}/..., where the node's Drive type picks the app.

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
from suite.suite_core import content
from suite.suite_core.content import adapters, documents

# Every row reads or writes its own bytes, so each is a stream; a POST answers JSON
ROUTES = (
    Route(
        "GET",
        "{node}/log",
        "document_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
        kind="query",
        public_name="content.open",
    ),
    Route(
        "GET",
        "{node}/updates",
        "updates_get",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        stream=True,
        kind="query",
        public_name="content.pull",
    ),
    Route(
        "POST",
        "{node}/updates",
        "updates_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.push",
    ),
    Route(
        "PUT",
        "{node}/stage/{stage_id}/{idx}",
        "stage_put",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.stage",
    ),
    Route(
        "POST",
        "{node}/sessions",
        "sessions_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.startSession",
    ),
    Route(
        "POST",
        "{node}/suspect",
        "suspect_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.reportSuspect",
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
def document_get(node: str):
    return respond_or_refuse(lambda: open_document(node))


@frappe.whitelist(allow_guest=True, methods=["GET"])
def updates_get(node: str, since: str | None = None, q_epoch: str | None = None):
    return respond_or_refuse(lambda: pull_rows(node, since, q_epoch))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def updates_post(node: str):
    return respond_or_refuse(lambda: push_rows(node))


@frappe.whitelist(allow_guest=True, methods=["PUT"])
def stage_put(node: str, stage_id: str, idx: str):
    return respond_or_refuse(lambda: stage_piece(node, stage_id, idx))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def sessions_post(node: str):
    return respond_or_refuse(lambda: start_session(node))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def suspect_post(node: str):
    return respond_or_refuse(lambda: report_suspect(node))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That content address does not exist"))


def open_document(node: str) -> Response:
    if not content.enabled():
        disabled = {"state": "disabled", "proto": content.PROTOCOL_VERSION}
        return frame_response(disabled)

    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.READ, principal)
    doc = content.find(adapter, node)
    if doc is None:
        unconverted = {"state": "unconverted", "proto": content.PROTOCOL_VERSION}
        return frame_response(unconverted)

    can_write = frappe.session.user != "Guest" and can_access(node, drive.EDIT)
    try:
        snapshot = content.read(adapter, doc.id)
    except content.ChainBroken:
        frappe.log_error(title="Collab open: chain_break", message=f"{adapter} document {doc.id}")
        raise content.Refusal(503, "chain_break") from None
    if snapshot is None:
        unconverted = {"state": "unconverted", "proto": content.PROTOCOL_VERSION}
        return frame_response(unconverted)

    documents.consider_compaction(adapter, doc.id)
    header = {
        **content.open_header(snapshot, can_write=can_write),
        "limits": content.limits(doc),
        "rooms": content.rooms(adapter, doc.id, doc.lineage),
    }
    rows = content.with_tombstones(snapshot)
    return frame_response(header, rows, snapshot["checkpoint"])


def pull_rows(node: str, since: str | None, q_epoch: str | None) -> Response:
    content.require_enabled()
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.READ, principal)
    # The epoch is read before the rows, so a quarantine between them shows on the next pull
    doc = require_log(adapter, node)
    try:
        since_rev = int(since or 0)
        seen_epoch = int(q_epoch) if q_epoch is not None else None
    except ValueError:
        raise content.Refusal(400, "malformed") from None
    epoch = int(doc.q_epoch)
    if seen_epoch is not None and seen_epoch < epoch:
        # The tab may hold a row now quarantined
        rebuild = {"state": "rebuild", "proto": content.PROTOCOL_VERSION, "q_epoch": epoch}
        return frame_response(rebuild)

    rows = content.rows_after(adapter, doc.id, max(since_rev, 0))
    documents.consider_compaction(adapter, doc.id)
    schema_steps = json.loads(doc.schema_steps)
    schema = schema_steps[-1][1]
    header = {
        "state": "live",
        "proto": content.PROTOCOL_VERSION,
        "q_epoch": epoch,
        "judged": int(doc.judged),
        "schema": schema,
        "limits": content.limits(doc),
        "rooms": content.rooms(adapter, doc.id, doc.lineage),
    }
    if doc.verdict:
        header["verdict"] = doc.verdict
    if doc.suspect_held:
        # Readers learn only whether one change or the document is in question; the cause is for admins
        header["held"] = "bad_checkpoint" if doc.suspect_held == "bad_checkpoint" else "change"
    return frame_response(header, rows)


def push_rows(node: str) -> Response:
    content.require_enabled()
    body = frappe.request.get_data()
    header, payload = content.parse_push(body)
    adapter = authorize_node(node, drive.EDIT, header.get("principal"))
    doc = require_log(adapter, node)
    try:
        schema = adapters.spec_of(adapter).schema
        answer = content.push(adapter, doc.id, header, payload, frappe.session.user, schema)
    except content.Refusal as refusal:
        if refusal.body["collab"] == "compacting":
            documents.consider_compaction(adapter, doc.id, refused=True)
        raise
    documents.touch(adapter, doc.id)
    final_from = header["sid"] if header.get("final") is True else None
    documents.consider_compaction(adapter, doc.id, final_from=final_from)
    return json_response(200, answer)


def stage_piece(node: str, stage_id: str, idx: str) -> Response:
    content.require_enabled()
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.EDIT, principal)
    body = frappe.request.get_data()
    header, index, piece = content.parse_piece(body, stage_id, idx)
    doc = require_log(adapter, node)
    answer = content.put_piece(adapter, doc.id, stage_id, header, index, piece, frappe.session.user)
    return json_response(200, answer)


def report_suspect(node: str) -> Response:
    """A tab's row threw when it applied it; anyone who can read the document may say so."""
    content.require_enabled()
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.READ, principal)
    doc = require_log(adapter, node)
    try:
        body_bytes = frappe.request.get_data() or b"{}"
        body = json.loads(body_bytes)
        rev = body.get("rev")
    except (ValueError, AttributeError):
        rev = None
    if type(rev) is not int:
        raise content.Refusal(400, "malformed")

    status, answer = documents.report_suspect(adapter, doc.id, rev)
    return json_response(status, answer)


def start_session(node: str) -> Response:
    content.require_enabled()
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.EDIT, principal)
    doc = require_log(adapter, node)
    try:
        body_bytes = frappe.request.get_data() or b"{}"
        body = json.loads(body_bytes)
        sid = body.get("sid")
        claim = body.get("claim")
    except (ValueError, AttributeError):
        sid = claim = None
    well_formed_sid = isinstance(sid, str) and len(sid) == 32 and sid.isalnum()
    if not well_formed_sid:
        raise content.Refusal(400, "malformed")

    if claim is not None:
        claimed = content.claim_session(adapter, doc, sid, claim, frappe.session.user)
        return json_response(200, {"claim": claimed})

    client_id = content.issue_session(adapter, doc.id, sid, frappe.session.user)
    return json_response(200, {"client_id": client_id})


def require_log(adapter: str, node: str):
    doc = content.find(adapter, node)
    if doc is None:
        raise content.Refusal(409, "unconverted")

    return doc


def authorize_node(node: str, role: int, principal) -> str:
    """Who the tab says it is, then the app that keeps the node, then what Drive says it may do.
    Editing needs a signed-in user. Answers the app's adapter name."""
    require_principal(principal)
    if role == drive.EDIT and frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")

    adapter = adapter_of(node)
    check_drive_access(node, role)
    return adapter


def adapter_of(node: str) -> str:
    """A node of a type no app keeps here is not found, as a missing one is."""
    content_type = frappe.db.get_value("Drive Node", node, "content_doctype")
    spec = adapters.for_type(content_type) if content_type else None
    if spec is None:
        raise content.Refusal(404, "not_found")

    return spec.name


def check_drive_access(node: str, role: int) -> None:
    try:
        drive.check(node, role)
    except drive.DriveError as error:
        for kind, status, reason in DRIVE_REFUSALS:
            if isinstance(error, kind):
                raise content.Refusal(status, reason) from None
        raise


def can_access(node: str, role: int) -> bool:
    try:
        check_drive_access(node, role)
    except (content.Refusal, drive.DriveError):
        return False
    return True


def require_principal(principal) -> None:
    if principal == frappe.session.user:
        return

    if frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")

    raise content.Refusal(409, "principal_changed")


def respond_or_refuse(build_response) -> Response:
    try:
        return build_response()
    except content.Refusal as refusal:
        return json_response(refusal.status, refusal.body)


def frame_response(header: dict, rows=(), checkpoint: bytes | None = None) -> Response:
    body = content.encode_frame(header, rows, checkpoint)
    return Response(body, status=200, mimetype="application/octet-stream")


def json_response(status: int, body: dict) -> Response:
    text = json.dumps(body)
    return Response(text, status=status, mimetype="application/json")


HTTP = HttpOwner(
    owner="content",
    prefix="/api/suite/content/",
    target="suite.composition.content",
    routes=ROUTES,
    strip_owner=False,
)
