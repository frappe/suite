"""One-time sign-in links, for a person who has no password yet, such as a new site's first Admin.

Opening a link only asks the person to continue; the button spends the key. Email scanners and link
previews open links before the person does, and would otherwise use the key up.
"""

import pickle

import frappe
from frappe import _

PATH = "/api/suite/account/sign-in"


def sign_in_link(user: str, minutes: int = 24 * 60) -> str:
    """Return a link that signs `user` in once and opens Suite. It stops working after `minutes`."""

    if not frappe.db.exists("User", {"name": user, "enabled": 1}):
        raise frappe.DoesNotExistError(_("No active user {0}").format(user))
    key = frappe.generate_hash()
    frappe.cache.set_value(_cache_key(key), user, expires_in_sec=minutes * 60)
    return frappe.utils.get_url(f"{PATH}?key={key}", allow_header_override=False)


def find_sign_in_user(key: str) -> str | None:
    """The user a key from `sign_in_link` signs in, or None when it was used, expired or never made."""

    user = frappe.cache.get_value(_cache_key(key))
    if not user or not frappe.db.exists("User", {"name": user, "enabled": 1}):
        return None
    return user


def use_sign_in_key(key: str) -> str | None:
    """Spend a key from `sign_in_link`: return its user, as `find_sign_in_user` does, and end the key.

    Reading and deleting the key is one Redis GETDEL, so two requests that spend the same key at
    once cannot both get its user.
    """

    redis_key = frappe.cache.make_key(_cache_key(key))
    frappe.local.cache.pop(redis_key, None)
    stored = frappe.cache.getdel(redis_key)
    user = pickle.loads(stored) if stored is not None else None
    if not user or not frappe.db.exists("User", {"name": user, "enabled": 1}):
        return None
    return user


def _cache_key(key: str) -> str:
    return f"suite_sign_in_key:{key}"
