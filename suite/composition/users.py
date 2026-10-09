"""Cross-product User lifecycle dispatch."""


def after_insert(doc, method: str | None = None) -> None:
    from suite.drive.install import after_user_insert
    from suite.mail.events import create_user_settings

    after_user_insert(doc, method)
    create_user_settings(doc, method)
    if doc.name not in ("Guest", "Administrator"):
        from suite.suite_core.storage import initialize_user_limit

        initialize_user_limit(doc.name)


def on_trash(doc, method: str | None = None) -> None:
    from suite.drive.install import on_user_trash
    from suite.mail.events import delete_account, delete_user_accounts, delete_user_settings

    on_user_trash(doc, method)
    delete_account(doc, method)
    delete_user_accounts(doc, method)
    delete_user_settings(doc, method)


def before_save(doc, method: str | None = None) -> None:
    """Readiness comes before enabling User or unlocking external Mail access."""
    if doc.flags.in_insert or doc.name in ("Guest", "Administrator"):
        return
    from suite import drive, mail
    from suite.suite_core.administration import guard_user_change
    from suite.suite_core.utils import is_suite_cloud_configured

    previous = doc.get_doc_before_save()
    was_admin = previous and any(row.role == "Suite Admin" for row in previous.roles)
    is_admin = any(row.role == "Suite Admin" for row in doc.roles)
    if previous and was_admin != is_admin:
        guard_user_change(doc.name, is_admin=is_admin)
    if not doc.has_value_changed("enabled"):
        return
    guard_user_change(doc.name, enabled=bool(doc.enabled))
    if not doc.enabled:
        doc.api_key = None
        doc.api_secret = None
        import frappe

        frappe.db.delete("OAuth Bearer Token", {"user": doc.name})
    if doc.enabled and is_suite_cloud_configured():
        from suite.suite_core.account_state import read

        if read(doc.name).get("status") in ("Setup failed", "Deleted", "Deletion failed"):
            import frappe
            from frappe import _

            frappe.throw(_("Complete Mail account setup or deletion recovery before reactivation"))
        mail.require_account_ready(doc.name)
    drive.set_user_active(doc.name, active=bool(doc.enabled))
