import frappe
from frappe.model.utils.rename_field import rename_field
from frappe.utils.password import rename_password_field

# Suite Cloud authenticates a site by its tenant id and secret. The old key no longer opens
# anything: the operator replaces it with the tenant id Suite Cloud shows.


def execute() -> None:
    frappe.reload_doc("suite_core", "doctype", "suite_settings")
    rename_field("Suite Settings", "site_api_key", "suite_cloud_tenant")
    rename_field("Suite Settings", "site_api_secret", "suite_cloud_secret")
    rename_password_field("Suite Settings", "site_api_secret", "suite_cloud_secret")
