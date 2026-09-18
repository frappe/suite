"""Where the HR records come from.

Frappe HR may sit on this site or on another one. Both are read through the same three
questions — the holiday lists, their holidays, and the active employees — so the sync
never has to know which it is talking to.
"""

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
        self.site_url = (site_url or "").rstrip("/")
        self.api_key = api_key
        self.api_secret = api_secret

        if self.site_url and not (self.api_key and self.api_secret):
            frappe.throw(_("An API key and secret are needed to read HR on another site."))
        if not self.site_url and not frappe.db.exists("DocType", "Employee"):
            frappe.throw(_("Frappe HR is not installed on this site. Enter the HR site's URL."))

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
        response = requests.get(
            f"{self.site_url}{path}",
            params=params,
            headers={"Authorization": f"token {self.api_key}:{self.api_secret}"},
            timeout=TIMEOUT,
        )
        if response.status_code == 403:
            frappe.throw(
                _("The HR site refused the request: the API key cannot read {0}.").format(path.split("/")[3])
            )
        response.raise_for_status()
        return response.json()["data"]
