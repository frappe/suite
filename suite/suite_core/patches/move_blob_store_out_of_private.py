import os
import shutil

import frappe
from frappe.utils import get_bench_path

from suite.store import get_blob_base_path


def execute() -> None:
    """Relocate the blob store from ``private/blob-store`` to the site directory root.

    Frappe Cloud backs up the entire ``private`` directory, so even after moving out of
    ``private/files`` the blob cache still landed in every site backup. It now sits directly
    under the site directory (``sites/<site>/blob-store``), which backups do not include.
    Migrating is a single directory move — the internal layout is unchanged.

    Best-effort: blobs are a cache refetched on demand, so if the new directory already exists
    (an interrupted earlier run, or stores already created at the new location) the old directory
    is simply dropped rather than merged.
    """

    old_path = os.path.join(get_bench_path(), "sites", frappe.local.site, "private", "blob-store")
    if not os.path.isdir(old_path) or os.path.islink(old_path):
        return

    new_path = get_blob_base_path()
    if os.path.exists(new_path):
        shutil.rmtree(old_path, ignore_errors=True)
        return

    os.rename(old_path, new_path)
