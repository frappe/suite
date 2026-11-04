import frappe
from frappe.tests import IntegrationTestCase

from suite.drive.patches.migrate_preview_size_unit import execute


class MigratePreviewSizeUnit(IntegrationTestCase):
    """§9.2 redefined `preview_size` from a megabyte cutoff to pixels.

    A site upgraded before this ticket can still carry an old value: the
    100 the since-deleted `remove_personal` patch wrote, or a value such as
    250000 that a restored site brought along. Any value outside the pixel
    range a preview may use must move to the pixel default. A genuine pixel
    choice must survive, including one that already reads 512.
    """

    def setUp(self) -> None:
        self.addCleanup(frappe.db.set_single_value, "Drive Disk Settings", "preview_size", self._stored())

    def _stored(self) -> int:
        return frappe.db.get_single_value("Drive Disk Settings", "preview_size")

    def test_a_value_outside_the_pixel_range_becomes_the_pixel_default(self) -> None:
        for legacy in (100, 250000, 0, -1, 127, 2049):
            with self.subTest(legacy=legacy):
                frappe.db.set_single_value("Drive Disk Settings", "preview_size", legacy)

                execute()

                self.assertEqual(self._stored(), 512)

    def test_a_pixel_choice_is_left_untouched(self) -> None:
        for choice in (128, 512, 1024, 2048):
            with self.subTest(choice=choice):
                frappe.db.set_single_value("Drive Disk Settings", "preview_size", choice)

                execute()

                self.assertEqual(self._stored(), choice)

    def test_rerun_after_translation_is_a_noop(self) -> None:
        frappe.db.set_single_value("Drive Disk Settings", "preview_size", 250000)
        execute()

        execute()

        self.assertEqual(self._stored(), 512)
