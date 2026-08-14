# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import io
import os

import frappe
from frappe.client import set_value
from frappe.tests import IntegrationTestCase
from PIL import Image

from suite.slides.doctype.presentation.presentation import (
    create_presentation,
    delete_presentation,
    get_composite_presentation,
    get_public_presentation,
    get_templates,
    get_updated_json,
    get_webp_doc,
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
    make_thumbnail_data,
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

    def test_create_rejects_a_template_that_no_longer_exists(self):
        for template in ("this-template-was-deleted", None, ""):
            with self.subTest(template=template):
                with self.assertRaises(frappe.DoesNotExistError):
                    create_presentation(template=template)

    def test_create_rejects_a_presentation_that_is_not_a_template(self):
        # readable is not enough. `theme` has to name a template or the editor cannot
        # resolve layouts for the slides added later, and the same throw covers a deck
        # the caller cannot read so neither answer leaks whether it exists
        with self.set_user(OWNER):
            own = make_presentation("Not A Template").name

        for presentation in (own, self.other_presentation):
            with self.subTest(presentation=presentation):
                with self.set_user(OWNER):
                    with self.assertRaises(frappe.DoesNotExistError):
                        create_presentation(template=presentation)

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
        self.assertEqual(file.file_type, "Image")
        self.assertEqual(file.mime_type, "image/png")
        self.assertEqual(file.attached_to_doctype, "Presentation")
        self.assertEqual(file.attached_to_name, self.other_presentation)

    def test_webp_conversion_keeps_drive_image_metadata(self):
        content = io.BytesIO()
        Image.new("RGB", (2, 1), (17, 34, 51)).save(content, "PNG")

        with self.set_user(OWNER):
            source = make_private_image(self.owner_presentation, content.getvalue())
            converted = get_webp_doc(self.owner_presentation, source.as_dict())

        self.assertEqual(converted.file_type, "Image")
        self.assertEqual(converted.mime_type, "image/webp")

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

    def test_thumbnail_file_is_linked_to_its_field(self):
        with self.set_user(OWNER):
            presentation = make_presentation("Linked Thumbnail")
            url = save_presentation_thumbnail(presentation.name, make_thumbnail_data())

        file = frappe.get_doc("File", {"file_url": url})
        self.assertEqual(file.attached_to_doctype, "Presentation")
        self.assertEqual(file.attached_to_name, presentation.name)
        self.assertEqual(file.attached_to_field, "thumbnail")

    def test_saving_deck_does_not_duplicate_thumbnail_file(self):
        # the framework's attach hook re-creates any Attach value it cannot match to a
        # File, so an unlinked thumbnail grew a shadow File on every save of the deck
        with self.set_user(OWNER):
            presentation = make_presentation("Resaved Thumbnail")
            url = save_presentation_thumbnail(presentation.name, make_thumbnail_data())
            presentation.reload()
            presentation.title = "Resaved Thumbnail, again"
            presentation.save()

        self.assertEqual(frappe.db.count("File", {"file_url": url}), 1)

    def test_duplicate_owns_its_thumbnail_file(self):
        # content-hash dedup means both decks share one blob; what matters is that the
        # copy holds its own File row, so the blob outlives the source's
        with self.set_user(OWNER):
            source = make_presentation("Duplicated Thumbnail")
            save_presentation_thumbnail(source.name, make_thumbnail_data())
            copy = create_presentation(duplicate_from=source.name)

        file = frappe.get_doc("File", {"file_url": copy.thumbnail, "attached_to_name": copy.name})
        self.assertEqual(file.attached_to_doctype, "Presentation")
        self.assertEqual(file.attached_to_field, "thumbnail")

    def test_duplicate_drops_a_thumbnail_whose_blob_is_gone(self):
        # inheriting the URL would leave the copy dangling for good: the attach hook
        # cannot re-create the File, so every later save of it logs the failure
        with self.set_user(OWNER):
            source = make_presentation("Missing Blob Source")
            url = save_presentation_thumbnail(source.name, make_thumbnail_data())
            os.remove(frappe.get_doc("File", {"file_url": url}).get_full_path())

            copy = create_presentation(duplicate_from=source.name)

        self.assertEqual(copy.thumbnail, "")

    def test_asset_backed_cover_is_kept_as_is(self):
        cover = "/assets/suite/slides/frontend/images/layouts/light/thumbnail-3.webp"
        with self.set_user(OWNER):
            template = make_presentation("Asset Cover Template")
            frappe.db.set_value("Presentation", template.name, {"is_template": 1, "thumbnail": cover})
            presentation = create_presentation(template=template.name)

        self.assertEqual(presentation.thumbnail, cover)

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


class TestTemplates(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(OWNER)

        with cls.set_user(OWNER):
            cls.one_layout = make_presentation("One Layout Template")

            cls.three_layouts = make_presentation("Three Layout Template")
            cls.three_layouts.append("slides", {"elements": "[]"})
            cls.three_layouts.append("slides", {"elements": "[]"})
            cls.three_layouts.save()

        for template in (cls.one_layout, cls.three_layouts):
            frappe.db.set_value("Presentation", template.name, "is_template", 1)

    def test_layouts_are_grouped_per_template_in_idx_order(self):
        # one bulk query feeds every template, so a grouping slip shows up only when the
        # templates differ in size
        by_name = {template["name"]: template for template in get_templates()}

        self.assertEqual(len(by_name[self.one_layout.name]["layouts"]), 1)

        layouts = by_name[self.three_layouts.name]["layouts"]
        self.assertEqual([layout["idx"] for layout in layouts], [1, 2, 3])
        self.assertEqual(
            [layout["name"] for layout in layouts],
            [slide.name for slide in self.three_layouts.slides],
        )
        # the editor spreads a layout into a new child row, which needs its doctype
        self.assertEqual({layout["doctype"] for layout in layouts}, {"Slide"})


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
