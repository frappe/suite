"""Where the HR records come from.

Frappe HR may sit on this site or on another one. Both are read through the same three
questions — the holiday lists, their holidays, and the active employees — so the sync
never has to know which it is talking to.
"""

from urllib.parse import urlparse

import frappe
import requests
from frappe import _

EMPLOYEE_FIELDS = [
    "name",
    "employee_name",
    "user_id",
    "company",
    "holiday_list",
    "date_of_birth",
    "date_of_joining",
]

# One page for a company's employees and its holiday lists: both are in the hundreds at most,
# and a run that silently stopped at 20 would delete every event past the cut as no longer in HR.
PAGE_LENGTH = 5000

TIMEOUT = (10, 60)


class HRSource:
    """Reads Frappe HR, on this site or over its REST API."""

    def __init__(
        self, site_url: str | None = None, api_key: str | None = None, api_secret: str | None = None
    ):
        # Checked before anything is kept, so a throw from here carries no credentials in the
        # frame it is raised from: a failing job's variables are written to the Error Log.
        site_url = validate_site_url(site_url)
        if site_url and not (api_key and api_secret):
            frappe.throw(_("An API key and secret are needed to read HR on another site."))
        if not site_url and not frappe.db.exists("DocType", "Employee"):
            frappe.throw(_("Frappe HR is not installed on this site. Enter the HR site's URL."))

        self.site_url = site_url
        # Held as the header it becomes, never as a local anywhere a traceback would print it.
        self._authorization = f"token {api_key}:{api_secret}" if site_url else ""

    def employees(self) -> list[dict]:
        """Every active employee, with the dates the calendars are built from."""

        return self._list("Employee", EMPLOYEE_FIELDS, {"status": "Active"})

    def holiday_lists(self) -> list[str]:
        return [row["name"] for row in self._list("Holiday List", ["name"], {})]

    def holidays(self, holiday_list: str) -> list[dict]:
        """The holidays in one list, as its child table holds them."""

        return self._doc("Holiday List", holiday_list).get("holidays") or []

    def default_holiday_list(self, company: str) -> str | None:
        """What an employee with no list of their own follows."""

        return self._doc("Company", company).get("default_holiday_list")

    def _list(self, doctype: str, fields: list[str], filters: dict) -> list[dict]:
        if not self.site_url:
            return frappe.get_all(doctype, filters=filters, fields=fields, limit_page_length=PAGE_LENGTH)

        return self._get(
            f"/api/resource/{doctype}",
            {
                "fields": frappe.as_json(fields),
                "filters": frappe.as_json([[key, "=", value] for key, value in filters.items()]),
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
            )
        except requests.RequestException as e:
            # `from None`: reported without the request library's own frames, which hold the
            # header the key is in.
            reason = type(e).__name__
            raise frappe.ValidationError(_("The HR site could not be reached: {0}").format(reason)) from None

        if response.status_code in (401, 403):
            frappe.throw(
                _("The HR site refused the request: the API key cannot read {0}.").format(path.split("/")[3])
            )
        if response.status_code >= 400:
            frappe.throw(_("The HR site answered {0} for {1}.").format(response.status_code, path))

        return response.json()["data"]


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
    if parsed.username or parsed.password or parsed.path or parsed.query:
        frappe.throw(_("The HR site URL is the site alone — no path, query or credentials."))
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
        frappe.throw(_("The HR site must be reached over https."))

    return site_url
