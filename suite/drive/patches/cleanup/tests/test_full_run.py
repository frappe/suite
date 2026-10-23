"""§14.10 end to end: one `run_cleanup` call, every phase, checked against
what should and should not survive it — not just that each phase completed."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.patch import run_cleanup
from suite.drive.patches.cleanup.removal import RETAINED_DOCTYPES_STEP_3, RETAINED_DOCTYPES_STEP_4
from suite.drive.patches.cleanup.tests.fakes import (
    FakeContent,
    FakeFileTable,
    FakeSchema,
    FakeThumbnails,
    cleanup_environment,
    fake_blob_columns,
)


def _full_environment(tmp_path):
    files = (
        FakeFileTable()
        .add("Drive")
        .add("Users", folder=None)
        .add("a", folder="Drive", has_node=True)
        .add("trash", folder="Drive", status="Removed", has_node=False)
    )
    schema = FakeSchema(
        custom_fields={
            "section_break_nfot8",
            "mime_type",
            "status",
            "file_modified",
            "column_break_tapww",
            "content_doctype",
            "content_docname",
        },
        property_setters={
            ("File", "file_url", "depends_on"),
            ("File", "folder", "hidden"),
            ("File", "folder", "depends_on"),
        },
        doctypes=set(RETAINED_DOCTYPES_STEP_3) | set(RETAINED_DOCTYPES_STEP_4),
        columns={
            "Drive Notification": {
                "activity",
                "to_user",
                "read",
                "from_user",
                "type",
                "message",
                "notif_doctype",
                "notif_doctype_name",
                "entity_type",
            },
            "Presentation": {"title", "body"},
            "Sheet": {"title", "trashed", "trashed_on", "trashed_by", "head_snapshot", "sheets_data"},
            "Drive Settings": {"user_folder", "quota", "webdav_enabled"},
            "Drive Storage Reservation": {"storage_owner", "reserved_bytes"},
            "Drive Favourite": {"user", "node", "entity"},
            "Drive Root": {"node", "used_bytes", "acl_generation"},
        },
        singles={
            "Drive Disk Settings": {
                "quota",
                "root_folder",
                "thumbnail_prefix",
                "flat",
                "enabled",
                "bucket",
                "aws_key",
                "aws_secret",
                "endpoint_url",
                "signature_version",
            },
        },
    )
    # Build deleted the governed `DocShare` rows, so Cleanup only verifies
    # they are gone. A site that still had one never ran that Build.
    content = FakeContent(docshares=(), ycomments=1, sheets_with_comments=3)
    thumbnails = FakeThumbnails(existing={"a", "trash", "unrelated-home-file"})
    return cleanup_environment(
        tmp_path,
        files=files,
        blob_columns=fake_blob_columns(),
        schema=schema,
        content=content,
        thumbnails=thumbnails,
        backup="s3://backups/2026-09-09",
    )


class TestFullOrderedRun(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_a_complete_local_site_run_leaves_the_expected_final_state(self):
        env = _full_environment(self.path)
        results = run_cleanup(env)
        self.assertTrue(all(phase["completed"] for phase in results.values()))

        # Step 1: every Drive-owned/root/Removed row is gone; the unrelated
        # Home attachment plan was never even part of this fixture's rows.
        self.assertEqual(set(env.files.rows), set())

        # Step 2/3: the named custom fields, property setters, and step-3
        # doctypes are gone.
        self.assertEqual(env.schema.custom_fields, set())
        self.assertEqual(env.schema.property_setters, set())
        for doctype in RETAINED_DOCTYPES_STEP_3:
            self.assertNotIn(doctype, env.schema.doctypes)
        self.assertEqual(env.schema.columns["Drive Notification"], {"activity", "to_user", "read"})

        # Step 4: history doctypes gone, no governed share left,
        # ycomments/sheet-comments cleared.
        for doctype in RETAINED_DOCTYPES_STEP_4:
            self.assertNotIn(doctype, env.schema.doctypes)
        self.assertEqual(env.schema.doctypes, set())
        self.assertEqual(env.content.docshares, frozenset())
        self.assertEqual(env.content.ycomments, 0)
        self.assertEqual(env.content.sheets_with_comments, 0)

        # Step 5: title/trashed/settings columns gone, all ten §3.13 fields
        # among them; unrelated columns on the same doctypes survive.
        self.assertEqual(env.schema.columns["Presentation"], {"body"})
        self.assertEqual(env.schema.columns["Sheet"], {"sheets_data"})
        self.assertEqual(env.schema.columns["Drive Settings"], {"webdav_enabled"})
        self.assertEqual(env.schema.columns["Drive Storage Reservation"], {"reserved_bytes"})
        # All ten §3.13 fields drop as `tabSingles` rows, never as DDL against
        # a table a Single doctype does not have.
        self.assertEqual(env.schema.singles["Drive Disk Settings"], set())
        self.assertNotIn("Drive Disk Settings", env.schema.columns)

        # Step 7: only the Drive-owned sidecars (`a`, the Removed `trash`
        # row) are gone; a Home attachment's sidecar was never touched.
        self.assertEqual(env.thumbnails.existing, {"unrelated-home-file"})

        # The persisted census/settings snapshot step 7 and the manual
        # legacy-object delete read from is still there afterwards, for
        # inspection or a later resume no-op, and so is the backup the
        # operator named.
        self.assertEqual(set(env.state.get_census()), {"Drive", "Users", "a", "trash"})
        self.assertFalse(env.state.get_settings_snapshot()["enabled"])
        self.assertEqual(env.state.get_backup(), "s3://backups/2026-09-09")

    def test_an_s3_site_leaves_every_bucket_object_in_place(self):
        """§14.11: the backup restore must stay a complete rollback, so an
        S3 site's sidecars and legacy objects are untouched by the migrate;
        only the manual `delete_legacy_objects` command removes them."""
        env = _full_environment(self.path)
        env.disk_settings.values.update({"enabled": True, "root_folder": "team"})

        results = run_cleanup(env)

        self.assertTrue(all(phase["completed"] for phase in results.values()))
        # The sidecar store was handed the snapshot, not a live read: step 5
        # already dropped the fields the live read would need.
        last_call = env.thumbnails.delete_calls[-1]
        self.assertTrue(last_call[1]["enabled"])
        self.assertEqual(last_call[1]["root_folder"], "team")
        self.assertEqual(env.thumbnails.existing, {"a", "trash", "unrelated-home-file"})
        self.assertEqual(results["thumbnails"]["sidecars_deleted"], 0)
        # The snapshot the manual delete reads `root_folder` from survives.
        self.assertEqual(env.state.get_settings_snapshot()["root_folder"], "team")


if __name__ == "__main__":
    unittest.main()
