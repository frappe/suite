from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from suite.composition import lifecycle
from suite.content import convert, log
from suite.slides.content import APP, turn_on
from suite.slides.patches import turn_collaboration_on


def rows() -> list[tuple[str, str]]:
    found = frappe.get_all(
        "Suite Collab App",
        filters={"parent": "Suite Collab Settings", "parentfield": "apps"},
        fields=["app", "mode"],
        order_by="idx",
    )
    return [(row.app, row.mode) for row in found]


def remove_slides_row() -> None:
    # Straight from the table, since saving Settings refuses it
    frappe.db.delete("Suite Collab App", {"parent": "Suite Collab Settings", "app": APP})
    frappe.clear_document_cache("Suite Collab Settings", "Suite Collab Settings")


class TestSlidesSwitch(IntegrationTestCase):
    """Slides' collaboration is turned on at install and migrate, and then stays on."""

    def setUp(self):
        super().setUp()
        fields = frappe.db.get_table_columns("Suite Collab App")
        saved = frappe.get_all(
            "Suite Collab App", filters={"parent": "Suite Collab Settings"}, fields=fields, as_list=True
        )
        self.addCleanup(frappe.clear_document_cache, "Suite Collab Settings", "Suite Collab Settings")
        self.addCleanup(frappe.db.commit)
        self.addCleanup(frappe.db.bulk_insert, "Suite Collab App", fields, saved)
        self.addCleanup(frappe.db.delete, "Suite Collab App", {"parent": "Suite Collab Settings"})

    def test_turning_on_adds_slides_row_when_it_has_none(self):
        remove_slides_row()
        self.assertEqual(log.mode(APP), "off")

        turn_on()

        self.assertEqual(log.mode(APP), "on")

    def test_a_fresh_install_turns_slides_on(self):
        remove_slides_row()

        # Only Slides' step: the other products' steps already ran on this site
        def slides_step_only(label, func, *args, **kwargs):
            if label == "slides.turn_on":
                return func(*args, **kwargs)

        with patch.object(lifecycle, "_run", side_effect=slides_step_only) as run:
            lifecycle.after_install()

        self.assertIn("slides.turn_on", [call.args[0] for call in run.call_args_list])
        self.assertEqual(log.mode(APP), "on")

    def test_the_patch_run_twice_leaves_one_slides_row_on_and_other_apps_alone(self):
        others = [row for row in rows() if row[0] != APP]
        remove_slides_row()

        turn_collaboration_on.execute()
        turn_collaboration_on.execute()

        self.assertEqual([row for row in rows() if row[0] == APP], [(APP, "on")])
        self.assertEqual([row for row in rows() if row[0] != APP], others)

    def test_the_patch_turning_slides_on_pauses_its_conversion(self):
        remove_slides_row()

        turn_collaboration_on.execute()

        self.assertFalse(convert.may_convert(APP))

    def test_conversion_starts_once_the_owner_unpauses_it(self):
        remove_slides_row()
        turn_collaboration_on.execute()

        settings = frappe.get_single("Suite Collab Settings")
        next(row for row in settings.apps if row.app == APP).conversion_paused = 0
        settings.save(ignore_permissions=True)

        self.assertTrue(convert.may_convert(APP))

    def test_the_patch_run_again_leaves_an_unpaused_slides_unpaused(self):
        remove_slides_row()
        turn_collaboration_on.execute()
        settings = frappe.get_single("Suite Collab Settings")
        next(row for row in settings.apps if row.app == APP).conversion_paused = 0
        settings.save(ignore_permissions=True)

        turn_collaboration_on.execute()

        self.assertTrue(convert.may_convert(APP))

    def test_slides_cannot_be_turned_off_or_removed(self):
        turn_on()
        # Even with no logs or conversion, which would refuse it on their own
        for name in ("suite.content.log.has_logs", "suite.content.conversions.conversion_started"):
            stub = patch(name, return_value=False)
            stub.start()
            self.addCleanup(stub.stop)

        with self.assertRaisesRegex(frappe.ValidationError, f"Collaboration in {APP} can't be turned off"):
            log.set_mode(APP, "off")

        settings = frappe.get_single("Suite Collab Settings")
        settings.apps = [row for row in settings.apps if row.app != APP]
        with self.assertRaisesRegex(frappe.ValidationError, f"Collaboration in {APP} can't be turned off"):
            settings.save(ignore_permissions=True)

        self.assertEqual(log.mode(APP), "on")
