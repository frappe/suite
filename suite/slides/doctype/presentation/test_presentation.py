# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.client import set_value
from frappe.tests import IntegrationTestCase

from suite.slides.doctype.presentation.presentation import (
    create_presentation,
    delete_presentation,
    get_composite_presentation,
    get_public_presentation,
    get_updated_json,
    save_base64_image,
    save_presentation_thumbnail,
    update_slide_attachments,
    update_title,
)
from suite.slides.tests.utils import (
    PNG_1PX,
    make_presentation,
    make_private,
    make_private_image,
    make_public,
)
from suite.tests.utils import ensure_user

SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="

OWNER = "slides-owner@example.com"
OTHER_USER = "slides-other@example.com"


class TestPresentationSecurity(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)
        ensure_user(OTHER_USER)

        with cls.set_user(OWNER):
            cls.owner_presentation = make_presentation("Owner Presentation").name
            cls.private_file = make_private_image(cls.owner_presentation)

        with cls.set_user(OTHER_USER):
            cls.other_presentation = make_presentation("Other User Presentation").name

    def test_endpoints_require_permission(self):
        cases = [
            (save_base64_image, PNG_1PX, self.owner_presentation, "x"),
            (update_slide_attachments, self.owner_presentation, {"elements": "[]"}),
            (get_updated_json, self.owner_presentation, []),
            (save_presentation_thumbnail, self.owner_presentation, PNG_1PX),
            (update_title, self.owner_presentation, "Hijacked"),
            (get_public_presentation, self.owner_presentation),
            (delete_presentation, self.owner_presentation),
        ]
        for func, *args in cases:
            with self.subTest(func.__name__), self.set_user(OTHER_USER):
                with self.assertRaises(frappe.PermissionError):
                    func(*args)

    def test_duplicate_requires_read(self):
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                create_presentation(duplicate_from=self.owner_presentation)

    def test_updated_json_blocks_file_exfil(self):
        exfil = [{"type": "image", "src": self.private_file.file_url}]
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.PermissionError):
                get_updated_json(self.other_presentation, exfil)

    def test_save_image_rejects_bad_data(self):
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.ValidationError):
                save_base64_image("not-a-data-uri", self.other_presentation, "x")

    def test_save_image_rejects_bad_extension(self):
        with self.set_user(OTHER_USER):
            with self.assertRaises(frappe.ValidationError):
                save_base64_image(SVG, self.other_presentation, "x")

    def test_save_image_accepts_valid_png(self):
        with self.set_user(OTHER_USER):
            url = save_base64_image(PNG_1PX, self.other_presentation, "x")

        self.assertTrue(url.endswith(".png"))
        file = frappe.get_doc("File", {"file_url": url})
        self.assertEqual(file.is_private, 1)
        self.assertEqual(file.attached_to_doctype, "Presentation")
        self.assertEqual(file.attached_to_name, self.other_presentation)

    def test_composite_blocks_private_presentation(self):
        with self.set_user("Guest"):
            with self.assertRaises(frappe.PermissionError):
                get_composite_presentation(self.owner_presentation)

    def test_composite_serves_public_presentation_to_guest(self):
        with self.set_user(OWNER):
            ref = make_presentation("Public Reference")
            make_public(ref.name)
            composite = frappe.get_doc(
                {
                    "doctype": "Presentation",
                    "title": "Composite Presentation",
                    "is_composite": 1,
                    "reference_presentations": [{"presentation": ref.name}],
                }
            ).insert()

        with self.set_user("Guest"):
            result = get_composite_presentation(composite.name)

        self.assertEqual(len(result["slides"]), len(ref.slides))

    def test_composite_excludes_reference_made_private_later(self):
        with self.set_user(OWNER):
            ref = make_presentation("Later Private Reference")
            make_public(ref.name)
            composite = frappe.get_doc(
                {
                    "doctype": "Presentation",
                    "title": "Stale Composite",
                    "is_composite": 1,
                    "reference_presentations": [{"presentation": ref.name}],
                }
            ).insert()
            make_private(ref.name)

        with self.set_user("Guest"):
            result = get_composite_presentation(composite.name)

        self.assertEqual(result["slides"], [])


class TestSlideRows(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

    def test_slide_resent_without_a_name_is_reinserted(self):
        """Undoing a delete restores a slide whose row an autosave already dropped, so
        the editor blanks the row name and the next save has to insert it again."""
        with self.set_user(OWNER):
            presentation = make_presentation("Undo Delete Presentation")
            presentation.append("slides", {"elements": "[]"})
            presentation.save()
            kept, removed = (slide.as_dict() for slide in presentation.slides)

            set_value("Presentation", presentation.name, {"slides": [kept]})
            self.assertFalse(frappe.db.exists("Slide", removed.name))

            restored = removed.copy()
            restored.name = ""
            set_value("Presentation", presentation.name, {"slides": [kept, restored]})

        slides = frappe.get_doc("Presentation", presentation.name).slides
        self.assertEqual(len(slides), 2)
        self.assertEqual(slides[0].name, kept.name)
        self.assertNotIn(slides[1].name, ("", removed.name))
