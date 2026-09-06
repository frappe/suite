import frappe
from pypika import Order

from suite.drive.api.permissions import user_has_permission
from suite.drive.http import shims


def create_new_activity_log(
    entity,
    activity_type,
    activity_message,
    document_field=None,
    field_old_value=None,
    field_new_value=None,
    field_meta_value=None,
):
    doc = frappe.new_doc("Drive Entity Activity Log")
    doc.entity = entity
    doc.document_field = document_field
    doc.action_type = activity_type
    doc.message = activity_message
    doc.owner = frappe.session.user
    doc.meta_value = field_meta_value
    if document_field:
        doc.old_value = field_old_value
        doc.new_value = field_new_value
    try:
        doc.save(ignore_permissions=True)
    except Exception:
        pass
    return doc


@frappe.whitelist()
def get_entity_activity_log(entity_name: str):
    """Return an entity's activity log.

    §11.7 forwarder over `GET /nodes/<id>/activity`. `action_type` and the
    actor's display fields are kept; the rendered `message` string §9.5 dropped
    is not rebuilt.
    """
    return shims.get_entity_activity_log(entity_name)
