"""Deterministic lifecycle dispatch across the products bundled in Suite."""

import frappe
from frappe import _

CONSOLIDATED_STANDALONE_APPS = (
    "calendar_app",
    "drive",
    "mail",
    "meet",
    "sheets",
    "slides",
    "writer",
)


def before_install():
    conflicting = [app for app in CONSOLIDATED_STANDALONE_APPS if app in frappe.get_installed_apps()]
    if conflicting:
        frappe.throw(
            _(
                "Cannot install Frappe Suite because the following standalone app(s) are installed on this site: {0}. "
                "Frappe Suite already includes them.\n\n"
                "To migrate this site to Frappe Suite:\n"
                "1. Take a backup of the site, including files.\n"
                "2. Uninstall the standalone app(s) listed above. This deletes their data on the site, which is why the backup comes first.\n"
                "3. Install Frappe Suite.\n"
                "4. Restore the backup, then follow the post-restore steps in the migration guide.\n\n"
                "The same steps apply to sites hosted on Frappe Cloud. See {1} for the full commands."
            ).format(
                ", ".join(frappe.bold(app) for app in conflicting),
                "https://github.com/frappe/suite#migrating-from-the-standalone-apps",
            )
        )


def _run(label, func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except Exception:
        frappe.log_error(title=f"suite.composition.lifecycle: {label} failed")
        raise


def after_install():
    from suite.calendar.install import after_install as calendar_after_install
    from suite.drive.install import after_install as drive_after_install
    from suite.drive.install import ensure_custom_fields
    from suite.mail.install import after_install as mail_after_install

    _run("drive.ensure_custom_fields", ensure_custom_fields)
    _run("drive.after_install", drive_after_install)
    _run("mail.after_install", mail_after_install)
    _run("calendar.after_install", calendar_after_install)


def after_migrate():
    from suite.drive.framework import validate_content_registry
    from suite.mail.install import after_migrate as mail_after_migrate

    _run("mail.after_migrate", mail_after_migrate)
    _run("drive.validate_content_registry", validate_content_registry)


def after_app_install(app_name=None):
    from suite.meet.utils import after_app_install as meet_after_app_install

    _run("meet.after_app_install", meet_after_app_install, app_name)


def extend_bootinfo(bootinfo):
    from suite.sheets.boot import extend_bootinfo as sheets_extend_bootinfo

    _run("sheets.extend_bootinfo", sheets_extend_bootinfo, bootinfo)
