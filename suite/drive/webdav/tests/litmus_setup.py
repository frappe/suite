"""Fixture management for the litmus compliance run (see run_litmus.sh).

bench --site <site> execute suite.drive.webdav.tests.litmus_setup.prepare
bench --site <site> execute suite.drive.webdav.tests.litmus_setup.teardown

Ticket 25 relinked the write verbs, so all five litmus groups can now be
attempted. The suite has not been run since: it needs a served site. See
litmus_expected.txt for the ledger and for what a real run must add to it.

Both functions run under `bench execute`, not under the test runner, so
`frappe.in_test` is false and every controller hook takes its production
branch. `inline_user_jobs` is the one exception, and it covers one statement.
"""

from contextlib import contextmanager

import frappe
from frappe.utils.password import update_password

from suite.drive._core.roots import personal_root_for, provision_personal_root
from suite.drive.tests.fixtures import drop_personal_root
from suite.drive.webdav.tests.utils import enable_user_webdav

LITMUS_USER = "litmus@example.com"
LITMUS_PASSWORD = "litmus-ci-password"


@contextmanager
def inline_user_jobs():
    """Run the `User` controller's own background jobs inline for the block.

    `User.on_update` computes `now = frappe.in_test or frappe.flags.in_install`
    and enqueues `create_contact` with it. The test runner sets `in_test`, so
    the contact is written inline and no queue is measured. That is why the 23
    gate modules provision users on a full queue and this harness does not.
    `bench execute` sets neither flag, so `frappe.enqueue` reaches
    `_check_queue_size` and raises `QueueOverloaded` there, before it registers
    the `enqueue_after_commit` callback. The refusal escapes the insert, the
    user rolls back, and `prepare` exits before it prints the URL.

    `in_install` is the only branch a caller can take without editing core or
    swallowing an enqueue failure the rest of the site depends on. It takes the
    same branch the test runner takes. It is set for the insert alone, and put
    back to whatever it held, not to a hard-coded false, even when the insert
    raises.

    Its one other effect on this path is `DrivePermission.after_insert`, which
    skips the share notice for the home folder the hook grants. §9.5 promises no
    delivery for that notice, and the only recipient is the throwaway CI user
    who is already the grantee. Nothing the compliance run reads is written
    differently under the flag: not the Personal Root, the node tree, the
    grants, the password, or the per-user opt-in. The served site is a separate
    process and never sees the flag at all.
    """
    previous = frappe.flags.in_install
    frappe.flags.in_install = True
    try:
        yield
    finally:
        frappe.flags.in_install = previous


def prepare() -> str:
    """Create the throwaway litmus user, enable WebDAV, return the DAV URL.

    The URL is `/dav/` itself: the one mount is the user's Personal Root, so
    there is no `Home` collection to point litmus at any more (§12).
    """
    if not frappe.db.exists("User", LITMUS_USER):
        with inline_user_jobs():
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

    No flag is bent here and none is needed. `drop_personal_root` is `db.delete`
    only, and `provision_personal_root` writes a root and one folder node. Neither
    reaches `frappe.enqueue`: only the file paths call `previews.enqueue_render`.
    Teardown therefore runs the same on a full queue as on an empty one, which is
    what the `EXIT` trap in run_litmus.sh depends on.
    """
    if personal_root_for(LITMUS_USER):
        drop_personal_root(LITMUS_USER)
    provision_personal_root(LITMUS_USER)
    frappe.db.commit()
