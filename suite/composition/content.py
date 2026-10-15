"""The content layer's routes: /api/suite/content/{node}/..., where the node's Drive type picks the app.

Bodies and answers are binary frames, so these handlers answer with their own
responses instead of the JSON envelope. Every request names the principal the
tab expects, and that is checked before Drive is asked, so an expired sign-in
answers `signed_out` rather than a permission verdict. Guests are heard for
the same reason, but only to read: guest editing waits for stage G.
"""

import json
from http import HTTPStatus

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite import drive
from suite.composition.http import HttpOwner, Route
from suite.suite_core import content
from suite.suite_core.content import adapters, documents, touches
from suite.suite_core.content.adapters import ContentAdapterSpec, NodeHooks

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
    Route(
        "POST",
        "{node}/projection",
        "projection_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.submitRender",
    ),
    Route(
        "POST",
        "{node}/restore",
        "restore_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.beginRestore",
    ),
    Route(
        "POST",
        "{node}/restore/cancel",
        "restore_cancel_post",
        allow_guest=True,
        errors=(drive.DriveNotFound, drive.DriveForbidden, drive.DriveLocked),
        output=dict[str, int | str],
        stream=True,
        kind="mutation",
        public_name="content.cancelRestore",
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


@frappe.whitelist(allow_guest=True, methods=["POST"])
def projection_post(node: str):
    return respond_or_refuse(lambda: submit_render(node))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def restore_post(node: str):
    return respond_or_refuse(lambda: begin_restore(node))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def restore_cancel_post(node: str):
    return respond_or_refuse(lambda: cancel_restore(node))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That content address does not exist"))


def open_document(node: str) -> Response:
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.READ, principal)
    if not content.enabled(adapter):
        return state_reply("disabled")

    doc = content.find(adapter, node)
    if doc is None:
        return state_reply("unconverted")

    can_write = frappe.session.user != "Guest" and can_access(node, drive.EDIT)
    try:
        snapshot = content.read(adapter, doc.id)
    except content.ChainBroken:
        frappe.log_error(title="Collab open: chain_break", message=f"{adapter} document {doc.id}")
        raise content.Refusal(503, "chain_break") from None
    if snapshot is None:
        return state_reply("unconverted")

    documents.consider_compaction(adapter, doc.id)
    header = {
        **content.open_header(snapshot, can_write=can_write),
        "limits": content.limits(adapter, doc),
        "rooms": content.rooms(adapter, doc.id, doc.lineage),
        **content.restore_fields(adapter, doc.id),
    }
    rows = content.with_tombstones(snapshot)
    return frame_response(header, rows, snapshot.checkpoint)


def pull_rows(node: str, since: str | None, q_epoch: str | None) -> Response:
    # The epoch is read before the rows, so a quarantine between them shows on the next pull
    adapter, doc = resolved(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    try:
        since_rev = int(since or 0)
        seen_epoch = int(q_epoch) if q_epoch is not None else None
    except ValueError:
        raise content.Refusal(400, "malformed") from None
    epoch = int(doc.q_epoch)
    if seen_epoch is not None and seen_epoch < epoch:
        # The tab may hold a row now quarantined
        return state_reply("rebuild", q_epoch=epoch)

    if since_rev < int(doc.trimmed_rev):
        # Rows the tab still needs are gone; the body holds them
        return state_reply("rebuild", q_epoch=epoch)

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
        "limits": content.limits(adapter, doc),
        "rooms": content.rooms(adapter, doc.id, doc.lineage),
        **content.restore_fields(adapter, doc.id),
    }
    if doc.verdict:
        header["verdict"] = doc.verdict
    if doc.suspect_held:
        # Readers learn only whether one change or the document is in question; the cause is for admins
        header["held"] = "bad_checkpoint" if doc.suspect_held == "bad_checkpoint" else "change"
    return frame_response(header, rows)


def push_rows(node: str) -> Response:
    body = frappe.request.get_data()
    header, payload = content.parse_push(body)
    adapter, doc = resolved(node, drive.EDIT, header.principal)
    try:
        answer = content.push(adapter, doc.id, header, payload, frappe.session.user)
    except content.Refusal as refusal:
        if refusal.body["collab"] == "compacting":
            documents.consider_compaction(adapter, doc.id, refused=True)
        raise
    touches.touch(adapter, doc.id)
    touches.take_version(adapter, doc.id)
    answer["copy"] = content.copy_wanted(adapter, doc.id)
    final_from = header.sid if header.is_final else None
    documents.consider_compaction(adapter, doc.id, final_from=final_from)
    return json_response(200, answer)


def stage_piece(node: str, stage_id: str, idx: str) -> Response:
    principal = frappe.get_request_header(PRINCIPAL_HEADER)
    adapter = authorize_node(node, drive.EDIT, principal)
    content.require_enabled(adapter)
    body = frappe.request.get_data()
    header, index, piece = content.parse_piece(adapter, body, stage_id, idx)
    doc = require_log(adapter, node)
    answer = content.put_piece(adapter, doc.id, stage_id, header, index, piece, frappe.session.user)
    return json_response(200, answer)


def report_suspect(node: str) -> Response:
    """A tab's row threw when it applied it; anyone who can read the document may say so."""
    adapter, doc = resolved(node, drive.READ, frappe.get_request_header(PRINCIPAL_HEADER))
    rev = json_body().get("rev")
    if type(rev) is not int:
        raise content.Refusal(400, "malformed")

    status, answer = documents.report_suspect(adapter, doc.id, rev)
    return json_response(status, answer)


def submit_render(node: str) -> Response:
    """Take an editing tab's staged render of the document at a rev, to be checked as its readable copy."""
    adapter, doc = resolved(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    status, answer = content.submit_render(adapter, doc.id, json_body().get("stage_id"), frappe.session.user)
    if status == HTTPStatus.ACCEPTED:
        documents.request_render_check(adapter, doc.id)

    return json_response(status, answer)


def begin_restore(node: str) -> Response:
    """Fence the document for a restore of version `version`, after a version of what it holds now."""
    adapter, doc = resolved(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    body = json_body()
    seen_rev = body.get("seen_rev")
    version = body.get("version")
    if type(seen_rev) is not int or type(version) is not int:
        raise content.Refusal(400, "malformed")

    fence = content.begin_restore(adapter, doc.id, seen_rev)
    if not fence["has_milestone"]:
        take_milestone(adapter, doc.id, node, version, fence)

    return json_response(
        200, {"token": fence["token"], "base_rev": fence["base_rev"], "fence_ms": fence["fence_ms"]}
    )


def take_milestone(adapter: str, doc_id: str, node: str, version: int, fence: dict) -> None:
    """Nothing is restored without a version of the head first; a refused one lifts the fence."""
    label = _("Before restoring version {0}").format(version)
    try:
        drive.take_version(node, kind="milestone", label=label)
        content.milestone_taken(adapter, doc_id, fence["head_chain"])
        frappe.db.commit()  # nosemgrep: frappe-manual-commit
    except Exception as error:
        frappe.db.rollback()
        content.cancel_restore(adapter, doc_id, fence["token"])
        if isinstance(error, drive.DriveError):
            raise content.Refusal(409, "milestone_failed", message=str(error)) from None

        raise


def cancel_restore(node: str) -> Response:
    """Lift the fence the restoring tab set, when it gives up before sending the restore."""
    adapter, doc = resolved(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    token = json_body().get("token")
    if not isinstance(token, str):
        raise content.Refusal(400, "malformed")

    content.cancel_restore(adapter, doc.id, token)
    return json_response(200, {"cancelled": 1})


def start_session(node: str) -> Response:
    adapter, doc = resolved(node, drive.EDIT, frappe.get_request_header(PRINCIPAL_HEADER))
    body = json_body()
    sid = body.get("sid")
    claim = body.get("claim")
    if not isinstance(sid, str) or len(sid) != 32 or not sid.isalnum():
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


def resolved(node: str, role: int, principal: object) -> tuple[str, frappe._dict]:
    """The node's adapter and log, refused in order: access, collaboration off, no log."""
    adapter = authorize_node(node, role, principal)
    content.require_enabled(adapter)
    doc = require_log(adapter, node)
    return adapter, doc


def json_body() -> dict:
    """The request's JSON object; empty when the body is missing, unreadable or not an object."""
    try:
        body = json.loads(frappe.request.get_data() or b"{}")
    except ValueError:
        return {}

    if not isinstance(body, dict):
        return {}

    return body


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


def state_reply(state: str, **extra: int) -> Response:
    """A frame with no rows that tells the tab what state the document is in."""
    return frame_response({"state": state, "proto": content.PROTOCOL_VERSION, **extra})


def json_response(status: int, body: dict) -> Response:
    text = json.dumps(body)
    return Response(text, status=status, mimetype="application/json")


def node_owner(node: str) -> str | None:
    return frappe.db.get_value("Drive Node", node, "owner")


def touch_body(spec: ContentAdapterSpec, node: str) -> None:
    document_name = frappe.db.get_value(spec.content_type, {spec.node_field: node})
    drive.touch(spec.content_type, document_name)


def version_body(spec: ContentAdapterSpec, node: str) -> None:
    """Store the document's body as an automatic Drive version."""
    drive.take_version(node, kind="auto")


NODES = NodeHooks(owner=node_owner, touch=touch_body, take_version=version_body)

HTTP = HttpOwner(
    owner="content",
    prefix="/api/suite/content/",
    target="suite.composition.content",
    routes=ROUTES,
    strip_owner=False,
)
