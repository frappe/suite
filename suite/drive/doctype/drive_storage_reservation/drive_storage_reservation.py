import frappe
from frappe import _
from frappe.model.document import Document


class DriveStorageReservation(Document):
    """Bytes promised to a Drive Root and not yet stored (spec section 3.12)."""

    def validate(self):
        if isinstance(self.reserved_bytes, bool) or not isinstance(self.reserved_bytes, int):
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
        if self.reserved_bytes < 0:
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
        if not self.is_new():
            previous = self.get_doc_before_save()
            if previous and previous.root != self.root:
                frappe.throw(_("A storage reservation cannot move between roots"))
