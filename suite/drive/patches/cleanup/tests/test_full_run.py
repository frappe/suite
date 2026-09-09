"""§14.10 end to end: one `run_cleanup` call, every phase, checked against
what should and should not survive it — not just that each phase completed."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.patch import run_cleanup
from suite.drive.patches.cleanup.readiness import PortNotReadyError
from suite.drive.patches.cleanup.removal import RETAINED_DOCTYPES_STEP_3, RETAINED_DOCTYPES_STEP_4
from suite.drive.patches.cleanup.tests.fakes import (
    FakeContent,
    FakeFileTable,
    FakeForwarders,
    FakeS3,
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
    forwarders = FakeForwarders(
        {
            "api.files.upload_file": "forwarder",
            "api.files.create_folder": "forwarder",
            "api.s3.fetch": "permanent",
            "overrides.file.get_file_for_doc": "permanent",
            "api.files.download_folder": "retained",
        }
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
            "Sheet": {"title", "trashed", "trashed_on", "trashed_by", "sheets_data"},
            "Drive Settings": {"user_folder", "quota", "webdav_enabled"},
            "Drive Storage Reservation": {"storage_owner", "reserved_bytes"},
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
    content = FakeContent(docshares=2, ycomments=1, sheets_with_comments=3)
    thumbnails = FakeThumbnails(existing={"a", "trash", "unrelated-home-file"})
    return cleanup_environment(
        tmp_path,
        files=files,
        blob_columns=fake_blob_columns(),
        forwarders=forwarders,
        schema=schema,
        content=content,
        thumbnails=thumbnails,
        s3=FakeS3(),
        authorized=True,
        backup_ref="s3://backups/2026-09-09",
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
        # doctypes are gone; their permission hooks were planned for removal.
        self.assertEqual(env.schema.custom_fields, set())
        self.assertEqual(env.schema.property_setters, set())
        for path in RETAINED_DOCTYPES_STEP_3:
            self.assertNotIn(path, env.schema.doctypes)
        self.assertIn(tuple(RETAINED_DOCTYPES_STEP_3), env.schema.removed_permission_hooks)
        self.assertEqual(env.schema.columns["Drive Notification"], {"activity", "to_user", "read"})

        # Step 4: history doctypes gone, `Writer Document.versions` dropped
        # before them, docshares/ycomments/sheet-comments all cleared.
        for path in RETAINED_DOCTYPES_STEP_4:
            self.assertNotIn(path, env.schema.doctypes)
        # (Preflight also probes this port with a no-op `("", "")` call
        # before phase 1 ever runs, so check membership, not exact equality.)
        self.assertIn(("Writer Document", "versions"), env.schema.dropped_child_table_fields)
        self.assertEqual(env.content.docshares, 0)
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

        # Step 6: only FORWARDER-labeled names and the wildcard prefix are
        # gone; PERMANENT and RETAINED endpoints survive untouched.
        self.assertEqual(
            set(env.forwarders.classification()),
            {"api.s3.fetch", "overrides.file.get_file_for_doc", "api.files.download_folder"},
        )
        self.assertNotIn("/api/method/suite.drive.api.", env.forwarders._wildcard_paths)

        # Step 7: only the Drive-owned sidecars (`a`, the Removed `trash`
        # row) are gone; a Home attachment's sidecar was never touched.
        self.assertEqual(env.thumbnails.existing, {"unrelated-home-file"})

        # Step 8: local (non-S3) site, so nothing was enumerated or enqueued.
        self.assertEqual(env.s3.enqueued, [])
        self.assertEqual(results["s3_prefix"]["candidates_found"], 0)

        # The persisted census/settings snapshot phase 7 and 8 read from is
        # still there afterwards, for inspection or a later resume no-op.
        self.assertEqual(set(env.state.get_census()), {"Drive", "Users", "a", "trash"})
        self.assertFalse(env.state.get_settings_snapshot()["enabled"])

    def test_referenced_s3_objects_survive_a_full_run(self):
        env = _full_environment(self.path)
        env.disk_settings.values.update({"enabled": True, "root_folder": "team"})
        env.s3.keys = ["team/a", "team/b"]
        env.s3.referenced_keys = {"team/b"}
        # Honest gap: the real thumbnail store and S3 client are
        # `NotImplementedError` until Ticket 36, so preflight refuses this
        # site before phase 1 rather than destroy rows first and discover
        # the gap in phase 7 or 8.
        with self.assertRaises(PortNotReadyError):
            run_cleanup(env)
        self.assertEqual(env.files.deleted, [])
        self.assertEqual(env.s3.enqueued, [])
        self.assertIn("team/b", env.s3.referenced_keys)


if __name__ == "__main__":
    unittest.main()
