import frappe


def execute():
    method_path = "suite.meet.api.meeting.validate_guest_session"
    frappe.db.delete("Rate Limit", {"method_path": method_path})
    frappe.cache.hdel("rate_limits", method_path)
