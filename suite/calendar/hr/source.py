"""Where the HR records come from.

Frappe HR may sit on this site or on another one. Both are read through the same three
questions — the holiday lists, their holidays, and the active employees — so the sync
never has to know which it is talking to.

A note on what is *not* in this file's frames. Frappe writes a failing background job's
traceback to the Error Log with every frame's variables, and its redaction goes by exact
variable name, which `api_key` and `api_secret` are not. So the credentials never appear here
as a parameter or a local: the source is handed a callable that produces the Authorization
header, keeps the result as an attribute, and has a `__repr__` that prints neither.
"""

import json
from collections.abc import Callable
from urllib.parse import urlparse

import frappe
import requests
from frappe import _

EMPLOYEE_FIELDS = [
    "name",
    "employee_name",
    "user_id",
    "company",
    "date_of_birth",
    "date_of_joining",
]

ASSIGNMENT_FIELDS = ["assigned_to", "holiday_list", "from_date"]

# Read in pages of this, to the end: a run that silently stopped at 20 would delete every event
# past the cut as no longer in HR, and assignments gather by the year.
PAGE_LENGTH = 5000

TIMEOUT = (10, 60)

# The most an answer from the HR site may weigh. The site is somebody else's server: an answer
# without end is not one this worker should read to the end of.
MAX_RESPONSE_BYTES = 25 * 1024 * 1024


class HRSource:
    """Reads Frappe HR, on this site or over its REST API."""

    def __init__(self, site_url: str | None = None, authorization: Callable[[], str] | None = None):
        site_url = validate_site_url(site_url)
        # Holiday List Assignment rather than Employee: ERPNext alone has employees, and a Frappe HR
        # from before 16 has no assignments to say who follows which holiday list.
        if not site_url and not frappe.db.exists("DocType", "Holiday List Assignment"):
            frappe.throw(_("Frappe HR 16 or later is not installed on this site. Enter the HR site's URL."))

        self.site_url = site_url
        self._authorization = authorization() if site_url and authorization else ""
        if site_url and not self._authorization:
            frappe.throw(_("An API key and secret are needed to read HR on another site."))

    def __repr__(self) -> str:
        # getattr: a traceback may print this before __init__ has finished.
        return f"<HRSource {getattr(self, 'site_url', None) or 'this site'}>"

    def employees(self) -> list[dict]:
        """Every active employee, with the dates the calendars are built from."""

        return self._list("Employee", EMPLOYEE_FIELDS, {"status": "Active"})

    def holiday_lists(self) -> list[str]:
        return [row["name"] for row in self._list("Holiday List", ["name"], {})]

    def holidays(self, holiday_list: str) -> list[dict]:
        """The holidays in one list, as its child table holds them."""

        return self._doc("Holiday List", holiday_list).get("holidays") or []

    def holiday_list_assignments(self) -> list[dict]:
        """Who follows which holiday list from when, as submitted. Frappe HR reads nothing else:
        the holiday list on an employee and the default on a company are fields it has left
        behind, so they are not asked for here either."""

        return self._list("Holiday List Assignment", ASSIGNMENT_FIELDS, {"docstatus": 1})

    def _list(self, doctype: str, fields: list[str], filters: dict) -> list[dict]:
        rows: list[dict] = []
        while True:
            page = self._page(doctype, fields, filters, len(rows))
            rows += page
            if len(page) < PAGE_LENGTH:
                return rows

    def _page(self, doctype: str, fields: list[str], filters: dict, start: int) -> list[dict]:
        if not self.site_url:
            return frappe.get_all(
                doctype,
                filters=filters,
                fields=fields,
                order_by="name asc",
                limit_start=start,
                limit_page_length=PAGE_LENGTH,
            )

        return self._get(
            f"/api/resource/{doctype}",
            {
                "fields": frappe.as_json(fields),
                "filters": frappe.as_json([[key, "=", value] for key, value in filters.items()]),
                "order_by": "name asc",
                "limit_start": start,
                "limit_page_length": PAGE_LENGTH,
            },
        )

    def _doc(self, doctype: str, name: str) -> dict:
        if not self.site_url:
            return frappe.get_doc(doctype, name).as_dict()

        return self._get(f"/api/resource/{doctype}/{name}", {})

    def _get(self, path: str, params: dict) -> dict | list:
        try:
            response = requests.get(
                f"{self.site_url}{path}",
                params=params,
                headers={"Authorization": self._authorization},
                timeout=TIMEOUT,
                # A redirect is the HR site sending this server somewhere else — an address on the
                # inside network, say. The API answers in place, so none is followed.
                allow_redirects=False,
                stream=True,
            )
            body = response.raw.read(MAX_RESPONSE_BYTES + 1, decode_content=True)
        except Exception as e:
            # `from None`, and everything: reported without the request library's own frames,
            # which hold the header the key is in.
            reason = type(e).__name__
            raise frappe.ValidationError(_("The HR site could not be reached: {0}").format(reason)) from None

        if response.status_code in (401, 403):
            frappe.throw(
                _("The HR site refused the request: the API key cannot read {0}.").format(path.split("/")[3])
            )
        if response.status_code != 200:
            frappe.throw(_("The HR site answered {0} for {1}.").format(response.status_code, path))
        if len(body) > MAX_RESPONSE_BYTES:
            frappe.throw(_("The HR site's answer for {0} is too large to be one.").format(path))

        try:
            return json.loads(body)["data"]
        except Exception:
            raise frappe.ValidationError(
                _("The HR site's answer for {0} is not Frappe's.").format(path)
            ) from None


def validate_site_url(site_url: str | None) -> str:
    """The HR site, as a plain https URL.

    Anything else is refused rather than handed to the request library: the address is typed by an
    administrator, and a sync that followed a `file://` URL, or one carrying its own credentials,
    would be a way to read what this server can reach rather than what HR holds.
    """

    site_url = (site_url or "").strip().rstrip("/")
    if not site_url:
        return ""

    parsed = urlparse(site_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        frappe.throw(_("The HR site URL must start with https:// and name a host."))
    if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        frappe.throw(_("The HR site URL is the site alone — no path, query or credentials."))
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
        frappe.throw(_("The HR site must be reached over https."))

    return site_url
