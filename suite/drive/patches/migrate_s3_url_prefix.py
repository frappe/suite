import frappe

OLD_PREFIX = "/api/method/drive.api.s3.fetch?path="
NEW_PREFIX = "/api/method/suite.drive.api.s3.fetch?path="


def execute():
    files = frappe.get_all(
        "File",
        filters=[["file_url", "like", OLD_PREFIX + "%"]],
        fields=["name", "file_url"],
    )
    for f in files:
        new_url = NEW_PREFIX + f["file_url"][len(OLD_PREFIX):]
        frappe.db.set_value("File", f["name"], "file_url", new_url, update_modified=False)

    if files:
        frappe.db.commit()
