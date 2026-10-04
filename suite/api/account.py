import frappe
from frappe import _
from frappe.utils.caching import redis_cache

from suite.mail.utils.user import can_use_mail
from suite.suite_core.setup import build_setup_args, uses_suite_setup_wizard

ALLOWED_LOGO_EXTENSIONS = ("png", "jpg", "jpeg", "webp")


@frappe.whitelist()
def get_onboarding_state() -> dict[str, bool]:
    """Router's dev fallback; production reads these from window globals (www/suite.py)."""
    return {
        # Suite-owned, not frappe.is_setup_complete(): decoupled from framework/press state.
        "is_onboarded": bool(frappe.db.get_single_value("Suite Settings", "is_onboarded")),
        "can_onboard": "System Manager" in frappe.get_roles(),
    }


@frappe.whitelist(methods=["POST"])
def mark_onboarded(timezone: str | None = None) -> None:
    frappe.only_for("System Manager")

    if not frappe.is_setup_complete() and uses_suite_setup_wizard():
        from frappe.desk.page.setup_wizard.setup_wizard import complete_app_setup

        complete_app_setup(**build_setup_args(timezone))

    frappe.db.set_single_value("Suite Settings", "is_onboarded", 1)


@frappe.whitelist()
def get_workspace() -> dict[str, str]:
    return {
        "workspace_name": frappe.db.get_single_value("Suite Settings", "workspace_name") or "",
        "workspace_logo": frappe.db.get_single_value("Suite Settings", "workspace_logo") or "",
    }


@frappe.whitelist(methods=["POST"])
def update_workspace(workspace_name: str, workspace_logo: str = "") -> None:
    frappe.only_for("System Manager")

    workspace_name = workspace_name.strip()
    if not workspace_name:
        frappe.throw(_("Workspace name is required"))

    validate_workspace_logo(workspace_logo)

    settings = frappe.get_single("Suite Settings")
    old_logo = settings.workspace_logo
    settings.workspace_name = workspace_name
    settings.workspace_logo = workspace_logo
    settings.save()

    if old_logo and old_logo != workspace_logo:
        delete_logo_file(old_logo)


def validate_workspace_logo(workspace_logo: str) -> None:
    """The logo is served as a world-readable public file, so only site-local
    raster uploads are allowed: no external URLs (beacons), no /private paths,
    no SVG (stored XSS when opened directly)."""
    if not workspace_logo:
        return

    if not workspace_logo.startswith("/files/"):
        frappe.throw(_("Workspace logo must be an image uploaded to this site"))

    if workspace_logo.rsplit(".", 1)[-1].lower() not in ALLOWED_LOGO_EXTENSIONS:
        frappe.throw(_("Workspace logo must be a PNG, JPEG, or WebP image"))

    file_exists = frappe.db.exists(
        "File",
        {
            "file_url": workspace_logo,
            "is_private": 0,
            "attached_to_doctype": "Suite Settings",
            "attached_to_name": "Suite Settings",
        },
    )
    if not file_exists:
        frappe.throw(_("Workspace logo file not found"))


def delete_logo_file(file_url: str) -> None:
    file_name = frappe.db.get_value(
        "File",
        {
            "file_url": file_url,
            "attached_to_doctype": "Suite Settings",
            "attached_to_name": "Suite Settings",
        },
    )
    if file_name:
        frappe.delete_doc("File", file_name, ignore_missing=True)


@frappe.whitelist(methods=["POST"])
def invite_users(emails: str) -> dict[str, list[str]]:
    frappe.only_for("System Manager")

    from frappe.core.api.user_invitation import invite_by_email

    return invite_by_email(
        emails=emails,
        roles=get_invite_roles(),
        redirect_to_path="/suite",
        app_name="suite",
    )


def get_invite_roles() -> list[str]:
    hook = frappe.get_hooks("user_invitation", app_name="suite")
    allowed_roles = (hook if isinstance(hook, dict) else {}).get("allowed_roles") or {}
    user_roles = set(frappe.get_roles())
    roles: set[str] = set()
    for role, granted in allowed_roles.items():
        if role in user_roles:
            roles.update(granted)
    return list(roles)


@frappe.whitelist()
def get_users() -> list[dict]:
    frappe.only_for("System Manager")

    users = frappe.get_all(
        "User",
        filters={
            "enabled": 1,
            "user_type": "System User",
            "name": ["not in", ["Administrator", "Guest"]],
        },
        fields=["name", "email", "full_name", "user_image"],
        order_by="full_name asc",
    )
    admins = set(
        frappe.get_all(
            "Has Role",
            filters={"role": "System Manager", "parenttype": "User"},
            pluck="parent",
        )
    )
    for user in users:
        user["is_admin"] = user["name"] in admins
    return users


@frappe.whitelist()
def get_pending_invites() -> list[dict]:
    frappe.only_for("System Manager")

    invites = frappe.get_all(
        "User Invitation",
        filters={"status": "Pending", "app_name": "suite"},
        fields=["name", "email", "creation", "invited_by"],
        order_by="creation desc",
    )
    for invite in invites:
        invite["invited_by_name"] = frappe.db.get_value("User", invite["invited_by"], "full_name")
    return invites


def forget_logged_in_users() -> None:
    """Drops what get_logged_in_user remembers, for every user.

    Which apps it offers depends on the site as well as on the user, so a change to the site's
    JMAP server must not wait out the hour the answer is kept for.
    """

    key = f"{get_logged_in_user.__module__}.{get_logged_in_user.__qualname__}"
    frappe.cache.delete_keys(key, user="*")


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
        "is_jmap_configured": can_use_mail(user),
    }
