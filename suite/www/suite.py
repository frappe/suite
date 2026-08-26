import os

import frappe

from suite import __version__
from suite.api.account import get_onboarding_state, get_workspace

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

    # the slides service worker must not keep this shell as the offline app
    if frappe.session.user == "Guest":
        frappe.local.response_headers["X-Suite-Guest"] = "1"

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

    # Guests get neutral values: the SPA redirects them to login, so the
    # router never needs the real onboarding state or workspace branding.
    if frappe.session.user == "Guest":
        onboarding_state = {"is_onboarded": False, "can_onboard": False}
        workspace = {"workspace_name": "", "workspace_logo": ""}
    else:
        onboarding_state = get_onboarding_state()
        workspace = get_workspace()

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
            # Onboarding gate, read synchronously by the router (extend_bootinfo
            # does not reach this shell, so the flags live in its own boot).
            "suite_is_onboarded": onboarding_state["is_onboarded"],
            "suite_can_onboard": onboarding_state["can_onboard"],
            # Workspace branding for the launcher navbar.
            "suite_workspace_name": workspace["workspace_name"],
            "suite_workspace_logo": workspace["workspace_logo"],
            # `bench set-config disable_slides_service_worker 1` unregisters the worker
            # on every slides visit, no deploy needed
            "disable_slides_service_worker": bool(frappe.conf.get("disable_slides_service_worker")),
        }
    )
