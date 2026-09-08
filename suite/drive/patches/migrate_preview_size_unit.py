import frappe

# `preview_size` used to mean a megabyte in-browser preview cutoff, and
# `patches.remove_personal` pinned every site to 100 under that contract.
# §9.2 redefined the same field as the generated preview's longest side in
# pixels, `reqd: 1`, `default: 512` (see `_core/previews.py`). A site whose
# stored value is still exactly this legacy sentinel has not been touched
# since the old patch wrote it; any other stored value is a genuine
# post-transition choice and must survive this patch untouched.
LEGACY_MEGABYTE_CUTOFF = 100
PIXEL_DEFAULT = 512


def execute() -> None:
    """Translate the legacy `preview_size=100` sentinel to the pixel default.

    Additive and idempotent: it only ever writes the one known legacy value
    forward, never derives a value from anything Build or Cleanup removes,
    and running it again after the value has already moved to 512 (or to
    any other explicit value) is a no-op.
    """
    if frappe.db.get_single_value("Drive Disk Settings", "preview_size") == LEGACY_MEGABYTE_CUTOFF:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", PIXEL_DEFAULT)
