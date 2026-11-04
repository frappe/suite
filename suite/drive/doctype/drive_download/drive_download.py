from frappe.model.document import Document


class DriveDownload(Document):
    """One person's zip of Drive nodes, built in the background and kept for a day."""
