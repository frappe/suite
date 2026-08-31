import frappe
from frappe import _
from frappe.model.document import Document


class DriveStorageReservation(Document):
    def validate(self):
        if isinstance(self.reserved_bytes, bool) or not isinstance(self.reserved_bytes, int):
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
        if self.reserved_bytes < 0:
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
