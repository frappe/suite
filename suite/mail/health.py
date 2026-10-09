"""Preserve access through outages; distinguish explicit provider suspension from failure."""

import frappe
from frappe import _
from frappe.utils import now_datetime

from suite.mail.directory import get_domains
from suite.mail.suite_cloud import get_client
from suite.suite_core.utils import is_suite_cloud_configured


def status(*, refresh: bool = False, domains: bool = False) -> dict:
    if not is_suite_cloud_configured():
        return {"cloud": False, "suspended": False, "stale": False, "fetched_at": None, "alerts": []}
    cached = frappe.cache.get_value("suite:provider_health") or {}
    if refresh or not frappe.cache.get_value("suite:provider_health_attempt"):
        frappe.cache.set_value("suite:provider_health_attempt", True, expires_in_sec=60)
        try:
            get_client().call("site.ping")
        except Exception:
            cached["stale"] = True
        else:
            cached.update(stale=False, fetched_at=now_datetime().isoformat())
        frappe.cache.set_value("suite:provider_health", cached)
    alerts = []
    if cached.get("stale"):
        alerts.append(
            _(
                "Suite Cloud could not be reached. Existing access and last successful measurements are preserved."
            )
        )
    if domains:
        try:
            for domain in get_domains():
                if not domain.get("enabled") or not domain.get("is_verified"):
                    alerts.append(
                        _(
                            "Mail domain {0} needs attention. Review its DNS and verification; Suite login remains available."
                        ).format(domain["domain"])
                    )
        except Exception:
            alerts.append(_("Mail domain health is unavailable. Retry from Admin → Mail → Domains."))
    return {
        "cloud": True,
        "suspended": bool(frappe.cache.get_value("suite:provider_suspended")),
        "stale": bool(cached.get("stale")),
        "fetched_at": cached.get("fetched_at"),
        "alerts": alerts,
    }
