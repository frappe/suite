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
from frappe.model.meta import clear_meta_cache
from frappe.utils.password import update_password

from suite.drive import framework
from suite.drive._core.access import require
from suite.drive._core.roles import UPLOAD
from suite.drive._core.roots import personal_root_for, provision_personal_root, validate_root_pair
from suite.drive.tests.fixtures import drop_personal_root
from suite.drive.webdav import pathmap
from suite.drive.webdav.tests.utils import enable_user_webdav

LITMUS_USER = "litmus@example.com"
LITMUS_PASSWORD = "litmus-ci-password"

# the collection litmus creates below the URL it is given, before it runs a
# single case. `begin` MKCOLs it in every one of the five groups.
LITMUS_COLLECTION = "litmus"


class LitmusFixtureError(Exception):
    """The harness could not leave the site in the state litmus needs.

    Its own class, not `frappe.ValidationError`: the point of raising is that
    `run_litmus.sh` stops and names the fixture, and a reader of the traceback
    can tell a harness refusal from one the product made.
    """


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

    Its one effect on the rows this writes is `DrivePermission.after_insert`,
    which skips the share notice for the home folder the hook grants. §9.5
    promises no delivery for that notice, and the only recipient is the
    throwaway CI user who is already the grantee. Nothing the compliance run
    reads is written differently: not the Personal Root, the node tree, the
    grants, the password, or the per-user opt-in.

    The flag does reach one thing outside this process. `frappe.get_meta` caches
    every `Meta` it builds into `frappe.client_cache`, which is redis-backed and
    shared with the web workers, and `Meta.set_custom_permissions` returns early
    under `in_install`. A doctype first met inside this block would therefore be
    published to the served site with its `Custom DocPerm` rows missing. So the
    block drops the cached metas on the way out, before litmus connects. They
    rebuild on first use, with the site's own permissions.
    """
    previous = frappe.flags.in_install
    frappe.flags.in_install = True
    try:
        yield
    finally:
        frappe.flags.in_install = previous
        clear_meta_cache()


def mount_refusal(user: str) -> str | None:
    """Why `MKCOL /dav/litmus/` would be refused, or None when it would not.

    This is the gate `structure.handle_mkcol` applies at the top of the
    namespace, read back the way the served site reads it: the caller's
    Personal Root has to resolve, and §12.1's UPLOAD has to hold on it. Both
    halves answer 409 with the same message, so litmus cannot tell them apart
    and neither can a reader of its output.

    litmus creates that one collection before it runs a single case, in every
    one of the five groups. A mount that fails either half therefore stops
    every group in `begin` with `409 CONFLICT`, which reads as a defect in the
    protocol rather than a fixture that was never there.

    The principals are the user's own, not the caller's: `bench execute` runs
    as Administrator, and `require` answers MANAGE to an admin for any node, so
    asking with the caller's identity would pass on a mount litmus cannot use.
    """
    root = personal_root_for(user)
    if not root:
        return f"{user} has no Active Personal Root, so /dav/ has no mount"
    try:
        validate_root_pair(root)
    except frappe.ValidationError as e:
        return f"the Personal Root pair {root} is not valid: {e}"

    pathmap.reset_memo()
    resolved = pathmap.resolve([LITMUS_COLLECTION], user)
    if resolved.parent is None:
        return f"/dav/ does not resolve to the Personal Root of {user}"
    try:
        require(resolved.parent, UPLOAD, framework.principals_for(user))
    except frappe.ValidationError as e:
        return f"{user} does not hold UPLOAD on their own Personal Root: {e}"
    return None


def ensure_mount(user: str) -> None:
    """Leave the user one Personal Root that DAV can write into.

    `provision_personal_root` returns as soon as a `Drive Root` row exists for
    the user, without asking whether the pair it names still serves. A root
    row whose node is gone, or a root with no anchor grant, therefore survives
    it untouched and `prepare` hands litmus a URL for a namespace with no
    usable mount.

    The litmus user is a throwaway, so a mount that will not serve is replaced
    rather than repaired -- the same replacement `teardown` performs, for the
    same reason: the root is the mount, so rebuilding it is the whole repair.
    """
    if personal_root_for(user) and mount_refusal(user):
        drop_personal_root(user)
    provision_personal_root(user)


def prepare() -> str:
    """Create the throwaway litmus user, enable WebDAV, return the DAV URL.

    The URL is `/dav/` itself: the one mount is the user's Personal Root, so
    there is no `Home` collection to point litmus at any more (§12).

    The mount is proved after the commit, not before, because the commit is
    what the served site reads. A refusal here is raised rather than returned:
    `run_litmus.sh` must stop on a fixture that is not there instead of
    reporting five groups of 409s against a namespace with no mount.
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
    ensure_mount(LITMUS_USER)
    enable_user_webdav(LITMUS_USER)
    frappe.db.set_single_value("Drive Disk Settings", "webdav_enabled", 1)
    frappe.clear_document_cache("Drive Disk Settings", "Drive Disk Settings")
    frappe.db.commit()

    if refusal := mount_refusal(LITMUS_USER):
        raise LitmusFixtureError(f"the DAV mount litmus needs is not there: {refusal}")
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
