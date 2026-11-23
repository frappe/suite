import frappe
from frappe.utils import cint

from suite.drive._core.previews import PREVIEW_LONGEST_SIDE, is_plausible_preview_size

# `preview_size` used to mean something other than pixels: the since-deleted
# `remove_personal` patch pinned it to 100 as a megabyte cutoff, and restored
# sites carry other old values, such as 250000. §9.2 redefined the same field
# as the generated preview's longest side in pixels, `reqd: 1`, `default: 512`,
# and the doctype now refuses a value outside 128..2048 (see `_core/previews.py`).
# A stored value outside that range cannot be a pixel choice, so it is a
# legacy value. A value inside it is a genuine choice and must survive.


def execute() -> None:
    """Move a legacy `preview_size` to the pixel default.

    Idempotent: a value already in the pixel range is left as it is, so
    running it again after the value has moved to 512 is a no-op.
    """
    value = cint(frappe.db.get_single_value("Drive Disk Settings", "preview_size"))
    if not is_plausible_preview_size(value):
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", PREVIEW_LONGEST_SIDE)
