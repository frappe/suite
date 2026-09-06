import frappe
from frappe import _

from suite.drive._core.errors import DriveForbidden, DriveNotFound
from suite.drive.api.files import get_file_content, get_s3_url


@frappe.whitelist(allow_guest=True)
def fetch(path: str):
    name = frappe.db.get_value("File", {"file_url": get_s3_url(path)})
    if not name:
        frappe.throw(_("Not found"), frappe.DoesNotExistError)
    try:
        return get_file_content(name)
    except (frappe.PermissionError, frappe.DoesNotExistError, DriveForbidden, DriveNotFound):
        # This entry point is guest-callable and the path is guessable, so a
        # refusal must not say which of the two it was. `get_file_content` is a
        # §11.7 forwarder now and refuses with the `_core` classes; without
        # them here a denied read answers 403 and confirms the object exists.
        frappe.throw(_("Not found"), frappe.DoesNotExistError)
