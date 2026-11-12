import frappe
from frappe.model.document import Document


class DriveDownload(Document):
    """One person's zip of Drive nodes, built in the background and kept for a day."""

    def autoname(self) -> None:
        # The name is the only secret a share-link download carries, so it is
        # 128 random bits, not a short hash.
        self.name = frappe.generate_hash(length=32)
