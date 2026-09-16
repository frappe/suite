import os

import frappe
import requests
from frappe.rate_limiter import rate_limit
from frappe.utils import now


def mark_as_viewed(entity):
    if (
        frappe.session.user == "Guest"
        or not frappe.has_permission(doctype="Drive Recent", ptype="create", user=frappe.session.user)
        or entity.is_folder
    ):
        return

    recent = frappe.db.get_value("Drive Recent", {"node": entity.name, "user": frappe.session.user})
    if recent:
        frappe.db.set_value("Drive Recent", recent, "opened_at", now(), update_modified=False)
        return
    doc = frappe.new_doc("Drive Recent")
    doc.node = entity.name
    doc.user = frappe.session.user
    doc.opened_at = now()
    # §3.9 makes `node` a Link to `Drive Node`, and §14.3 gives the node the
    # `File` id, so the value is right either way. The link check is skipped
    # because §10.2 keeps a content type's legacy rows working while that
    # type is expanding: `shims._legacy_visit` records the open of a `File`
    # that no node holds yet, and an open must not fail because Build has
    # not reached it.
    doc.flags.ignore_links = True
    doc.insert()
    return doc


def get_country_info():
    ip = frappe.local.request_ip

    def _get_country_info():
        fields = [
            "status",
            "message",
            "continent",
            "continentCode",
            "country",
            "countryCode",
            "region",
            "regionName",
            "city",
            "district",
            "zip",
            "lat",
            "lon",
            "timezone",
            "offset",
            "currency",
            "isp",
            "org",
            "as",
            "asname",
            "reverse",
            "mobile",
            "proxy",
            "hosting",
            "query",
        ]

        try:
            res = requests.get(f"https://pro.ip-api.com/json/{ip}?fields={','.join(fields)}")
            data = res.json()
            if data.get("status") != "fail":
                return data
        except Exception:
            pass

        return {}

    return frappe.cache().hget("ip_country_map", ip, generator=_get_country_info)


def create_drive_settings(user, method: str | None = None) -> None:
    """Create Drive Settings and the private user folder for a newly created User."""
    from suite.drive.utils import get_user_folder

    if user.flags.get("skip_drive_setup"):
        return

    if not user.name or user.name in ("Guest", "Administrator"):
        return

    get_user_folder(user.name)
