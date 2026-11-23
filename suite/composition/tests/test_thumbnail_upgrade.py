import json

import frappe

from suite.drive.patches.build.slides import convert_slides_and_templates
from suite.drive.tests.test_build_content import STAMP, BuildContentCase, png_bytes
from suite.slides.doctype.presentation.patches.cleanup_unused_thumbnail_files import (
    execute as cleanup_unused_thumbnail_files,
)
from suite.slides.doctype.presentation.patches.clear_missing_presentation_thumbnails import (
    execute as clear_missing_presentation_thumbnails,
)
from suite.slides.doctype.presentation.patches.move_slide_thumbnail_to_presentation import (
    execute as move_slide_thumbnail_to_presentation,
)


class TestThumbnailPatchesThenBuild(BuildContentCase):
    """Slides' old thumbnail patches, then Drive's Build, in the order a migrating site runs them (Q19')."""

    def test_the_old_thumbnail_patches_then_build_keep_every_preview_with_the_field_gone(self):
        # the field left the meta, and its column keeps the values migration reads
        self.assertFalse(frappe.get_meta("Presentation").has_field("thumbnail"))
        deck = self.deck_fixture()
        # move_slide_thumbnail_to_presentation lifts this deck's first slide thumbnail onto it
        lifted = self.prefix + "deck2"
        lifted_node = self.content_pair(lifted, "Presentation", title="Lifted")
        self.insert("Presentation", lifted, title="Lifted", is_template=0, is_composite=0)
        slide_thumb = self.blob(png_bytes((600, 300), self.prefix + "slide"), "slide.png")
        slide_thumb_url = f"/files/{self.prefix}slide.png"
        self.legacy_file(
            self.prefix + "m4",
            file_name="slide.png",
            file_url=slide_thumb_url,
            blob=slide_thumb.name,
            attached_to_doctype="Presentation",
            attached_to_name=lifted,
            file_modified=STAMP,
        )
        self.insert(
            "Slide",
            self.prefix + "s3",
            parent=lifted,
            parenttype="Presentation",
            parentfield="slides",
            idx=1,
            elements=json.dumps([{"type": "text", "text": "hi"}]),
            thumbnail=slide_thumb_url,
        )

        for _ in range(2):
            move_slide_thumbnail_to_presentation()
            cleanup_unused_thumbnail_files()
            clear_missing_presentation_thumbnails()
            convert_slides_and_templates(self.environment())

            self.assertEqual(self.deck_thumbnail(deck["docname"]), f"/files/{self.prefix}thumb.png")
            self.assertEqual(self.deck_thumbnail(lifted), slide_thumb_url)
            self.assertEqual(self.previews(deck["node"]), [deck["thumbnail"]])
            self.assertEqual(self.previews(lifted_node), [self.prefix + "m4"])
            self.assertEqual(
                [(row["name"], row["blob"]) for row in self.media_children(deck["node"])],
                [(deck["keeper"], deck["media_blob"])],
            )
            self.assertEqual(self.media_children(lifted_node), [])

    def previews(self, node):
        return frappe.get_all("Drive Node Preview", filters={"node": node}, pluck="name")
