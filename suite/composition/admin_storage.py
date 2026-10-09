"""Join public Mail/Drive accounting with the site's business storage policy."""

import json

from frappe.utils import get_datetime, now_datetime

from suite import drive, mail
from suite.suite_core.administration import list_users, require_admin
from suite.suite_core.storage import effective_limit, state
from suite.suite_core.utils import is_suite_cloud_configured


def report(*, refresh: bool = False) -> dict:
    require_admin()
    doc, policy, cached = state(lock=True)
    cloud = is_suite_cloud_configured()
    if cloud and refresh:
        cached = mail.storage_measurements(cached, refresh=refresh)
        doc.measurements = json.dumps(cached)
        doc.save(ignore_permissions=True)
    roots = drive.administration_usage()
    fetched_at = cached.get("fetched_at")
    expired = bool(fetched_at and (now_datetime() - get_datetime(fetched_at)).total_seconds() >= 21600)
    users = []
    for user in list_users():
        personal = [row for row in roots if row["user"] == user["name"] and row["kind"] == "Personal"]
        stored = sum(row["stored_bytes"] for row in personal)
        reserved = sum(row["reserved_bytes"] for row in personal)
        mail_bytes = cached.get("personal", {}).get(user["name"]) if cloud else 0
        limit = policy.get("users", {}).get(user["name"], {})
        timestamp = (
            cached.get("entries", {}).get(user.get("account"), {}).get("fetched_at") if cloud else None
        )
        users.append(
            {
                **user,
                "drive_bytes": stored,
                "reserved_bytes": reserved,
                "mail_bytes": mail_bytes,
                "combined_bytes": None if mail_bytes is None else stored + mail_bytes,
                "cap_bytes": limit.get("cap"),
                "buffer": bool(limit.get("buffer")),
                "effective_cap_bytes": effective_limit(limit.get("cap"), bool(limit.get("buffer"))),
                "mail_fetched_at": timestamp,
            }
        )
    stored = sum(row["stored_bytes"] for row in roots)
    mail_bytes = cached.get("site_mail") if cloud else 0
    allowance = cached.get("allowance") if cloud else None
    return {
        "cloud": cloud,
        "drive_bytes": stored,
        "personal_drive_bytes": sum(row["stored_bytes"] for row in roots if row["kind"] == "Personal"),
        "shared_drive_bytes": sum(row["stored_bytes"] for row in roots if row["kind"] == "Shared"),
        "group_mail_bytes": cached.get("group_mail") if cloud else None,
        "pending_invitations": mail.administration_invitation_count() if cloud else 0,
        "reserved_bytes": sum(row["reserved_bytes"] for row in roots),
        "mail_bytes": mail_bytes,
        "combined_bytes": None if mail_bytes is None else stored + mail_bytes,
        "allowance_bytes": allowance,
        "effective_allowance_bytes": effective_limit(allowance, True) if allowance else None,
        "stale": bool(cached.get("stale")) or expired,
        "fetched_at": cached.get("fetched_at"),
        "default_cap_bytes": policy.get("default_cap"),
        "users": users,
        "roots": roots,
    }
