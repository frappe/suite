"""Reading Frappe HR on another site, over its REST API.

The sync asks three things of HR: its holiday lists, the holidays in one, and the active
employees. Only this module knows where HR is and how it is reached, so HR on this same site
later is a second reader with the same three methods.
"""

import json
from urllib.parse import quote, urlparse

import frappe
import requests
from frappe import _

EMPLOYEE_FIELDS = ["name", "employee_name", "date_of_birth", "date_of_joining"]

# Read in pages of this, to the end.
PAGE_LENGTH = 5000

TIMEOUT = (10, 60)

# The most an answer from the HR site may weigh. The site is somebody else's server, and an
# answer without end is not one this worker should read to the end of.
MAX_RESPONSE_BYTES = 25 * 1024 * 1024


class HRSource:
    """Frappe HR on `site_url`, read with an `Authorization` header of an API key and secret."""

    def __init__(self, site_url: str | None, authorization: str):
        self.site_url = validate_site_url(site_url)
        if not self.site_url:
            frappe.throw(_("Enter the HR site's URL."))
        if not authorization:
            frappe.throw(_("Enter an API key and secret for the HR site."))
        self.authorization = authorization

    def employees(self) -> list[dict]:
        """Every active employee, with the dates the calendars are made from."""

        return self._list("Employee", EMPLOYEE_FIELDS, {"status": "Active"})

    def holiday_lists(self) -> list[str]:
        return [row["name"] for row in self._list("Holiday List", ["name"], {})]

    def holidays(self, holiday_list: str) -> list[dict]:
        """The holidays in one list, as its child table holds them."""

        # The name is HR's, and goes in as one segment of the path: a list called `../method/x`
        # is asked for by that name, not followed somewhere else on the site.
        path = f"/api/resource/Holiday List/{quote(holiday_list, safe='')}"
        return self._get(path, {}).get("holidays") or []

    def _list(self, doctype: str, fields: list[str], filters: dict) -> list[dict]:
        rows: list[dict] = []
        while True:
            page = self._get(
                f"/api/resource/{doctype}",
                {
                    "fields": frappe.as_json(fields),
                    "filters": frappe.as_json([[key, "=", value] for key, value in filters.items()]),
                    "order_by": "name asc",
                    "limit_start": len(rows),
                    "limit_page_length": PAGE_LENGTH,
                },
            )
            # Until a page comes back empty, not merely short: a site that caps its pages below
            # what was asked would otherwise end the roster early, and everyone past the cut
            # would be removed here as gone from HR.
            if not page:
                return rows
            rows += page

    def _get(self, path: str, params: dict):
        try:
            response = requests.get(
                f"{self.site_url}{path}",
                params=params,
                headers={
                    "Authorization": self.authorization,
                    # Plain, so the cap below is on what arrives: 25 MB compressed can unpack to
                    # gigabytes. An answer that comes compressed anyway is not JSON, and refused.
                    "Accept-Encoding": "identity",
                },
                timeout=TIMEOUT,
                # A redirect is the HR site sending this server somewhere else, an address on the
                # inside network, say. The API answers in place, so none is followed.
                allow_redirects=False,
                stream=True,
            )
            body = response.raw.read(MAX_RESPONSE_BYTES + 1, decode_content=False)
        except requests.RequestException as e:
            frappe.throw(_("The HR site could not be reached: {0}").format(type(e).__name__))

        if response.status_code in (401, 403):
            frappe.throw(_("The HR site refused the API key for {0}.").format(path))
        if response.status_code != 200:
            frappe.throw(_("The HR site answered {0} for {1}.").format(response.status_code, path))
        if len(body) > MAX_RESPONSE_BYTES:
            frappe.throw(_("The HR site's answer for {0} is too large.").format(path))

        try:
            return json.loads(body)["data"]
        except (ValueError, KeyError, TypeError):
            frappe.throw(_("The HR site's answer for {0} is not a Frappe API answer.").format(path))


def validate_site_url(site_url: str | None) -> str:
    """The HR site as a plain https URL, or nothing.

    An administrator types it and this server fetches it, so anything but the site alone is
    refused: a sync that followed a `file://` URL, or one carrying its own credentials, would
    read what this server can reach rather than what HR holds.
    """

    site_url = (site_url or "").strip().rstrip("/")
    if not site_url:
        return ""

    parsed = urlparse(site_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        frappe.throw(_("The HR site URL must start with https:// and name a host."))
    if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        frappe.throw(_("The HR site URL is the site alone: no path, query or credentials."))
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
        frappe.throw(_("The HR site must be reached over https."))

    return site_url
