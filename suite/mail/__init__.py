"""Mail's provider and administration interfaces used by Suite composition.

Suite Core calls is_configured before choosing its local Email Account path, then calls
send_email for configured Suite Cloud delivery. The provider preserves Suite Cloud's response
and exception types; Core owns first-party notification retries and transaction timing.
"""

from collections.abc import Mapping
from typing import Any


def is_configured() -> bool:
    """Return whether this site has the Suite Cloud credentials required for email delivery."""
    from suite.suite_core.utils import is_suite_cloud_configured

    return is_suite_cloud_configured()


def send_email(email_type: str, recipient: str, params: Mapping[str, Any], request_key: str) -> None:
    """Ask Suite Cloud to send one first-party email from its named template."""
    import frappe
    from frappe import _

    from suite.mail import suite_cloud
    from suite.suite_core.suite_email import EmailNotSentError

    result = suite_cloud.get_client().call(
        "email.send_email",
        email_type=email_type,
        recipient=recipient,
        params=params,
        request_key=request_key,
    )
    if result["status"] != "Sent":
        frappe.throw(
            _("The email to {0} was not sent: {1}").format(recipient, result.get("error")), EmailNotSentError
        )


def storage_measurements(previous: dict, *, refresh: bool = False) -> dict:
    from suite.mail.storage import measurements

    return measurements(previous, refresh=refresh)


def require_account_ready(user: str, *, onboarding: bool = False) -> None:
    """Refuse activation without a configured, provisioned business Mail account."""
    import frappe
    from frappe import _

    from suite.mail.directory import get_account_email
    from suite.mail.suite_cloud import get_client
    from suite.mail.utils.user import is_jmap_configured

    email = get_account_email(user)
    if not email or not is_jmap_configured(user):
        frappe.throw(_("Set up this user's Mail account before reactivation"))
    account = get_client().call("mail.accounts.get_account", email=email)
    if account.get("email") != email:
        frappe.throw(_("The provider has not confirmed this user's Mail account"))
    if onboarding:
        domain = get_client().call("mail.domains.get_domain", domain=email.rsplit("@", 1)[1])
        if not domain.get("enabled") or not domain.get("is_verified"):
            frappe.throw(_("A ready, verified business Mail domain is required to complete onboarding"))


def administer_account(action: str, **arguments) -> dict:
    """Authorized business account workflows; secrets appear only in fresh mutation responses."""
    from suite.mail import account_lifecycle as workflows

    handlers = {
        "replace_temporary": workflows.replace_temporary_password,
        "recreate": workflows.recreate,
        "delete": workflows.delete,
        "onboarding_options": workflows.onboarding_options,
        "onboard": workflows.provision_first_admin,
    }
    from suite.suite_core.audit import record

    target = arguments.get("user") or arguments.get("address")
    try:
        result = handlers[action](**arguments)
    except Exception:
        record(action, target, "failed")
        raise
    if action != "onboarding_options":
        record(action, target, "failed" if result.get("success") is False else "completed")
    return result


def provider_health(*, refresh: bool = False, domains: bool = False) -> dict:
    """Report provider connectivity/suspension without treating outages as suspension."""
    from suite.mail.health import status

    return status(refresh=refresh, domains=domains)


def administration_invitation_count() -> int:
    """Count still-valid pending provider invitations, including those outside a list page."""
    import frappe
    from frappe.utils import now_datetime

    from suite.suite_core.administration import require_admin

    require_admin()
    return frappe.db.count(
        "Mail Account Request", {"is_verified": 0, "send_invite": 1, "expires_at": [">", now_datetime()]}
    )


def administration_accounts() -> list[dict]:
    """Expose local business-address attribution for migration and access policy."""
    import frappe

    from suite.suite_core.administration import require_admin

    require_admin()
    return frappe.get_all("User Settings", filters={"username": ["is", "set"]}, fields=["user", "username"])


def resolve_business_user(address: str) -> str | None:
    """Resolve an authenticated transport's submitted business address to its current holder."""
    import frappe

    from suite.suite_core.utils import is_suite_cloud_configured

    if not is_suite_cloud_configured():
        return None
    return frappe.db.get_value("User Settings", {"username": address.strip().lower()}, "user")
