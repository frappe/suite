import os
import shutil

import frappe
from frappe.utils import get_bench_path

from suite.store import get_blob_base_path


def execute() -> None:
    """Relocate the blob store from ``private/files/blob-store`` to the current blob base path.

    The blob store used to live inside ``private/files``, so every files backup tarred the whole
    blob cache. It now sits at ``get_blob_base_path()`` (the site directory root), which backups
    do not include. Migrating is a single directory move — the internal layout is unchanged.

    Best-effort: blobs are a cache refetched on demand, so if the new directory already exists
    (an interrupted earlier run, or stores already created at the new location) the old directory
    is simply dropped rather than merged.
    """

    old_path = os.path.join(get_bench_path(), "sites", frappe.local.site, "private", "files", "blob-store")
    if not os.path.isdir(old_path) or os.path.islink(old_path):
        return

    new_path = get_blob_base_path()
    if os.path.exists(new_path):
        shutil.rmtree(old_path, ignore_errors=True)
        return

    os.rename(old_path, new_path)
