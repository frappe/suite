"""The content layer's routes: /api/suite/content/{node}/..., where the node's Drive type picks the app.

Bodies and answers are binary frames, so these handlers answer with their own
responses instead of the JSON envelope. Every request names the user the
tab expects, and that is checked before Drive is asked, so an expired sign-in
answers `signed_out` rather than a permission verdict. Guests are heard for
the same reason, but only to read: guest editing waits for stage G.
"""

import json
from collections.abc import Callable

import frappe
from frappe import _
from werkzeug.wrappers import Response

from suite import content, drive
from suite.composition.http import Route
from suite.content import editors

# Every row reads or writes its own bytes, so each is a stream; a POST answers JSON
ROUTES = (
    Route(
        "GET",
        "{node}/document",
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
        "{node}/stage/{stage_id}/{piece_index}",
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
        "{node}/html",
        "html_post",
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

EXPECTED_USER_HEADER = "X-Expected-User"

DRIVE_REFUSALS = (
    (drive.DriveNotFound, 404, "not_found"),
    (drive.DriveForbidden, 403, "forbidden"),
    (drive.DriveLinkExpired, 403, "link_expired"),
    (drive.DriveLocked, 401, "locked"),
)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def document_get(node: str) -> Response:
    """Answer the document as it stands, and whether this user can edit it."""

    def answer() -> bytes:
        app = authorize_node(node, drive.READ, frappe.get_request_header(EXPECTED_USER_HEADER))
        can_write = frappe.session.user != "Guest" and can_access(node, drive.EDIT)
        return content.open_document(app, node, can_write=can_write)

    return respond_or_refuse(answer)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def updates_get(node: str, since_rev: str | None = None, q_epoch: str | None = None) -> Response:
    """Answer the rows after `since_rev`."""
    return respond_or_refuse(
        lambda: content.pull_rows(authorized(node, drive.READ), node, since_rev, q_epoch)
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def updates_post(node: str) -> Response:
    """Push the tab's rows, once the user its push names may edit the node."""

    def authorize(expected_user: object) -> str:
        return authorize_node(node, drive.EDIT, expected_user)

    return respond_or_refuse(lambda: content.push_rows(node, frappe.request.get_data(), authorize))


@frappe.whitelist(allow_guest=True, methods=["PUT"])
def stage_put(node: str, stage_id: str, piece_index: str) -> Response:
    """Stage one piece of a change too big for one push."""
    return respond_or_refuse(
        lambda: content.stage_piece(
            authorized(node, drive.EDIT), node, stage_id, piece_index, frappe.request.get_data()
        )
    )


@frappe.whitelist(allow_guest=True, methods=["POST"])
def sessions_post(node: str) -> Response:
    """Start or resume the tab's writing session."""
    return respond_or_refuse(lambda: content.start_session(authorized(node, drive.EDIT), node, json_body()))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def suspect_post(node: str) -> Response:
    """Report a row the tab couldn't apply."""
    return respond_or_refuse(lambda: content.report_suspect(authorized(node, drive.READ), node, json_body()))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def html_post(node: str) -> Response:
    """Take the tab's render of the document as its readable copy."""
    return respond_or_refuse(lambda: content.submit_render(authorized(node, drive.EDIT), node, json_body()))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def restore_post(node: str) -> Response:
    """Begin restoring the document to a version."""
    return respond_or_refuse(lambda: content.begin_restore(authorized(node, drive.EDIT), node, json_body()))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def restore_cancel_post(node: str) -> Response:
    """Cancel the restore in progress."""
    return respond_or_refuse(lambda: content.cancel_restore(authorized(node, drive.EDIT), node, json_body()))


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    """Answer an address no route names as not found."""
    raise frappe.DoesNotExistError(_("That content address does not exist"))


def authorized(node: str, role: int) -> str:
    """Return the node's app, once the tab's sign-in and its access to the node are checked."""
    return authorize_node(node, role, frappe.get_request_header(EXPECTED_USER_HEADER))


def json_body() -> dict:
    """Read the request's JSON object; empty when the body is missing, unreadable or not an object."""
    try:
        body = json.loads(frappe.request.get_data() or b"{}")
    except ValueError:
        return {}

    if not isinstance(body, dict):
        return {}

    return body


def authorize_node(node: str, role: int, expected_user: object) -> str:
    """Check the user, an edit sign-in, then Drive's access, which answers the node's type, and return its app."""
    require_expected_user(expected_user)
    if role == drive.EDIT and frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")

    spec = editors.for_type(check_drive_access(node, role))
    if spec is None:
        raise content.Refusal(404, "not_found")

    return spec.app


def refusal_for(error: drive.DriveError) -> content.Refusal | None:
    """Return the refusal a tab gets for Drive's `error`, or None when it has none."""
    for kind, status, reason in DRIVE_REFUSALS:
        if isinstance(error, kind):
            return content.Refusal(status, reason)

    return None


def check_drive_access(node: str, role: int) -> str | None:
    """Refuse the request unless Drive lets this user take `role` on the node; answer its content doctype."""
    try:
        return drive.check(node, role)
    except drive.DriveError as error:
        refusal = refusal_for(error)
        if refusal is None:
            raise

        raise refusal from None


def can_access(node: str, role: int) -> bool:
    """Whether Drive lets this user take `role` on the node."""
    try:
        check_drive_access(node, role)
    except (content.Refusal, drive.DriveError):
        return False

    return True


def require_expected_user(expected_user: object) -> None:
    """Refuse a tab whose user isn't the one signed in: signed out, or changed."""
    if expected_user == frappe.session.user:
        return

    if frappe.session.user == "Guest":
        raise content.Refusal(401, "signed_out")

    raise content.Refusal(409, "user_changed")


def respond_or_refuse(answer: Callable[[], bytes | tuple[int, dict]]) -> Response:
    """`answer`'s frame, or its status and JSON body, as the response; a refusal as its own."""
    try:
        reply = answer()
    except content.Refusal as refusal:
        return json_response(refusal.status, refusal.body)

    if isinstance(reply, bytes):
        return Response(reply, status=200, mimetype="application/octet-stream")

    status, body = reply
    return json_response(status, body)


def json_response(status: int, body: dict) -> Response:
    """Answer `body` as JSON with `status`."""
    text = json.dumps(body)
    return Response(text, status=status, mimetype="application/json")
