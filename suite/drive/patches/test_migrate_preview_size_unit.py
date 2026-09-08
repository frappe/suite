import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.patches.migrate_preview_size_unit import execute


class MigratePreviewSizeUnit(IntegrationTestCase):
    """§9.2 redefined `preview_size` from a megabyte cutoff to pixels.

    A site upgraded before this ticket can still carry the old
    `remove_personal` patch's sentinel value of 100. This patch must move
    that one known legacy value forward to the new pixel default without
    touching a genuine post-transition choice, including one that happens
    to already read 512 or one nobody has ever changed from the doctype's
    own default.
    """

    def setUp(self) -> None:
        self.addCleanup(frappe.db.set_single_value, "Drive Disk Settings", "preview_size", self._original())

    def _original(self) -> int:
        return frappe.db.get_single_value("Drive Disk Settings", "preview_size")

    def test_translates_the_legacy_megabyte_sentinel_to_pixels(self) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 100)

        execute()

        self.assertEqual(frappe.db.get_single_value("Drive Disk Settings", "preview_size"), 512)

    def test_leaves_an_explicit_non_legacy_value_untouched(self) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 1024)

        execute()

        self.assertEqual(frappe.db.get_single_value("Drive Disk Settings", "preview_size"), 1024)

    def test_leaves_the_current_pixel_default_untouched(self) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 512)

        execute()

        self.assertEqual(frappe.db.get_single_value("Drive Disk Settings", "preview_size"), 512)

    def test_rerun_after_translation_is_a_noop(self) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 100)
        execute()

        execute()

        self.assertEqual(frappe.db.get_single_value("Drive Disk Settings", "preview_size"), 512)
