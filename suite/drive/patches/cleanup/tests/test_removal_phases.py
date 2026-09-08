"""§14.10's ordered removal contract, one phase at a time, against fixtures."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.ports import REMOVED
from suite.drive.patches.cleanup.removal import (
    CleanupPatchError,
    collect_drive_owned_names,
    phase_content_fields,
    phase_content_history,
    phase_custom_fields,
    phase_file_rows,
    phase_legacy_api,
    phase_legacy_doctypes,
    phase_s3_prefix,
    phase_thumbnails,
    refuse_dangerous_prefix,
)
from suite.drive.patches.cleanup.tests.fakes import (
    FakeContent,
    FakeFileTable,
    FakeForwarders,
    FakeS3,
    FakeSchema,
    FakeThumbnails,
    cleanup_environment,
)


class TestPhaseFileRows(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_reachable_root_and_removed_rows_are_deleted(self):
        files = (
            FakeFileTable()
            .add("Drive")
            .add("Users", folder=None)
            .add("a", folder="Drive", has_node=True)
            .add("trash", folder="Drive", status=REMOVED, has_node=False)
        )
        env = cleanup_environment(self.path, files=files)
        result = phase_file_rows(env)
        self.assertEqual(set(files.rows), set())
        self.assertEqual(result.rows_deleted, 4)
        self.assertTrue(result.completed)

    def test_home_attachments_are_never_deleted(self):
        files = FakeFileTable().add("Drive").add("attachment", folder="Home", has_node=False)
        env = cleanup_environment(self.path, files=files)
        phase_file_rows(env)
        self.assertIn("attachment", files.rows)
        self.assertNotIn("Drive", files.rows)

    def test_a_removed_subtree_is_deleted_children_first(self):
        files = (
            FakeFileTable()
            .add("Drive")
            .add("trash", folder="Drive", status=REMOVED, has_node=False)
            .add("child", folder="trash", status=REMOVED, has_node=False)
            .add("grandchild", folder="child", status=REMOVED, has_node=False)
        )
        env = cleanup_environment(self.path, files=files)
        phase_file_rows(env)
        # `grandchild`'s climb reads `child`'s row, and `child`'s climb reads
        # `trash`'s row (neither `child` nor `trash` has a node to short
        # circuit through), so each must be deleted before its parent.
        order = files.deleted
        self.assertLess(order.index("grandchild"), order.index("child"))
        self.assertLess(order.index("child"), order.index("trash"))

    def test_a_crash_partway_leaves_remaining_chains_intact_for_resume(self):
        files = (
            FakeFileTable()
            .add("Drive")
            .add("trash", folder="Drive", status=REMOVED, has_node=False)
            .add("child", folder="trash", status=REMOVED, has_node=False)
        )
        names = collect_drive_owned_names(cleanup_environment(self.path, files=files))
        self.assertEqual(names, ["child", "trash", "Drive"])
        # Simulate a kill after the deepest row alone was removed.
        files.delete(("child",))
        self.assertEqual(files.rows["trash"].folder, "Drive")
        resumed = collect_drive_owned_names(cleanup_environment(self.path, files=files))
        self.assertEqual(resumed, ["trash", "Drive"])


class TestPhaseCustomFields(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_exactly_the_seven_fields_and_three_setters_drop(self):
        schema = FakeSchema(
            custom_fields={
                "section_break_nfot8",
                "mime_type",
                "status",
                "file_modified",
                "column_break_tapww",
                "content_doctype",
                "content_docname",
                "unrelated_field",
            },
            property_setters={
                ("File", "file_url", "depends_on"),
                ("File", "folder", "hidden"),
                ("File", "folder", "depends_on"),
                ("File", "is_folder", "hidden"),
            },
        )
        result = phase_custom_fields(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.fields_dropped, 7)
        self.assertEqual(result.property_setters_dropped, 3)
        self.assertEqual(schema.custom_fields, {"unrelated_field"})
        self.assertEqual(schema.property_setters, {("File", "is_folder", "hidden")})


class TestPhaseLegacyDoctypes(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_drops_the_three_doctypes_and_notification_columns_then_requires_activity(self):
        schema = FakeSchema(
            doctypes={
                "drive/doctype/drive_permission",
                "drive/doctype/drive_entity_activity_log",
                "drive/doctype/drive_token",
                "drive/doctype/drive_node",
            },
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
                }
            },
        )
        result = phase_legacy_doctypes(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.doctypes_dropped, 3)
        self.assertEqual(result.columns_dropped, 6)
        self.assertIn("drive/doctype/drive_node", schema.doctypes)
        self.assertEqual(schema.columns["Drive Notification"], {"activity", "to_user", "read"})
        self.assertIn(("Drive Notification", "activity"), schema.required_fields)


class TestPhaseContentHistory(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_docshares_ycomments_and_sheet_comments_are_cleared(self):
        content = FakeContent(docshares=3, ycomments=2, sheets_with_comments=5)
        schema = FakeSchema(
            doctypes={
                "writer/doctype/writer_version",
                "writer/doctype/writer_doc_version",
                "writer/doctype/writer_template",
                "sheets/doctype/sheet_snapshot",
            }
        )
        result = phase_content_history(cleanup_environment(self.path, content=content, schema=schema))
        self.assertEqual(result.docshares_deleted, 3)
        self.assertEqual(result.ycomments_cleared, 2)
        self.assertEqual(result.sheet_comments_stripped, 5)
        self.assertEqual(result.doctypes_dropped, 4)
        self.assertEqual(content.docshares, 0)
        self.assertEqual(schema.doctypes, set())


class TestPhaseContentFields(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_drops_title_trashed_and_the_settings_columns_only(self):
        schema = FakeSchema(
            columns={
                "Presentation": {"title", "body"},
                "Sheet": {"title", "trashed", "sheets_data"},
                "Drive Settings": {"user_folder", "quota", "webdav_enabled"},
                "Drive Disk Settings": {"quota", "aws_key", "aws_secret", "bucket", "endpoint_url", "flat"},
                "Drive Storage Reservation": {"storage_owner", "reserved_bytes"},
            }
        )
        phase_content_fields(cleanup_environment(self.path, schema=schema))
        self.assertEqual(schema.columns["Presentation"], {"body"})
        self.assertEqual(schema.columns["Sheet"], {"sheets_data"})
        self.assertEqual(schema.columns["Drive Settings"], {"webdav_enabled"})
        self.assertEqual(schema.columns["Drive Disk Settings"], {"flat"})
        self.assertEqual(schema.columns["Drive Storage Reservation"], {"reserved_bytes"})


class TestPhaseLegacyApi(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_only_forwarder_names_are_removed(self):
        forwarders = FakeForwarders(
            {
                "api.files.upload_file": "forwarder",
                "api.files.create_folder": "forwarder",
                "api.s3.fetch": "permanent",
                "overrides.file.get_file_for_doc": "permanent",
                "api.files.download_folder": "retained",
                "api.files.create_auth_token": "retired",
            }
        )
        result = phase_legacy_api(cleanup_environment(self.path, forwarders=forwarders))
        self.assertEqual(result.forwarders_removed, 2)
        self.assertEqual(set(forwarders.removed), {"api.files.upload_file", "api.files.create_folder"})
        self.assertEqual(
            set(forwarders.classification()),
            {
                "api.s3.fetch",
                "overrides.file.get_file_for_doc",
                "api.files.download_folder",
                "api.files.create_auth_token",
            },
        )
        self.assertTrue(result.wildcard_prefix_removed)
        self.assertNotIn("/api/method/suite.drive.api.", forwarders._wildcard_paths)
        self.assertIn("/dav/", forwarders._wildcard_paths)


class TestPhaseThumbnails(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_only_drive_owned_sidecars_are_deleted(self):
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
        thumbnails = FakeThumbnails(existing={"a", "unrelated-home-file"})
        result = phase_thumbnails(cleanup_environment(self.path, files=files, thumbnails=thumbnails))
        self.assertEqual(result.sidecars_deleted, 1)
        self.assertEqual(thumbnails.existing, {"unrelated-home-file"})


class TestPhaseS3Prefix(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_disabled_s3_completes_with_nothing_enqueued(self):
        s3 = FakeS3(is_enabled=False)
        result = phase_s3_prefix(cleanup_environment(self.path, s3=s3))
        self.assertTrue(result.completed)
        self.assertEqual(s3.enqueued, [])

    def test_referenced_keys_are_excluded_from_the_job(self):
        s3 = FakeS3(
            is_enabled=True,
            prefix="team",
            keys=["team/a", "team/b", "team/c"],
            referenced_keys={"team/b"},
        )
        result = phase_s3_prefix(cleanup_environment(self.path, s3=s3))
        self.assertEqual(result.candidates_found, 3)
        self.assertEqual(result.referenced_excluded, 1)
        self.assertEqual(s3.enqueued, [("team/a", "team/c")])

    def test_every_candidate_referenced_enqueues_nothing(self):
        s3 = FakeS3(is_enabled=True, prefix="team", keys=["team/a"], referenced_keys={"team/a"})
        result = phase_s3_prefix(cleanup_environment(self.path, s3=s3))
        self.assertEqual(s3.enqueued, [])
        self.assertIsNone(result.job_id)

    def test_a_reference_created_between_listing_and_the_recheck_survives(self):
        """The re-reference race: a new blob claims a legacy key right as
        the enumeration finishes. `blob_references` is read once, right
        before `enqueue_delete`, so it must see the race's outcome."""

        class RacingS3(FakeS3):
            def blob_references(self, keys):
                # The race: something references `team/b` between the
                # listing above and this recheck.
                self.referenced_keys.add("team/b")
                return super().blob_references(keys)

        s3 = RacingS3(is_enabled=True, prefix="team", keys=["team/a", "team/b"])
        result = phase_s3_prefix(cleanup_environment(self.path, s3=s3))
        self.assertEqual(s3.enqueued, [("team/a",)])
        self.assertEqual(result.referenced_excluded, 1)

    def test_empty_prefix_is_refused(self):
        with self.assertRaises(CleanupPatchError):
            refuse_dangerous_prefix("")
        with self.assertRaises(CleanupPatchError):
            refuse_dangerous_prefix("/")

    def test_private_or_public_root_is_refused(self):
        with self.assertRaises(CleanupPatchError):
            refuse_dangerous_prefix("private")
        with self.assertRaises(CleanupPatchError):
            refuse_dangerous_prefix("/public/")

    def test_a_dangerous_prefix_stops_the_phase_before_any_listing(self):
        class ExplodingS3(FakeS3):
            def list_prefix(self, prefix, after, limit):
                raise AssertionError("must not enumerate a dangerous prefix")

        s3 = ExplodingS3(is_enabled=True, prefix="private")
        with self.assertRaises(CleanupPatchError):
            phase_s3_prefix(cleanup_environment(self.path, s3=s3))


if __name__ == "__main__":
    unittest.main()
