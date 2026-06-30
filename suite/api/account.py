import frappe
from frappe.utils.caching import redis_cache

from suite.mail.utils.user import is_jmap_configured


@frappe.whitelist()
@redis_cache(user=True)
def get_logged_in_user() -> dict | None:
	user = frappe.session.user
	if user == "Guest":
		return None

	user_doc = frappe.get_doc("User", user)
	return {
		"name": user_doc.name,
		"email": user_doc.email,
		"full_name": user_doc.full_name,
		"avatar": user_doc.user_image,
		"roles": [role.role for role in user_doc.roles],
		"is_jmap_configured": is_jmap_configured(user),
	}
