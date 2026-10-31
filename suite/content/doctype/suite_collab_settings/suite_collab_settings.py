import frappe
from frappe import _
from frappe.model.document import Document

from suite.content import conversions, log
from suite.content.editors import editors


class SuiteCollabSettings(Document):
    def validate(self) -> None:
        """Refuse a row for an app the content layer doesn't know, or a second row for one app."""
        known = editors()
        seen: set[str] = set()
        for row in self.apps:
            if row.app not in known:
                frappe.throw(_("No app named {0} keeps its documents in the content layer").format(row.app))

            if row.app in seen:
                frappe.throw(_("{0} has more than one row").format(row.app))

            seen.add(row.app)

        self.refuse_turning_off(known)

    def refuse_turning_off(self, known: dict) -> None:
        """Refuse turning off, or removing, an app that is always on or whose documents have logs or conversions."""
        before = self.get_doc_before_save()
        if before is None:
            return

        still_on = {row.app for row in self.apps if row.mode == "on"}
        for row in before.apps:
            if row.mode != "on" or row.app in still_on or row.app not in known:
                continue

            if known[row.app].always_on or log.has_logs(row.app) or conversions.conversion_started(row.app):
                frappe.throw(_("Collaboration in {0} can't be turned off").format(row.app))
