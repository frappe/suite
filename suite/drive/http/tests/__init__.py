"""Tests for the `/api/suite/drive/` namespace.

Two kinds live here. `test_translator`, `test_shapes`, and `test_routes` need
no site and no database: they run the real rewrite over a real werkzeug
request, and check the table against the decorators. `test_dispatch` sends
whole HTTP requests through Frappe's WSGI application against a live site.
"""

import frappe


def ensure_local_context() -> None:
    """Bind `frappe.local` for a site-free run.

    `bench run-tests` has already done this. A bare `python -m unittest` from
    the bench's `sites` directory has not, and `frappe.throw` reads
    `frappe.flags` before it raises.
    """
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")
