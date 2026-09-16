"""Tests for the `/api/suite/drive/` namespace.

Two kinds live here. `test_translator`, `test_shapes`, and `test_routes` need
no site and no database: they run the real rewrite over a real werkzeug
request, and check the table against the decorators. `test_dispatch` sends
whole HTTP requests through Frappe's WSGI application against a live site.
"""

import contextlib
from collections.abc import Iterator
from typing import Any

import frappe


def ensure_local_context() -> None:
    """Bind `frappe.local` for a site-free run.

    `bench run-tests` has already done this. A bare `python -m unittest` from
    the bench's `sites` directory has not, and `frappe.throw` reads
    `frappe.flags` before it raises.
    """
    if not getattr(frappe.local, "initialised", False):
        frappe.init(site="")


@contextlib.contextmanager
def local_attribute(name: str, value: Any) -> Iterator[Any]:
    """Set one name on `frappe.local`, and put the store back after.

    `patch.object(frappe.local, name, value, create=True)` must not be used for
    this. `frappe.local` is a contextvar store with `__slots__ = ()`, so `mock`
    cannot read the name out of a `__dict__`, marks it non-local, and on exit
    deletes it instead of restoring it - `create=True` switches off the branch
    that would put the old value back. Deleting `db` that way unbinds
    `frappe.db` for the rest of the process, and `bench run-tests` then raises
    "object is not bound" in its own cleanup, after every test has passed.
    """
    missing = object()
    kept = getattr(frappe.local, name, missing)
    setattr(frappe.local, name, value)
    try:
        yield value
    finally:
        if kept is missing:
            delattr(frappe.local, name)
        else:
            setattr(frappe.local, name, kept)
