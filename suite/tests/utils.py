# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from contextlib import contextmanager

import frappe


def ensure_user(email):
    if not frappe.db.exists("User", email):
        frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "send_welcome_email": 0,
            }
        ).insert(ignore_permissions=True)


@contextmanager
def stub_db(db):
    """Bind `frappe.local.db` to `db` and restore the previous binding.

    `frappe.local` keeps its attributes in a thread-local store, not in
    `__dict__`, so `unittest.mock.patch.object` cannot restore them: it deletes
    the attribute on exit and leaves `frappe.db` unbound for every later test.
    """
    missing = object()
    previous = getattr(frappe.local, "db", missing)
    frappe.local.db = db
    try:
        yield db
    finally:
        if previous is missing:
            try:
                del frappe.local.db
            except AttributeError:
                pass
        else:
            frappe.local.db = previous
