import frappe
from frappe.model.document import Document


class DriveFavourite(Document):
    pass


def on_doctype_update() -> None:
    frappe.db.add_unique("Drive Favourite", ["user", "node"], constraint_name="fav_user_node")
