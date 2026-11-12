import frappe


def execute():
    """Every Drive listing and tree walk filters on `File.folder`, which core leaves
    unindexed."""
    if frappe.db.sql("show index from `tabFile` where Column_name = %s", "folder"):
        return
    frappe.db.sql_ddl("ALTER TABLE `tabFile` ADD INDEX `folder` (`folder`)")
