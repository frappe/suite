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
    from suite.content import ensure_tables as ensure_content_tables
    from suite.content.editors import editors as content_editors
    from suite.drive.framework import validate_content_registry
    from suite.drive.install import index_group_membership
    from suite.mail.install import after_install as mail_after_install
    from suite.meet.install import after_install as meet_after_install
    from suite.slides.install import seed_system_templates
    from suite.suite_core.file_size import set_default_max_file_size
    from suite.writer.content import turn_on as turn_writer_on

    _run("mail.after_install", mail_after_install)
    _run("calendar.after_install", calendar_after_install)
    _run("meet.after_install", meet_after_install)
    _run("content.editors", content_editors)
    _run("content.ensure_tables", ensure_content_tables)
    _run("writer.turn_on", turn_writer_on)
    _run("suite_core.set_default_max_file_size", set_default_max_file_size)
    _run("drive.index_group_membership", index_group_membership)
    # A fresh install never migrates, so it needs the same boot validation.
    _run("drive.validate_content_registry", validate_content_registry)
    # The shipped template decks are Drive documents, so they are seeded after
    # the registry is known to be sound rather than synced as a fixture.
    _run("slides.seed_system_templates", seed_system_templates)


def before_migrate() -> None:
    """Rebuild the module map from disk; the map cached from redis before a pull outlives clear_cache, and sync skips modules missing from it."""
    from suite.content import convert

    frappe.cache.delete_value("app_modules")
    frappe.setup_module_map()
    convert.check_before_migrate()


def after_migrate():
    from suite.content import convert
    from suite.content import ensure_tables as ensure_content_tables
    from suite.content.editors import editors as content_editors
    from suite.drive.framework import validate_content_registry
    from suite.drive.install import index_group_membership
    from suite.mail.install import after_migrate as mail_after_migrate
    from suite.slides.install import seed_system_templates

    _run("mail.after_migrate", mail_after_migrate)
    _run("content.editors", content_editors)
    _run("content.ensure_tables", ensure_content_tables)
    _run("content.check_blocks", convert.check_after_migrate)
    _run("drive.index_group_membership", index_group_membership)
    _run("drive.validate_content_registry", validate_content_registry)
    _run("slides.seed_system_templates", seed_system_templates)


def after_app_install(app_name=None):
    from suite.meet.utils import after_app_install as meet_after_app_install

    _run("meet.after_app_install", meet_after_app_install, app_name)
