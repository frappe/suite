import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.translate import get_all_translations
from frappe.utils import escape_html, split_emails, validate_email_address


def access_app():
    return True


@frappe.whitelist()
def get_my_invites():
    return frappe.db.get_list(
        "Drive User Invitation",
        fields=["creation", "status", "name"],
        filters={"email": frappe.session.user, "status": ("in", ("Proposed", "Pending"))},
    )


@frappe.whitelist()
def get_pending_invites():
    if not is_drive_site_admin():
        frappe.throw(_("You don't have the permissions for this action."), frappe.PermissionError)

    invites = frappe.db.get_list(
        "Drive User Invitation",
        fields=["creation", "status", "email", "name", "owner"],
        filters={"status": ("in", ("Proposed", "Pending"))},
    )
    for i in invites:
        i["user_name"] = frappe.db.get_value("User", i["email"], "full_name")
    return invites


@frappe.whitelist(allow_guest=True)
def signup(
    account_request: str,
    first_name: str,
    password: str,
    last_name: str | None = None,
):
    if not password:
        frappe.throw("Password is required.")

    account_request = frappe.get_doc("Account Request", account_request)
    if not account_request.invite:
        if frappe.get_website_settings("disable_signup"):
            frappe.throw("Signing up is disabled on this site.", frappe.PermissionError)

        if not account_request.login_count:
            frappe.throw("Please verify the email first.")

    create_user(account_request.email, first_name, password, last_name, True)
    account_request.signed_up = 1
    account_request.save(ignore_permissions=True)
    if account_request.invite:
        invite = frappe.get_doc("Drive User Invitation", account_request.invite)
        invite.status = "Accepted"
        invite.save(ignore_permissions=True)
    return {"location": "/drive/"}


def create_user(email, first_name, password, last_name=None, login=False):
    user = frappe.get_doc(
        {
            "doctype": "User",
            "email": email,
            "first_name": escape_html(first_name),
            "last_name": escape_html(last_name),
            "enabled": 1,
            "user_type": "Website User",
            "new_password": password,
        }
    )

    user.flags.no_welcome_mail = True
    try:
        user.insert(ignore_permissions=True)
    except frappe.DuplicateEntryError:
        frappe.throw("User already exists")

    if login:
        frappe.local.login_manager.login_as(user.email)
    return user


@frappe.whitelist(allow_guest=True)
def oauth_providers():
    from frappe.utils.html_utils import get_icon_html
    from frappe.utils.oauth import get_oauth2_authorize_url, get_oauth_keys
    from frappe.utils.password import get_decrypted_password

    out = []
    providers = frappe.get_all(
        "Social Login Key",
        filters={"enable_social_login": 1},
        fields=["name", "client_id", "base_url", "provider_name", "icon"],
        order_by="name",
    )

    for provider in providers:
        client_secret = get_decrypted_password("Social Login Key", provider.name, "client_secret")
        if not client_secret:
            continue

        icon = None
        if provider.icon:
            if provider.provider_name == "Custom":
                icon = get_icon_html(provider.icon, small=True)
            else:
                icon = f"<img src='{provider.icon}' alt={provider.provider_name}>"

        if provider.client_id and provider.base_url and get_oauth_keys(provider.name):
            out.append(
                {
                    "name": provider.name,
                    "provider_name": provider.provider_name,
                    "auth_url": get_oauth2_authorize_url(provider.name, "/drive"),
                    "icon": icon,
                }
            )
    return out


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=5, seconds=60)
def send_otp(email: str, login: bool = False):
    if signup_disabled():
        frappe.throw("Signing up is disabled on this site.", frappe.PermissionError)

    account_request = frappe.get_doc(
        {
            "doctype": "Account Request",
            "email": email,
            "signed_up": 0,
        }
    ).insert(ignore_permissions=True)
    account_request.set_otp()
    try:
        account_request.send_otp()
    except Exception:
        frappe.throw("Please setup an email account in Desk.")
    return account_request.name


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=5, seconds=60)
def verify_otp(account_request: str, otp: str):
    req = frappe.get_doc("Account Request", account_request)
    if req.otp != otp:
        frappe.throw("Invalid OTP")
    req.login_count += 1
    req.save(ignore_permissions=True)


@frappe.whitelist(allow_guest=True)
def get_settings():
    if frappe.session.user == "Guest":
        return {}
    try:
        return frappe.get_cached_doc("Drive Settings", frappe.session.user)
    except Exception:
        return {}


@frappe.whitelist()
def set_settings(updates: dict[str, int | str]):
    try:
        settings = frappe.get_doc("Drive Settings", frappe.session.user)
    except Exception:
        settings = frappe.get_doc({"doctype": "Drive Settings", "user": frappe.session.user})
        settings.insert()

    if "single_click" in updates:
        settings.single_click = int(updates["single_click"])
    if "webdav_enabled" in updates:
        settings.webdav_enabled = int(updates["webdav_enabled"])
    settings.save()


@frappe.whitelist()
def invite_users(emails: str):
    if not is_drive_site_admin():
        frappe.throw(_("You don't have the permissions for this action."), frappe.PermissionError)
    create_invites(emails)


def create_invites(emails: str, auto: bool = False):
    if not emails:
        return

    email_string = validate_email_address(emails, throw=False)
    email_list = split_emails(email_string)
    if not email_list:
        return

    existing_invites = frappe.db.get_list(
        "Drive User Invitation",
        filters={"email": ["in", email_list], "status": "Pending"},
        pluck="email",
    )

    new_invites = list(set(email_list) - set(existing_invites))
    for email in new_invites:
        invite = frappe.new_doc("Drive User Invitation")
        invite.email = email
        invite.status = "Automatic" if auto else "Pending"
        invite.insert(ignore_permissions=True)


@frappe.whitelist()
def get_users():
    """All enabled site users, for sharing and user management."""
    if frappe.session.user == "Guest":
        frappe.throw(_("You don't have the permissions for this action."), frappe.PermissionError)
    return frappe.get_all(
        doctype="User",
        filters=[
            ["enabled", "=", 1],
            ["name", "not in", ["Guest", "Administrator"]],
        ],
        fields=[
            "name",
            "email",
            "full_name",
            "user_image",
        ],
    )


@frappe.whitelist()
def get_user_groups():
    """Shareable user groups, with how many people each one carries."""
    if frappe.session.user == "Guest":
        frappe.throw(_("You don't have the permissions for this action."), frappe.PermissionError)

    counts = frappe._dict(
        frappe.db.sql(
            """SELECT parent, COUNT(DISTINCT user) FROM `tabUser Group Member`
			WHERE parenttype = 'User Group' GROUP BY parent"""
        )
    )
    return [
        {"name": g, "member_count": counts.get(g, 0)}
        for g in frappe.get_all("User Group", pluck="name", order_by="name")
    ]


@frappe.whitelist(allow_guest=True)
def accept_invite(key: str, redirect: bool | str = True):
    try:
        invitation = frappe.get_doc("Drive User Invitation", key)
    except Exception:
        frappe.throw("Could not find invitation.")

    return invitation.accept(redirect)


@frappe.whitelist()
def reject_invite(key: str):
    try:
        invitation = frappe.get_doc("Drive User Invitation", key)
    except Exception:
        frappe.throw("Could not find invitation.")

    invitation.status = "Expired"
    invitation.save(ignore_permissions=True)


@frappe.whitelist(allow_guest=True)
def get_translations():
    if frappe.session.user != "Guest":
        language = frappe.db.get_value("User", frappe.session.user, "language")
        if not language:
            language = frappe.db.get_single_value("System Settings", "language")
    else:
        language = frappe.db.get_single_value("System Settings", "language")

    return get_all_translations(language)


def is_drive_site_admin():
    return frappe.has_permission("Drive Disk Settings", "write")


@frappe.whitelist()
def is_site_admin():
    return {"is_admin": is_drive_site_admin()}


@frappe.whitelist(allow_guest=True)
def disk_settings(**kwargs):
    settings = frappe.get_single("Drive Disk Settings")
    if not is_drive_site_admin():
        # Return only safe values
        return {"preview_size": settings.preview_size, "enabled": settings.enabled}

    if frappe.request.method == "GET":
        return settings

    field_map = {
        "root_folder": None,
        "aws_key": None,
        "aws_secret": None,
        "bucket": None,
        "endpoint_url": None,
        "signature_version": "s3v4",
    }
    settings.enabled = 1
    for field, value in kwargs.items():
        if field in field_map and value:
            setattr(settings, field, value)
        elif field == "backend_type":
            # If backend is s3, enable it. Otherwise, disable.
            settings.enabled = 1 if value == "s3" else 0
    settings.save()


@frappe.whitelist()
def webdav_config() -> dict:
    """Connection details for the WebDAV settings panel. Empty when the feature
    is globally off and the caller is no admin — the frontend hides the whole
    panel then, mirroring get_calendar_client_config."""
    from frappe.twofactor import should_run_2fa

    from suite.drive.webdav.settings import global_webdav_enabled, user_webdav_enabled

    admin = is_drive_site_admin()
    enabled = global_webdav_enabled()
    if not enabled and not admin:
        return {}

    config = {"globally_enabled": enabled, "is_admin": admin}
    if enabled:
        config.update(
            {
                "server_url": frappe.utils.get_url("/dav/"),
                "username": frappe.session.user,
                "enabled_for_user": user_webdav_enabled(frappe.session.user),
                "two_factor_blocked": bool(should_run_2fa(frappe.session.user)),
                # api_key doubles as the WebDAV username for key-based sign-in;
                # the secret is only ever shown once, at generation time
                "api_key": frappe.db.get_value("User", frappe.session.user, "api_key"),
            }
        )
    return config


@frappe.whitelist()
def set_webdav_enabled(enabled: bool) -> None:
    """Admin-only global toggle. Not piggybacked on disk_settings — its PUT
    force-enables the S3 backend as a side effect."""
    if not is_drive_site_admin():
        frappe.throw(_("You don't have the permissions for this action."), frappe.PermissionError)
    frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", int(enabled))
    frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")


WHITELISTED_DOMAINS = [
    "https://gameplan.frappe.cloud",
    "https://frappecloud.com",
    "https://frappe.io",
    "https://cloud.frappe.io",
]


def after_request(request):
    try:
        if request.path.startswith("/drive/") or request.path.startswith("/api/method/"):
            frappe.local.response_headers["Content-Security-Policy"] = (
                f"frame-ancestors {' '.join(WHITELISTED_DOMAINS)} 'self'"
            )
            if "X-Frame-Options" in frappe.local.response_headers:
                del frappe.local.response_headers["X-Frame-Options"]
    except Exception:
        pass


@frappe.whitelist(allow_guest=True)
def signup_disabled():
    return frappe.get_website_settings("disable_signup")
