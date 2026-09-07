"""Fixture management for the litmus compliance run (see run_litmus.sh).

bench --site <site> execute suite.drive.webdav.tests.litmus_setup.prepare
bench --site <site> execute suite.drive.webdav.tests.litmus_setup.teardown

Ticket 25 relinked the write verbs, so all five litmus groups can now be
attempted. The suite has not been run since: it needs a served site. See
litmus_expected.txt for the ledger and for what a real run must add to it.
"""

import frappe
from frappe.utils.password import update_password

from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.tests.fixtures import drop_personal_root
from suite.drive.webdav.tests.utils import enable_user_webdav

LITMUS_USER = "litmus@example.com"
LITMUS_PASSWORD = "litmus-ci-password"


def prepare() -> str:
    """Create the throwaway litmus user, enable WebDAV, return the DAV URL.

    The URL is `/dav/` itself: the one mount is the user's Personal Root, so
    there is no `Home` collection to point litmus at any more (§12).
    """
    if not frappe.db.exists("User", LITMUS_USER):
        frappe.get_doc(
            {
                "doctype": "User",
                "email": LITMUS_USER,
                "first_name": "litmus",
                "send_welcome_email": 0,
            }
        ).insert(ignore_permissions=True)
    update_password(LITMUS_USER, LITMUS_PASSWORD)
    provision_personal_root(LITMUS_USER)
    enable_user_webdav(LITMUS_USER)
    frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 1)
    frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
    frappe.db.commit()
    return frappe.utils.get_url("/dav/")


def teardown() -> None:
    """Remove litmus leftovers; the feature toggle is left alone (CI sites are
    disposable, dev sites keep whatever they had — reset it yourself if needed).

    The whole Personal Root goes, then a fresh one is provisioned, because the
    root is the mount: emptying it is the same as replacing it.
    """
    if personal_root_for(LITMUS_USER):
        drop_personal_root(LITMUS_USER)
    provision_personal_root(LITMUS_USER)
    frappe.db.commit()
