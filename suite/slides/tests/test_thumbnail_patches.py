# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import os

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import get_files_path

from suite.slides.doctype.presentation.patches.cleanup_unused_thumbnail_files import (
    get_unused_thumbnail_files,
)
from suite.slides.doctype.presentation.patches.clear_missing_presentation_thumbnails import (
    execute as clear_missing_presentation_thumbnails,
)
from suite.slides.tests.utils import PNG_1PX, make_presentation, unique_bytes


class TestThumbnailPatches(IntegrationTestCase):
    def make_legacy_thumbnail_file(self, presentation_name):
        """A thumbnail as the patches find it: a pre-webp name under /private/files.

        Written straight to the table: a Storage v2 File controller would ingest
        the bytes into a blob and rewrite the url to `/f/`. Rows that predate v2
        keep their legacy url (`frappe.storage.backfill` does not rewrite it).
        """
        file_name = f"thumbnail-legacy-{frappe.generate_hash(8)}.png"
        path = get_files_path(file_name, is_private=1)
        with open(path, "wb") as f:
            f.write(unique_bytes(PNG_1PX))
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))

        file = frappe.get_doc(
            {
                "doctype": "File",
                "name": frappe.generate_hash(10),
                "file_name": file_name,
                "file_url": f"/private/files/{file_name}",
                "is_private": 1,
                "attached_to_doctype": "Presentation",
                "attached_to_name": presentation_name,
            }
        )
        file.db_insert()
        return file

    def test_cleanup_keeps_thumbnail_referenced_only_by_the_deck(self):
        referenced = make_presentation("Deck With Legacy Thumbnail")
        kept = self.make_legacy_thumbnail_file(referenced.name)
        frappe.db.set_value("Presentation", referenced.name, "thumbnail", kept.file_url)

        orphan = self.make_legacy_thumbnail_file(make_presentation("Deck Without Thumbnail").name)

        unused = {file.name for file in get_unused_thumbnail_files()}
        self.assertNotIn(kept.name, unused)
        self.assertIn(orphan.name, unused)

    def test_missing_thumbnail_blob_is_cleared(self):
        presentation = make_presentation("Deck With Deleted Thumbnail")
        frappe.db.set_value("Presentation", presentation.name, "thumbnail", "/files/thumbnail-deleted.png")

        clear_missing_presentation_thumbnails()

        self.assertEqual(frappe.db.get_value("Presentation", presentation.name, "thumbnail"), "")

    def test_present_thumbnail_blob_is_kept(self):
        presentation = make_presentation("Deck With Live Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        frappe.db.set_value("Presentation", presentation.name, "thumbnail", file.file_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(frappe.db.get_value("Presentation", presentation.name, "thumbnail"), file.file_url)

    def test_thumbnail_sanitized_to_the_public_prefix_is_kept(self):
        # sanitize_attachment_urls stripped /private from the stored string only, so the
        # field and its live File row disagree on the prefix
        presentation = make_presentation("Presentation With Sanitized Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        sanitized_url = file.file_url.replace("/private", "", 1)
        frappe.db.set_value("Presentation", presentation.name, "thumbnail", sanitized_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(frappe.db.get_value("Presentation", presentation.name, "thumbnail"), sanitized_url)

    def test_thumbnail_backed_by_a_file_row_is_kept(self):
        # the blob need not sit on local disk: a surviving File row means some storage
        # backend still owns it, so the field is not ours to clear
        presentation = make_presentation("Deck With Remote Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        os.remove(frappe.get_doc("File", file.name).get_full_path())
        frappe.db.set_value("Presentation", presentation.name, "thumbnail", file.file_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(frappe.db.get_value("Presentation", presentation.name, "thumbnail"), file.file_url)
