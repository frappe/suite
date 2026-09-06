"""OPTIONS responses.

Answered before authentication: the headers carry no per-user information, and
Windows' WebClient probes OPTIONS before it is willing to send credentials.
Both Allow and the DAV compliance class reflect the admin's method allow-list
— advertising lock support while LOCK is blocked would make clients attempt
locks and fail instead of degrading gracefully.
"""

import frappe
from werkzeug.wrappers import Request, Response

from suite.drive.webdav.settings import allowed_webdav_methods, dav_compliance


def handle(request: Request) -> Response:
    methods = allowed_webdav_methods()
    headers = {
        "Allow": ", ".join(methods),
        "MS-Author-Via": "DAV",
        "Content-Length": "0",
        "Cache-Control": "no-cache",
    }
    # an allow-list too narrow to be class 1 claims no class at all, and a
    # header saying so is worse than no header
    if compliance := dav_compliance(methods):
        headers["DAV"] = compliance
    return Response(status=200, headers=headers)


def advertise_on_root() -> None:
    """Windows probes OPTIONS / before mounting /dav — add the DAV headers to
    frappe's stock empty 200 without short-circuiting the request."""
    if compliance := dav_compliance(allowed_webdav_methods()):
        frappe.local.response_headers["DAV"] = compliance
    frappe.local.response_headers["MS-Author-Via"] = "DAV"
