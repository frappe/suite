import os

import frappe

from suite import __version__

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
	sentry_dsn = None
	if frappe.get_system_settings("enable_telemetry"):
		sentry_dsn = os.getenv("SUITE_FRONTEND_SENTRY_DSN")

	return frappe._dict(
		{
			"site_name": frappe.local.site,
			"socketio_port": frappe.conf.get("socketio_port") or 9000,
			"sentry_dsn": sentry_dsn,
			"sentry_environment": "development" if frappe.conf.developer_mode else "production",
			"sentry_release": f"suite@{__version__}",
			# Surfaced on window.push_relay_server_url for mail's FCM push setup
			# (frappe-push-notification.ts / PWASettings.vue). Mirrors the old
			# standalone www/mail.py boot, which the suite shell replaced.
			"push_relay_server_url": frappe.conf.get("push_relay_server_url") or "",
			# Sheets collab transport — "realtime" (default), "webrtc" or
			# "hocuspocus"; read as window.collab_mode by useCollaboration.js.
			# It belongs here rather than in sheets/www/sheets.py, because
			# website_route_rules sends /sheets to this unified SPA and that
			# template is never rendered for it.
			"collab_mode": frappe.conf.get("collab_mode") or "realtime",
		}
	)
