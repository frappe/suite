import json
import os

import frappe


# Bundle URL resolution ─────────────────────────────────────────────────────
#
# Vite emits content-hashed filenames (e.g. `index.abc123.js`) plus a manifest
# at `<outDir>/.vite/manifest.json` mapping logical sources to their hashed
# outputs. The Jinja template needs the current hashed URLs at render time;
# we cache the parsed manifest keyed on its mtime so `bench build` is picked
# up without a worker restart, and fall back to legacy unhashed paths if the
# file is missing — keeps things working in dev where vite serves the SPA
# itself and there's no build output here at all.

_ASSET_BASE = "/assets/suite/sheets/sheets/"
_ASSET_CACHE = None
_ASSET_CACHE_MTIME = None


def _read_asset_manifest() -> dict:
    global _ASSET_CACHE, _ASSET_CACHE_MTIME
    path = os.path.join(
        frappe.get_app_path("suite", "sheets"),
        "public", "sheets", ".vite", "manifest.json",
    )
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        _ASSET_CACHE, _ASSET_CACHE_MTIME = {}, None
        return _ASSET_CACHE
    if _ASSET_CACHE is not None and _ASSET_CACHE_MTIME == mtime:
        return _ASSET_CACHE
    try:
        with open(path) as fh:
            _ASSET_CACHE = json.load(fh)
        _ASSET_CACHE_MTIME = mtime
    except (FileNotFoundError, json.JSONDecodeError):
        _ASSET_CACHE, _ASSET_CACHE_MTIME = {}, None
    return _ASSET_CACHE


def _asset_paths() -> dict:
    manifest = _read_asset_manifest()
    entry = manifest.get("index.html") or {}
    js  = entry.get("file") or "index.js"
    css = entry.get("css")  or ["index.css"]
    return {
        "js":  _ASSET_BASE + js,
        "css": [_ASSET_BASE + c for c in css],
    }


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/sheets"
        raise frappe.Redirect

    context.no_cache = 1
    # Without this the Jinja template renders `window.csrf_token = ""`,
    # so every POST from the SPA fails with CSRFTokenError on sites
    # where CSRF protection is enabled (e.g. Frappe Cloud).
    context.csrf_token = frappe.sessions.get_csrf_token()
    # The SPA reads `window.frappe.session.{user,user_fullname}` for the
    # top-right avatar and the ShareDialog owner row. Frappe's boot script
    # is desk-only, so on this www page nothing populates `window.frappe`
    # unless we do it here.
    user = frappe.session.user
    context.session_user = user
    context.session_user_fullname = frappe.db.get_value("User", user, "full_name") or user
    context.session_user_image = frappe.db.get_value("User", user, "user_image") or ""

    # `window.frappe.boot.*` carries the collab v2 feature flag and the
    # session id the Hocuspocus provider passes as its auth token. Without
    # this, the SPA falls back to the legacy `frappe.realtime` relay path.
    # `sid` is treated the same way Frappe Desk does — injected into the
    # rendered HTML so JS can read it; an XSS already implies full session
    # compromise via cookie auth, so this doesn't widen the blast radius.
    context.collab_v2     = bool(frappe.conf.get("collab_v2") or False)
    context.collab_ws_url = frappe.conf.get("collab_ws_url") or None
    context.session_sid   = getattr(frappe.session, "sid", "") or ""

    # Sitename + socketio_port let the SPA stand up its own `frappe.realtime`
    # against the site's socket.io namespace. Without these, the legacy
    # presence path silently has no transport on the public www page and
    # the avatar pile stays empty even with concurrent users on the sheet.
    context.sitename       = frappe.local.site
    context.socketio_port  = frappe.conf.get("socketio_port") or 9000

    # AI Assist gating for the SPA topbar. `extend_bootinfo` is desk-only, so —
    # like the collab flags above — these are seeded here into the SPA's boot:
    #   * ai_assist_enabled gates the "Ask AI" entry point — true only when an
    #     admin has both stored a key and flipped the toggle.
    #   * ai_assist_can_configure gates the in-app "AI settings" menu item.
    # The key itself never reaches the browser. Guarded so a missing /
    # not-yet-migrated settings doctype degrades to "AI off" rather than 500.
    context.ai_assist_enabled = False
    context.ai_assist_can_configure = "System Manager" in frappe.get_roles()
    try:
        ai = frappe.get_cached_doc("Sheets AI Settings")
        # The keyless "mock"/"demo" model counts as configured so the button
        # shows for a local, no-spend trial.
        model = (ai.model or "").strip().lower()
        has_creds = model in ("mock", "demo") or bool(
            ai.get_password("api_key", raise_exception=False)
        )
        context.ai_assist_enabled = bool(ai.enabled and has_creds)
    except Exception:
        pass

    # Vite-emitted hashed bundle URLs — see _asset_paths above.
    context.assets = _asset_paths()

    # Optional Sentry — off unless the site explicitly opts in via
    # `sheets_sentry_dsn` in site_config.json. The SPA's
    # frontend/src/utils/sentry.js reads these off window.frappe.boot
    # and short-circuits when the DSN is empty.
    context.sentry_dsn         = frappe.conf.get("sheets_sentry_dsn") or ""
    context.sentry_environment = (
        frappe.conf.get("sheets_sentry_environment")
        or ("development" if frappe.conf.get("developer_mode") else "production")
    )
    context.sentry_release = frappe.conf.get("sheets_sentry_release") or ""
