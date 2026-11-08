import io
from contextlib import contextmanager

import frappe
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.tests.utils import ABSENT, restore_local


@contextmanager
def upload_request(content: bytes, filename: str, **form):
    """Make `content` the multipart body of the current request, as compose sends it.

    `upload_file` is rate limited by IP, as a browser request would be, so the
    request carries one.
    """
    kept = {name: getattr(frappe.local, name, ABSENT) for name in ("request", "form_dict", "request_ip")}
    builder = EnvironBuilder(
        method="POST",
        data={"file": (io.BytesIO(content), filename), "is_private": "1", "folder": "Home", **form},
    )
    frappe.local.request = Request(builder.get_environ())
    frappe.local.form_dict = frappe._dict({"is_private": "1", "folder": "Home", **form})
    frappe.local.request_ip = "127.0.0.1"
    try:
        yield
    finally:
        for name, value in kept.items():
            restore_local(name, value)
