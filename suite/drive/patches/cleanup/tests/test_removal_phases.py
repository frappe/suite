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
    phase_legacy_api,
    phase_legacy_doctypes,
    phase_s3_prefix,
    phase_thumbnails,
    refuse_dangerous_prefix,
)
from suite.drive.patches.cleanup.tests.fakes import (
    CrashingSchema,
    FakeContent,
    FakeFileTable,
    FakeForwarders,
    FakeS3,
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

    def test_a_partial_pre_state_from_an_earlier_interrupted_attempt_completes_cleanly(self):
        # Finding: an earlier attempt already dropped 2 of the 3 step-3
        # doctypes and 4 of the 6 notification columns before it was
        # interrupted — each `drop_doctypes`/`drop_columns` call is its own
        # MariaDB-committed DDL, so this is a legitimate partial state, not
        # corruption. The old all-or-nothing count check would refuse this
        # resume outright; verifying presence directly must not.
        schema = FakeSchema(
            doctypes={"drive/doctype/drive_token"},
            columns={"Drive Notification": {"activity", "to_user", "read", "from_user", "type"}},
        )
        result = phase_legacy_doctypes(cleanup_environment(self.path, schema=schema))
        self.assertEqual(result.doctypes_dropped, 1)
        self.assertEqual(result.columns_dropped, 2)
        self.assertNotIn("drive/doctype/drive_token", schema.doctypes)
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
        self.assertEqual(content.strip_calls, 1)

    def test_writer_document_versions_drops_before_writer_doc_version(self):
        schema = FakeSchema(doctypes=set(RETAINED_DOCTYPES_STEP_4))
        phase_content_history(cleanup_environment(self.path, schema=schema))
        self.assertEqual(schema.dropped_child_table_fields, [("Writer Document", "versions")])
        # `drop_doctypes` (including `writer_doc_version`) runs after, per
        # the same `FakeSchema` — the ordering the docstring requires.

    def test_a_partial_pre_state_from_an_earlier_interrupted_attempt_completes_cleanly(self):
        # An earlier attempt already dropped 3 of the 4 step-4 doctypes.
        schema = FakeSchema(doctypes={"sheets/doctype/sheet_snapshot"})
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
                    "unrelated_field",
                },
            },
        )
        result = phase_content_fields(cleanup_environment(self.path, schema=schema))
        self.assertEqual(schema.columns["Presentation"], {"body"})
        self.assertEqual(schema.columns["Sheet"], {"sheets_data"})
        self.assertEqual(schema.columns["Drive Settings"], {"webdav_enabled"})
        self.assertEqual(schema.columns["Drive Storage Reservation"], {"reserved_bytes"})
        # All ten §3.13 fields drop as tabSingles rows, never as DDL; nothing
        # outside that list, and no `columns["Drive Disk Settings"]` entry at
        # all, is touched.
        self.assertEqual(schema.singles["Drive Disk Settings"], {"unrelated_field"})
        self.assertNotIn("Drive Disk Settings", schema.columns)
        self.assertEqual(result.columns_dropped, 1 + 4 + 2 + 1)
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

    def test_s3_backed_sidecars_are_deferred_to_ticket_36(self):
        thumbnails = FakeThumbnails(existing={"a"})
        env = cleanup_environment(self.path, thumbnails=thumbnails)
        seed_snapshot(env, names=("a",), enabled=True)
        with self.assertRaises(NotImplementedError):
            phase_thumbnails(env)


class TestPhaseS3Prefix(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def test_disabled_s3_completes_with_nothing_enqueued(self):
        s3 = FakeS3()
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env)  # DEFAULT_DISK_SETTINGS: enabled=False
        result = phase_s3_prefix(env)
        self.assertTrue(result.completed)
        self.assertEqual(s3.enqueued, [])

    def test_no_persisted_settings_snapshot_refuses(self):
        with self.assertRaises(CleanupPatchError):
            phase_s3_prefix(cleanup_environment(self.path))

    def test_never_reads_the_live_disk_settings_port(self):
        env = cleanup_environment(self.path)
        seed_snapshot(env, enabled=True, root_folder="team")
        phase_s3_prefix(env)
        self.assertEqual(env.disk_settings.read_calls, 0)

    def test_referenced_keys_are_excluded_from_the_job(self):
        s3 = FakeS3(keys=["team/a", "team/b", "team/c"], referenced_keys={"team/b"})
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env)
        self.assertEqual(result.candidates_found, 3)
        self.assertEqual(result.referenced_excluded, 1)
        self.assertEqual(s3.enqueued, [("team/a", "team/c")])

    def test_every_candidate_referenced_enqueues_nothing(self):
        s3 = FakeS3(keys=["team/a"], referenced_keys={"team/a"})
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env)
        self.assertEqual(s3.enqueued, [])
        self.assertEqual(result.job_ids, [])

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

        s3 = RacingS3(keys=["team/a", "team/b"])
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env)
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

        s3 = ExplodingS3()
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="private")
        with self.assertRaises(CleanupPatchError):
            phase_s3_prefix(env)

    def test_every_call_stays_within_batch_size_across_multiple_pages(self):
        # Finding: the old phase accumulated every key from every listing
        # page into one list, then made one `blob_references` call and one
        # `enqueue_delete` call sized by however many legacy keys the whole
        # prefix held. 7 keys with `batch_size=2` forces 4 listing pages;
        # every `blob_references`/`enqueue_delete` call must stay bounded by
        # that same page, never by the total across all of them.
        keys = [f"team/{i:02d}" for i in range(7)]
        s3 = FakeS3(keys=keys, referenced_keys={"team/02", "team/05"})
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env, batch_size=2)

        self.assertEqual(len(s3.list_prefix_calls), 4)  # 2+2+2+1
        for call in s3.blob_reference_calls:
            self.assertLessEqual(len(call), 2)
        for enqueued in s3.enqueued:
            self.assertLessEqual(len(enqueued), 2)
        # Never one call spanning every key: at least as many calls as pages
        # that actually held an unreferenced candidate.
        self.assertGreater(len(s3.enqueued), 1)

        # Totals across the bounded calls still add up correctly.
        self.assertEqual(result.candidates_found, 7)
        self.assertEqual(result.referenced_excluded, 2)
        self.assertEqual(sum(len(batch) for batch in s3.enqueued), 5)
        self.assertEqual(len(result.job_ids), len(s3.enqueued))
        self.assertEqual(len(set(result.job_ids)), len(result.job_ids))  # every job id distinct

    def test_a_page_wholly_referenced_is_recorded_but_enqueues_nothing_and_pagination_continues(self):
        keys = ["team/a", "team/b", "team/c", "team/d"]
        s3 = FakeS3(keys=keys, referenced_keys={"team/a", "team/b"})
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env, batch_size=2)

        self.assertEqual(result.candidates_found, 4)
        self.assertEqual(result.referenced_excluded, 2)
        self.assertEqual(s3.enqueued, [("team/c", "team/d")])  # only the second page enqueued
        self.assertEqual(len(result.job_ids), 1)

    def test_a_duplicate_key_within_one_page_is_not_double_counted_or_double_enqueued(self):
        class DuplicatingS3(FakeS3):
            def list_prefix(self, prefix, after, limit):
                page = super().list_prefix(prefix, after, limit)
                return list(page) + list(page[-1:]) if page else page

        s3 = DuplicatingS3(keys=["team/a", "team/b"])
        env = cleanup_environment(self.path, s3=s3)
        seed_snapshot(env, enabled=True, root_folder="team")
        result = phase_s3_prefix(env, batch_size=10)
        self.assertEqual(result.candidates_found, 2)
        self.assertEqual(s3.enqueued, [("team/a", "team/b")])


if __name__ == "__main__":
    unittest.main()
