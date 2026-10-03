"""§14.10's ordered removal contract, one phase at a time, against fixtures."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from suite.drive.patches.cleanup.ports import REMOVED
from suite.drive.patches.cleanup.removal import (
    NOTIFICATION_LEGACY_COLUMNS,
    RETAINED_DOCTYPES_STEP_3,
    RETAINED_DOCTYPES_STEP_4,
    RETAINED_FILE_CUSTOM_FIELDS,
    CleanupPatchError,
    collect_drive_owned_names,
    phase_content_fields,
    phase_content_history,
    phase_custom_fields,
    phase_file_rows,
    phase_legacy_doctypes,
    phase_slides_media_rows,
    phase_thumbnails,
)
from suite.drive.patches.cleanup.tests.fakes import (
    CrashingSchema,
    FakeContent,
    FakeFileTable,
    FakeSchema,
    FakeThumbnails,
    RaisingPresenceSchema,
    cleanup_environment,
    seed_snapshot,
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

    def test_the_name_census_and_settings_snapshot_are_persisted_before_deletion(self):
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
        env = cleanup_environment(self.path, files=files)
        phase_file_rows(env)
        # Persisted from what phase 1 saw, not re-derivable once the rows
        # (and, after phase 5, the settings columns) are gone.
        self.assertEqual(set(env.state.get_census()), {"Drive", "a"})
        self.assertEqual(env.state.get_settings_snapshot(), env.disk_settings.values)

    def test_a_resumed_call_reuses_the_persisted_census_not_a_fresh_empty_scan(self):
        """The crash window: phase 1's own `DELETE`s land (a real commit, or
        here, the fake's unconditional mutation), but the process dies before
        `patch.run_cleanup` writes this phase's checkpoint. A resumed call is
        a second call to this same function, with the rows it censused
        already gone. It must not re-derive an empty census from that and
        overwrite the correct one — the whole point of persisting it here at
        all is that phase 7 still needs the real names afterwards."""
        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
        env = cleanup_environment(self.path, files=files)
        phase_file_rows(env)
        first_census = env.state.get_census()
        first_settings = env.state.get_settings_snapshot()
        self.assertEqual(set(first_census), {"Drive", "a"})

        # Simulate the crash: the checkpoint for this phase was never
        # written (nothing in this test writes one), and every row phase 1
        # touched is already gone, exactly as a resumed process would find.
        self.assertEqual(set(files.rows), set())
        second_result = phase_file_rows(env)

        self.assertEqual(env.state.get_census(), first_census)
        self.assertEqual(env.state.get_settings_snapshot(), first_settings)
        self.assertEqual(second_result.rows_deleted, 0)  # idempotent: nothing left to delete
        self.assertTrue(second_result.completed)

    def test_a_resumed_call_never_recomputes_the_census_or_rereads_settings(self):
        from unittest.mock import patch

        from suite.drive.patches.cleanup import removal as removal_module

        files = FakeFileTable().add("Drive").add("a", folder="Drive", has_node=True)
        env = cleanup_environment(self.path, files=files)
        phase_file_rows(env)
        self.assertEqual(env.disk_settings.read_calls, 1)

        with patch.object(
            removal_module, "collect_drive_owned_names", side_effect=AssertionError("must not rescan")
        ):
            phase_file_rows(env)  # the resumed call
        self.assertEqual(env.disk_settings.read_calls, 1)

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


class TestPhaseSlidesMediaRows(unittest.TestCase):
    """Deck pictures Build made nodes: the `File` row goes unless a body still names it."""

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def _env(self, content, files=None):
        files = files if files is not None else FakeFileTable()
        return cleanup_environment(self.path, files=files, content=content), files

    def test_a_picture_no_body_names_loses_its_row_and_nothing_else_does(self):
        content = FakeContent(
            slides_media={"pic": "/private/files/pic.png"},
            # Build names the picture's node after its `File`, so the body holds "pic".
            slide_strings={"pic", "Title text"},
        )
        env, files = self._env(
            content, FakeFileTable().add("Home").add("note.txt", folder="Home", has_node=False)
        )

        result = phase_slides_media_rows(env)

        self.assertEqual(set(files.rows), {"Home", "note.txt"})
        self.assertEqual((result.rows_deleted, result.media_rows_kept), (1, 0))
        self.assertTrue(result.completed)

    def test_a_url_a_body_still_names_keeps_its_row_in_any_spelling_build_resolves(self):
        content = FakeContent(
            slides_media={
                "private": "/private/files/a.png",
                "public": "/files/b%20c.png",
                "absolute": "/private/files/d.png",
                "unnamed": "/private/files/e.png",
            },
            slide_strings={"/files/a.png", "/files/b c.png", "https://suite.test/private/files/d.png"},
        )
        env, files = self._env(content)

        result = phase_slides_media_rows(env)

        self.assertEqual(set(files.rows), {"Home", "private", "public", "absolute"})
        self.assertEqual((result.rows_deleted, result.media_rows_kept), (1, 3))

    def test_a_url_inside_an_unreadable_body_keeps_its_row(self):
        content = FakeContent(
            slides_media={"named": "/private/files/a.png", "unnamed": "/private/files/b.png"},
            unreadable_bodies=('[{"src": "/private/files/a.png"',),
        )
        env, files = self._env(content)

        phase_slides_media_rows(env)

        self.assertEqual(set(files.rows), {"Home", "named"})

    def test_a_rerun_deletes_nothing_more(self):
        content = FakeContent(
            slides_media={name: f"/private/files/{name}.png" for name in ("a", "b", "c")},
            slide_strings={"/private/files/b.png"},
        )
        env, files = self._env(content)

        first = phase_slides_media_rows(env, batch_size=1)
        second = phase_slides_media_rows(env, batch_size=1)

        self.assertEqual(set(files.rows), {"Home", "b"})
        self.assertEqual((first.rows_deleted, first.media_rows_kept), (2, 1))
        self.assertEqual((second.rows_deleted, second.media_rows_kept), (0, 1))


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
            columns={
                "File": {
                    "mime_type",
                    "status",
                    "file_modified",
                    "content_doctype",
                    "content_docname",
                    "file_url",
                }
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
        self.assertEqual(result.columns_dropped, 5)
        self.assertEqual(result.property_setters_dropped, 3)
        self.assertEqual(schema.custom_fields, {"unrelated_field"})
        self.assertEqual(schema.columns["File"], {"file_url"})
        self.assertEqual(schema.property_setters, {("File", "is_folder", "hidden")})

    def test_a_partial_pre_state_from_an_earlier_interrupted_attempt_completes_cleanly(self):
        # Finding: an earlier attempt already removed 5 of the 7 custom
        # fields and 2 of the 3 property setters before it was interrupted.
        # This call must not treat "this call only removed 2 of 7" as a
        # partial-removal error; it must verify every named target is gone
        # by the end of it, regardless of who removed the rest.
        schema = FakeSchema(
            custom_fields={"content_docname", "column_break_tapww"},
            property_setters={("File", "folder", "depends_on")},
        )
        result = phase_custom_fields(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.fields_dropped, 2)
        self.assertEqual(result.property_setters_dropped, 1)
        self.assertEqual(schema.custom_fields, set())
        self.assertEqual(schema.property_setters, set())

    def test_a_target_still_present_after_the_drop_call_refuses(self):
        class StuckSchema(FakeSchema):
            def custom_fields_present(self, fieldnames):
                return frozenset({"mime_type"})

        schema = StuckSchema(custom_fields=set(RETAINED_FILE_CUSTOM_FIELDS))
        with self.assertRaises(CleanupPatchError):
            phase_custom_fields(cleanup_environment(self.path, schema=schema))


class TestPhaseLegacyDoctypes(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_drops_the_legacy_doctypes_and_notification_columns_then_requires_activity(self):
        # A site that never had the optional legacy doctypes (invitations,
        # the old entity log) only drops the ones it has.
        schema = FakeSchema(
            doctypes={
                "Drive Permission",
                "Drive Entity Activity Log",
                "Drive Token",
                "Drive Node",
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
        self.assertEqual(schema.doctypes, {"Drive Node"})
        self.assertEqual(schema.columns["Drive Notification"], {"activity", "to_user", "read"})
        self.assertIn(("Drive Notification", "activity"), schema.required_fields)

    def test_a_partial_pre_state_from_an_earlier_interrupted_attempt_completes_cleanly(self):
        # Finding: an earlier attempt already dropped 2 of the 3 step-3
        # doctypes and 4 of the 6 notification columns before it was
        # interrupted — each `drop_doctypes`/`drop_columns` call is its own
        # MariaDB-committed DDL, so this is a legitimate partial state, not
        # corruption. The old all-or-nothing count check would refuse this
        # resume outright; verifying presence directly must not.
        schema = FakeSchema(
            doctypes={"Drive Token"},
            columns={"Drive Notification": {"activity", "to_user", "read", "from_user", "type"}},
        )
        result = phase_legacy_doctypes(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.doctypes_dropped, 1)
        self.assertEqual(result.columns_dropped, 2)
        self.assertNotIn("Drive Token", schema.doctypes)
        self.assertEqual(schema.columns["Drive Notification"], {"activity", "to_user", "read"})

    def test_a_crash_between_doctypes_and_columns_resumes_to_completion(self):
        schema = CrashingSchema(
            crash_after="drop_doctypes",
            doctypes=set(RETAINED_DOCTYPES_STEP_3),
            columns={"Drive Notification": {"activity", "to_user", "read", *NOTIFICATION_LEGACY_COLUMNS}},
        )
        env = cleanup_environment(self.path, schema=schema)
        with self.assertRaises(RuntimeError):
            phase_legacy_doctypes(env)
        # The doctype drop already landed for real; the crash only stopped
        # this call before the column drop.
        self.assertEqual(schema.doctypes, set())
        self.assertEqual(
            schema.columns["Drive Notification"],
            {"activity", "to_user", "read", *NOTIFICATION_LEGACY_COLUMNS},
        )

        result = phase_legacy_doctypes(env)  # resume
        self.assertTrue(result.completed)
        self.assertEqual(result.doctypes_dropped, 0)  # already gone; this call did none of it
        self.assertEqual(schema.columns["Drive Notification"], {"activity", "to_user", "read"})

    def test_a_target_still_present_after_the_column_drop_refuses(self):
        schema = RaisingPresenceSchema(
            doctypes=set(RETAINED_DOCTYPES_STEP_3),
            columns={"Drive Notification": {"activity", "to_user", "read", *NOTIFICATION_LEGACY_COLUMNS}},
        )
        with self.assertRaises(RuntimeError):
            phase_legacy_doctypes(cleanup_environment(self.path, schema=schema))


class TestPhaseContentHistory(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def _step_four_schema(self):
        return FakeSchema(doctypes=set(RETAINED_DOCTYPES_STEP_4))

    def test_ycomments_and_sheet_comments_are_cleared(self):
        content = FakeContent(ycomments=2, sheets_with_comments=5)
        schema = self._step_four_schema()
        result = phase_content_history(cleanup_environment(self.path, content=content, schema=schema))
        self.assertEqual(result.ycomments_cleared, 2)
        self.assertEqual(result.sheet_comments_stripped, 5)
        self.assertEqual(result.doctypes_dropped, 4)
        self.assertEqual(schema.doctypes, set())
        self.assertEqual(content.strip_calls, 1)

    def test_a_governed_docshare_that_survived_build_refuses_the_phase(self):
        """§14.10 lists the delete here, but Build already had to do it.

        §5.13's read guards fail closed on a surviving row and
        `validate_content_registry` refuses the migration while one is left,
        so a site that reaches Cleanup with one never ran that Build. This
        phase says so rather than finishing the job a release late.
        """
        content = FakeContent(docshares=("Sheet", "Sheet Op Log"))
        env = cleanup_environment(self.path, content=content, schema=self._step_four_schema())

        with self.assertRaises(CleanupPatchError) as caught:
            phase_content_history(env)

        self.assertIn("Sheet Op Log", str(caught.exception))
        self.assertEqual(content.strip_calls, 0)

    def test_a_partial_pre_state_from_an_earlier_interrupted_attempt_completes_cleanly(self):
        # An earlier attempt already dropped 3 of the 4 step-4 doctypes.
        schema = FakeSchema(doctypes={"Sheet Snapshot"})
        result = phase_content_history(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.doctypes_dropped, 1)
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
                    "unrelated_field",
                },
            },
        )
        result = phase_content_fields(cleanup_environment(self.path, schema=schema))
        self.assertEqual(schema.columns["Presentation"], {"body"})
        self.assertEqual(schema.columns["Sheet"], {"sheets_data"})
        self.assertEqual(schema.columns["Drive Settings"], {"webdav_enabled"})
        self.assertEqual(schema.columns["Drive Storage Reservation"], {"reserved_bytes"})
        self.assertEqual(schema.columns["Drive Favourite"], {"user", "node"})
        self.assertEqual(schema.columns["Drive Root"], {"node", "used_bytes"})
        # All ten §3.13 fields drop as tabSingles rows, never as DDL; nothing
        # outside that list, and no `columns["Drive Disk Settings"]` entry at
        # all, is touched.
        self.assertEqual(schema.singles["Drive Disk Settings"], {"unrelated_field"})
        self.assertNotIn("Drive Disk Settings", schema.columns)
        self.assertEqual(result.columns_dropped, 1 + 5 + 2 + 1 + 1 + 1)
        self.assertEqual(result.single_values_dropped, 10)

    def test_a_partial_pre_state_across_columns_and_singles_completes_cleanly(self):
        # An earlier interrupted attempt already dropped Presentation's
        # title, two of Sheet's four columns, and 6 of the 10 Single values.
        schema = FakeSchema(
            columns={
                "Presentation": {"body"},
                "Sheet": {"trashed", "trashed_on", "sheets_data"},
                "Drive Settings": {"user_folder", "quota", "webdav_enabled"},
                "Drive Storage Reservation": {"storage_owner", "reserved_bytes"},
                "Drive Favourite": {"user", "node", "entity"},
                "Drive Root": {"node", "used_bytes", "acl_generation"},
            },
            singles={"Drive Disk Settings": {"quota", "root_folder", "thumbnail_prefix", "flat"}},
        )
        result = phase_content_fields(cleanup_environment(self.path, schema=schema))
        self.assertTrue(result.completed)
        self.assertEqual(schema.columns["Presentation"], {"body"})
        self.assertEqual(schema.columns["Sheet"], {"sheets_data"})
        self.assertEqual(schema.singles["Drive Disk Settings"], set())

    def test_a_crash_between_the_column_loop_and_the_singles_loop_resumes_to_completion(self):
        schema = CrashingSchema(
            crash_after="drop_columns:Drive Storage Reservation",
            columns={
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
        env = cleanup_environment(self.path, schema=schema)
        with self.assertRaises(RuntimeError):
            phase_content_fields(env)
        # Every column drop before the crash point already landed for real;
        # the singles loop never started.
        self.assertEqual(schema.columns["Drive Storage Reservation"], {"reserved_bytes"})
        self.assertEqual(len(schema.singles["Drive Disk Settings"]), 10)

        result = phase_content_fields(env)  # resume
        self.assertTrue(result.completed)
        self.assertEqual(schema.singles["Drive Disk Settings"], set())

    def test_a_target_still_present_after_a_column_drop_refuses(self):
        schema = RaisingPresenceSchema(columns={"Presentation": {"title", "body"}})
        with self.assertRaises(RuntimeError):
            phase_content_fields(cleanup_environment(self.path, schema=schema))


class TestPhaseThumbnails(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_only_drive_owned_sidecars_are_deleted(self):
        thumbnails = FakeThumbnails(existing={"a", "unrelated-home-file"})
        env = cleanup_environment(self.path, thumbnails=thumbnails)
        seed_snapshot(env, names=("Drive", "a"))
        result = phase_thumbnails(env)
        self.assertEqual(result.sidecars_deleted, 1)
        self.assertEqual(thumbnails.existing, {"unrelated-home-file"})

    def test_reads_the_census_and_settings_from_state_not_a_live_rescan(self):
        # By step 7, phase 1 has already deleted the File rows and phase 5
        # has already dropped the settings columns a live read would need.
        thumbnails = FakeThumbnails(existing={"a"})
        env = cleanup_environment(self.path, files=FakeFileTable(), thumbnails=thumbnails)
        seed_snapshot(env, names=("a",))
        result = phase_thumbnails(env)
        self.assertEqual(result.sidecars_deleted, 1)
        # Not just "it worked despite an empty File table": the live
        # `DiskSettingsSnapshot` port itself was never even called.
        self.assertEqual(env.disk_settings.read_calls, 0)

    def test_no_persisted_census_refuses(self):
        env = cleanup_environment(self.path)
        with self.assertRaises(CleanupPatchError):
            phase_thumbnails(env)

    def test_no_persisted_settings_snapshot_refuses(self):
        env = cleanup_environment(self.path)
        env.state.put_census(["a"])
        with self.assertRaises(CleanupPatchError):
            phase_thumbnails(env)

    def test_an_s3_site_deletes_no_sidecar_and_records_zero(self):
        # Cleanup deletes no bucket object (§14.11); the store is still
        # handed the snapshot so it can tell an S3 site from a local one.
        thumbnails = FakeThumbnails(existing={"a"})
        env = cleanup_environment(self.path, thumbnails=thumbnails)
        seed_snapshot(env, names=("a",), enabled=True, root_folder="team")
        result = phase_thumbnails(env)
        self.assertTrue(result.completed)
        self.assertEqual(result.sidecars_deleted, 0)
        self.assertEqual(thumbnails.existing, {"a"})
        (call,) = thumbnails.delete_calls
        self.assertTrue(call[1]["enabled"])


if __name__ == "__main__":
    unittest.main()
