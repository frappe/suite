import frappe
from frappe import _
from frappe.model.document import Document


class DriveStorageReservation(Document):
    """Bytes promised to a Drive Root and not yet stored.

    Spec section 3.12 makes `root` reqd and drops `storage_owner`. Both stay
    optional through the expand phase instead: the backfill patch that moves
    every row from `storage_owner` to `root` is registered post-model-sync, so
    it can only read the legacy column if model sync leaves it in place. The
    XOR below is what enforces "exactly one accounting owner" until Cleanup
    drops `storage_owner` and marks `root` reqd.
    """

    def validate(self):
        if bool(self.root) == bool(self.storage_owner):
            frappe.throw(_("A reservation must name exactly one Drive root or legacy storage owner"))
        if isinstance(self.reserved_bytes, bool) or not isinstance(self.reserved_bytes, int):
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
        if self.reserved_bytes < 0:
            frappe.throw(_("Reserved bytes must be a nonnegative integer"))
        if not self.is_new():
            previous = self.get_doc_before_save()
            if previous and any(
                previous.get(field) != self.get(field) for field in ("root", "storage_owner")
            ):
                frappe.throw(_("A storage reservation cannot move between accounting owners"))
