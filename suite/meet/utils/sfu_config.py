# Copyright (c) 2025, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.caching import redis_cache


@redis_cache(ttl=5 * 60)
def get_sfu_config():
    """Normalize site configuration before exposing it in Meet responses."""
    port = frappe.conf.get("sfu_server_port", 3000)
    return {
        "sfu_server_url": frappe.conf.get("sfu_server_url", "http://localhost"),
        "sfu_server_port": int(port) if port is not None else None,
        "sfu_secret": frappe.conf.get("sfu_secret", ""),
    }
