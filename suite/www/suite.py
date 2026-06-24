import frappe

no_cache = 1


def get_context(context):
	"""Boot context for the unified Suite SPA.

	Serves every former-app prefix (/suite, /drive, /slides, /sheets, /writer,
	/mail, /meet, /calendar) via website_route_rules -> this page. The Vite-built
	bundle is loaded by www/suite.html (regenerated on `bench build`); Vue Router
	dispatches to the right module client-side.
	"""
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()

	context.boot = get_boot()
	context.boot.csrf_token = csrf_token
	context.csrf_token = csrf_token
	context.desk_theme = get_desk_theme()
	context.title = "Frappe Suite"
	return context


def get_desk_theme():
	if frappe.session.user == "Guest":
		return "Light"
	return frappe.get_cached_value("User", frappe.session.user, "desk_theme") or "Light"


def get_boot():
	return frappe._dict(
		{
			"site_name": frappe.local.site,
			"socketio_port": frappe.conf.get("socketio_port") or 9000,
		}
	)
