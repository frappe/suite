"""Bulk provider Mail measurements, retaining old entries on partial failure (admin spec §7)."""

from decimal import Decimal

import frappe
from frappe.utils import get_datetime, now_datetime

from suite.mail.directory import get_account_email
from suite.mail.suite_cloud import get_client

TTL_SECONDS = 6 * 60 * 60


def measurements(previous: dict, *, refresh: bool = False) -> dict:
    now = now_datetime()
    fetched = previous.get("fetched_at")
    if (
        not refresh
        and not previous.get("stale")
        and fetched
        and (now - get_datetime(fetched)).total_seconds() < TTL_SECONDS
    ):
        return previous
    result = {**previous, "attempted_at": now.isoformat(), "stale": False}
    entries = dict(previous.get("entries", {}))
    try:
        client = get_client()
        accounts = _inventory(client, "mail.accounts.list_accounts")
        emails = [row.get("email") or row["name"] for row in accounts]
        if any(email not in entries for email in emails):
            result["site_mail"] = None
        groups = _inventory(client, "mail.groups.list_groups")
        group_emails = [row.get("email") or row["name"] for row in groups]
        if any(email not in entries for email in group_emails):
            result["site_mail"] = None
        site = client.call("site.ping")
        cap = site.get("limits", {}).get("max_disk_gb")
        if cap is not None:
            value = Decimal(str(cap))
            if not value.is_finite() or value < 0:
                raise frappe.ValidationError("Invalid provider storage allowance")
            result["allowance"] = int(value * 1_000_000_000)
        else:
            result["stale"] = True
        due = [
            email
            for email in emails
            if refresh
            or not entries.get(email, {}).get("fetched_at")
            or (now - get_datetime(entries[email]["fetched_at"])).total_seconds() >= TTL_SECONDS
        ]
        for start in range(0, len(due), 500):
            try:
                values = client.call("mail.accounts.get_quotas", emails=due[start : start + 500])
            except Exception:
                values = {}
            for email in due[start : start + 500]:
                _record(entries, email, values.get(email, {}).get("used_disk_bytes"), now, result)
        for email in group_emails:
            fetched = entries.get(email, {}).get("fetched_at")
            if not refresh and fetched and (now - get_datetime(fetched)).total_seconds() < TTL_SECONDS:
                continue
            try:
                value = client.call("mail.groups.get_group", email=email).get("used_disk_bytes")
            except Exception:
                value = None
            _record(entries, email, value, now, result)
        inventory = emails + group_emails
        # Remove deleted identities only after a successful full inventory fetch.
        entries = {email: entries[email] for email in inventory if email in entries}
        result["site_mail"] = (
            sum(entries[email]["bytes"] for email in inventory)
            if all(email in entries for email in inventory)
            else None
        )
        personal = {}
        for user in frappe.get_all("User Settings", pluck="user"):
            email = get_account_email(user)
            if email:
                personal[user] = entries.get(email, {}).get("bytes")
        result.update(entries=entries, personal=personal, inventory=inventory)
        result["group_mail"] = (
            sum(entries[email]["bytes"] for email in group_emails)
            if all(email in entries for email in group_emails)
            else None
        )
        result["fetched_at"] = min(
            (entry["fetched_at"] for entry in entries.values()), default=now.isoformat()
        )
    except Exception:
        result["stale"] = True
        frappe.log_error(title="Suite Mail storage refresh failed", message=frappe.get_traceback())
    return result


def _inventory(client, method: str) -> list[dict]:
    rows = []
    while True:
        page = client.call(method, start=len(rows), limit=200)
        items = page.get("items", [])
        rows.extend(items)
        if len(rows) >= page.get("total", len(rows)):
            return rows
        if not items:
            raise frappe.ValidationError("Incomplete Mail inventory")


def _record(entries, email, value, now, result):
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        entries[email] = {"bytes": value, "fetched_at": now.isoformat()}
    else:
        result["stale"] = True
