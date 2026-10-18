import frappe
from frappe import _
from frappe.model.document import Document

from suite.suite_core.content.adapters import adapters


class SuiteCollabSettings(Document):
    def validate(self):
        known = adapters()
        seen: set[str] = set()
        for row in self.apps:
            if row.adapter not in known:
                frappe.throw(
                    _("No app named {0} keeps its documents in the content layer").format(row.adapter)
                )

            if row.adapter in seen:
                frappe.throw(_("{0} has more than one row").format(row.adapter))

            seen.add(row.adapter)
