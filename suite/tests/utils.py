# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from contextlib import contextmanager, suppress

import frappe
from frappe.utils.logging import connection_for

# A `frappe.local` name that was not bound, told apart from one bound to None
ABSENT = object()


# Error Logs live in the log database, which commits apart from `frappe.db`
def delete_error_logs(filters) -> None:
    log_db = connection_for("Error Log")
    log_db.delete("Error Log", filters)
    log_db.commit()


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
    previous = getattr(frappe.local, "db", ABSENT)
    frappe.local.db = db
    try:
        yield db
    finally:
        if previous is ABSENT:
            try:
                del frappe.local.db
            except AttributeError:
                pass
        else:
            frappe.local.db = previous


def session_for(user: str) -> str:
    from frappe.auth import CookieManager, LoginManager
    from frappe.utils import set_request

    kept: dict[str, object] = {}
    for name in ("request", "session", "login_manager", "cookie_manager"):
        kept[name] = getattr(frappe.local, name, ABSENT)

    set_request(path="/")
    try:
        frappe.local.cookie_manager = CookieManager()
        frappe.local.login_manager = LoginManager()
        frappe.local.login_manager.login_as(user)
        sid = frappe.session.sid
    finally:
        for name, value in kept.items():
            restore_local(name, value)

    frappe.db.commit()
    return sid


def restore_local(name: str, value: object) -> None:
    if value is not ABSENT:
        setattr(frappe.local, name, value)
        return

    # `frappe.local` is a contextvar store, so deleting a name it never held raises
    with suppress(AttributeError):
        delattr(frappe.local, name)
