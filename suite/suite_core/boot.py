"""Suite Core lifecycle dispatchers.

Phase 3 consolidation: the seven source apps each defined their own lifecycle
hooks (after_install, after_migrate, after_app_install, extend_bootinfo, ...).
A Frappe app can register only ONE handler per lifecycle hook key, so the
per-app handlers are gathered here and invoked in a deterministic order. Each
former app's function is preserved and called; if any single handler raises,
a labeled error is logged and the exception propagates, so install/migrate
fails loudly instead of half-completing.

Imports are performed lazily inside each dispatcher so that importing
``suite.hooks`` never eagerly pulls in every module's heavy dependencies.
"""

import frappe


def _run(label, func, *args, **kwargs):
    """Log a labeled error for the failing handler, then let it propagate."""
    try:
        return func(*args, **kwargs)
    except Exception:
        frappe.log_error(title=f"suite.suite_core.boot: {label} failed")
        raise


def after_install():
    """Run every former app's after_install handler, in order.

    Drive overrides the core File class app-wide and adds custom fields (team,
    status, content_doctype, ...) to File. Those ship as fixtures that sync only
    AFTER after_install, yet Mail's after_install creates File folders that run
    through Drive's overridden hooks. So create Drive's File columns FIRST, before
    any app's after_install runs.
    """
    from suite.calendar.install import after_install as calendar_after_install
    from suite.drive.install import after_install as drive_after_install
    from suite.drive.install import ensure_custom_fields
    from suite.mail.install import after_install as mail_after_install

    _run("drive.ensure_custom_fields", ensure_custom_fields)
    _run("drive.after_install", drive_after_install)
    _run("mail.after_install", mail_after_install)
    _run("calendar.after_install", calendar_after_install)


def after_migrate():
    """Run every former app's after_migrate handler, in order."""
    from suite.mail.install import after_migrate as mail_after_migrate

    _run("mail.after_migrate", mail_after_migrate)


def after_app_install(app_name=None):
    """Run every former app's after_app_install handler, in order."""
    from suite.meet.utils import after_app_install as meet_after_app_install

    _run("meet.after_app_install", meet_after_app_install, app_name)


def extend_bootinfo(bootinfo):
    """Run every former app's extend_bootinfo handler, in order."""
    from suite.sheets.boot import extend_bootinfo as sheets_extend_bootinfo

    _run("sheets.extend_bootinfo", sheets_extend_bootinfo, bootinfo)
