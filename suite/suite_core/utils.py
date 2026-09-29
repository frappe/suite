from typing import Any

import frappe
from frappe import _
from frappe.utils.caching import request_cache

SUITE_CLOUD_CONFIG_KEYS = ("suite_cloud_url", "site_api_key", "site_api_secret")


@request_cache
def get_suite_cloud_config(key: str | tuple[str, ...] | None = None) -> dict[str, Any] | tuple | Any:
    """Where this site's Suite Cloud is and how the site authenticates to it.

    Suite Settings wins; a value it leaves blank falls back to the site config key of the same
    name, where Frappe Cloud writes it when it registers the site. Cached per request: the
    returned dict is shared, so callers must treat it as read-only.
    """

    settings = frappe.get_cached_doc("Suite Settings")
    config = {}
    for field in SUITE_CLOUD_CONFIG_KEYS:
        value = settings.get(field)
        if value and field == "site_api_secret":
            value = settings.get_password(field)
        config[field] = value or frappe.conf.get(field)

    if not key:
        return config

    keys = (key,) if isinstance(key, str) else key
    for k in keys:
        if k not in config:
            frappe.throw(_("Suite Cloud config key '{0}' not found").format(k))

    return tuple(config[k] for k in keys) if len(keys) > 1 else config[keys[0]]


def is_suite_cloud_configured(raise_exception: bool = False) -> bool:
    """Whether the site knows where its Suite Cloud is and how to authenticate to it."""

    if all(get_suite_cloud_config().values()):
        return True
    if raise_exception:
        frappe.throw(_("Suite Cloud is not configured. Please check your Suite Settings."))
    return False
