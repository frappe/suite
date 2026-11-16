# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import os

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import get_files_path

from suite.slides.doctype.presentation.patches.cleanup_unused_thumbnail_files import (
    execute as cleanup_unused_thumbnail_files,
)
from suite.slides.doctype.presentation.patches.cleanup_unused_thumbnail_files import (
    get_unused_thumbnail_files,
)
from suite.slides.doctype.presentation.patches.clear_missing_presentation_thumbnails import (
    execute as clear_missing_presentation_thumbnails,
)
from suite.slides.doctype.presentation.patches.move_slide_thumbnail_to_presentation import (
    execute as move_slide_thumbnail_to_presentation,
)
from suite.slides.tests.utils import PNG_1PX, make_presentation, unique_bytes
from suite.tests.utils import column_hidden


def thumbnail_of(presentation_name):
    # the field left the DocType, so only SQL reaches the column it left behind
    ((thumbnail,),) = frappe.db.sql(
        "SELECT `thumbnail` FROM `tabPresentation` WHERE `name` = %s", presentation_name
    )
    return thumbnail


def set_thumbnail(presentation_name, file_url):
    frappe.db.sql(
        "UPDATE `tabPresentation` SET `thumbnail` = %s WHERE `name` = %s", (file_url, presentation_name)
    )


class ThumbnailColumnCase(IntegrationTestCase):
    """Gives the class the old `thumbnail` column, or hides it, and puts back what it found."""

    column_present: bool

    @classmethod
    def setUpClass(cls):
        # Before the base class's rollback, so these run after it: DDL commits what it finds open
        found = frappe.db.has_column("Presentation", "thumbnail")
        if found and not cls.column_present:
            cls.enterClassContext(column_hidden("Presentation", "thumbnail"))
        elif cls.column_present and not found:
            cls.alter_column("ADD COLUMN `thumbnail` text")
            cls.addClassCleanup(cls.alter_column, "DROP COLUMN `thumbnail`")

        super().setUpClass()

    @staticmethod
    def alter_column(change):
        frappe.db.sql_ddl(f"ALTER TABLE `tabPresentation` {change}")
        # The column list is cached per table and DDL does not refresh it
        frappe.client_cache.delete_value("table_columns::tabPresentation")

    def make_legacy_thumbnail_file(self, presentation_name):
        """A thumbnail as the patches find it: a pre-webp name under /private/files.

        Written straight to the table: a Storage v2 File controller would ingest
        the bytes into a blob and rewrite the url to `/private/files/<blob>/`. Rows that predate v2
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


class TestThumbnailPatches(ThumbnailColumnCase):
    """A site from before the field left: its column still holds the old thumbnails (Q19')."""

    column_present = True

    def test_cleanup_keeps_thumbnail_referenced_only_by_the_deck(self):
        referenced = make_presentation("Deck With Legacy Thumbnail")
        kept = self.make_legacy_thumbnail_file(referenced.name)
        set_thumbnail(referenced.name, kept.file_url)

        orphan = self.make_legacy_thumbnail_file(make_presentation("Deck Without Thumbnail").name)

        unused = {file.name for file in get_unused_thumbnail_files()}
        self.assertNotIn(kept.name, unused)
        self.assertIn(orphan.name, unused)

    def test_missing_thumbnail_blob_is_cleared(self):
        presentation = make_presentation("Deck With Deleted Thumbnail")
        set_thumbnail(presentation.name, "/files/thumbnail-deleted.png")

        clear_missing_presentation_thumbnails()

        self.assertEqual(thumbnail_of(presentation.name), "")

    def test_present_thumbnail_blob_is_kept(self):
        presentation = make_presentation("Deck With Live Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        set_thumbnail(presentation.name, file.file_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(thumbnail_of(presentation.name), file.file_url)

    def test_thumbnail_sanitized_to_the_public_prefix_is_kept(self):
        # sanitize_attachment_urls stripped /private from the stored string only, so the
        # field and its live File row disagree on the prefix
        presentation = make_presentation("Presentation With Sanitized Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        sanitized_url = file.file_url.replace("/private", "", 1)
        set_thumbnail(presentation.name, sanitized_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(thumbnail_of(presentation.name), sanitized_url)

    def test_thumbnail_backed_by_a_file_row_is_kept(self):
        # the blob need not sit on local disk: a surviving File row means some storage
        # backend still owns it, so the field is not ours to clear
        presentation = make_presentation("Deck With Remote Thumbnail")
        file = self.make_legacy_thumbnail_file(presentation.name)
        os.remove(frappe.get_doc("File", file.name).get_full_path())
        set_thumbnail(presentation.name, file.file_url)

        clear_missing_presentation_thumbnails()

        self.assertEqual(thumbnail_of(presentation.name), file.file_url)


class TestPatchesWithTheColumnGone(ThumbnailColumnCase):
    """A site installed after the field left never had the column, and still runs the old patches (Q19')."""

    column_present = False

    def test_the_old_thumbnail_patches_run_and_still_sweep_an_unused_file(self):
        suffix = frappe.generate_hash(6)
        presentation = make_presentation(f"Deck On A New Site {suffix}")
        orphan = self.make_legacy_thumbnail_file(presentation.name)

        move_slide_thumbnail_to_presentation()
        cleanup_unused_thumbnail_files()
        clear_missing_presentation_thumbnails()

        self.assertFalse(frappe.db.exists("File", orphan.name))
