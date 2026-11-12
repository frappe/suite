from typing import Any

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils.caching import request_cache

SUITE_CLOUD_CONFIG_KEYS = ("suite_cloud_url", "suite_cloud_tenant", "suite_cloud_secret")


@request_cache
def get_suite_cloud_config(key: str | tuple[str, ...] | None = None) -> dict[str, Any] | tuple | Any:
    """Where this site's Suite Cloud is and how the site authenticates to it.

    Suite Settings wins; a value it leaves blank falls back to the site config key of the same
    name, where Frappe Cloud writes it when it registers the site. The secret is read only when
    asked for, and comes back empty if it can't be read. Cached per request: the returned dict
    is shared, so callers must treat it as read-only.
    """

    keys = key or SUITE_CLOUD_CONFIG_KEYS
    if isinstance(keys, str):
        keys = (keys,)

    for field in keys:
        if field not in SUITE_CLOUD_CONFIG_KEYS:
            frappe.throw(_("Suite Cloud config key '{0}' not found").format(field))

    settings = frappe.get_cached_doc("Suite Settings")
    config = {}
    for field in keys:
        value = settings.get(field)
        if value and field == "suite_cloud_secret":
            value = read_stored_secret(settings)

        config[field] = value or frappe.conf.get(field)

    if not key:
        return config

    if len(keys) == 1:
        return config[keys[0]]

    return tuple(config[field] for field in keys)


def read_stored_secret(settings: Document) -> str | None:
    """None when the row is gone or the encryption key can't open it, with no message for the user."""

    muted = frappe.flags.mute_messages
    frappe.flags.mute_messages = True
    try:
        return settings.get_password("suite_cloud_secret", raise_exception=False)
    except ValueError:
        # A malformed encryption key
        return None
    finally:
        frappe.flags.mute_messages = muted


def is_suite_cloud_configured(raise_exception: bool = False) -> bool:
    """Whether the site has a Suite Cloud: every value is set, whether or not the secret can be read."""

    # A developer-mode site can stand in a local fake for Suite Cloud (suite.mail.dev_suite_cloud).
    if frappe.conf.get("suite_cloud_fake") and frappe.conf.get("developer_mode"):
        return True

    settings = frappe.get_cached_doc("Suite Settings")
    if all(settings.get(field) or frappe.conf.get(field) for field in SUITE_CLOUD_CONFIG_KEYS):
        return True
    if raise_exception:
        frappe.throw(_("Suite Cloud is not configured. Please check your Suite Settings."))
    return False
