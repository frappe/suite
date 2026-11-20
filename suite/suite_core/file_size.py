"""Suite's default per-file upload limit."""

import frappe
from frappe.core.doctype.system_settings.system_settings import clear_system_settings_cache
from frappe.utils import cint

# Frappe's own default is 25 MB, small for a Drive. System Settings stores MB.
DEFAULT_MAX_FILE_SIZE_MB = 1024


def set_default_max_file_size() -> None:
    """Give the site a 1 GB per-file limit, unless it has chosen its own.

    The limit is Frappe's `max_file_size`, which every Frappe upload path
    reads: System Settings in MB, else site config in bytes. A site that sets
    either keeps its value, larger or smaller.
    """
    if cint(frappe.db.get_single_value("System Settings", "max_file_size")):
        return
    if cint(frappe.conf.get("max_file_size")):
        return
    frappe.db.set_single_value("System Settings", "max_file_size", DEFAULT_MAX_FILE_SIZE_MB)
    # `set_single_value` clears the copies in Redis and on the request, but
    # not this process's client cache, which `get_system_settings` reads.
    clear_system_settings_cache()
