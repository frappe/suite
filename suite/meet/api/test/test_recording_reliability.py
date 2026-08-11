# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import hashlib
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from suite.drive.api.files import delete_entities, remove_or_restore
from suite.drive.utils import create_drive_file, get_user_folder
from suite.drive.utils.files import TRASH_PREFIX, FileManager
from suite.meet.api.recording import (
    BYTES_PER_SECOND,
    DEFAULT_ESTIMATE_SECONDS,
    MAX_SECONDS,
    MINIMUM_BUDGET_BYTES,
    _accept,
    _get_estimate,
    _system_datetime_as_utc,
    get_preflight,
    reconcile_pending_recordings,
    recorder_failed,
    recorder_interrupted,
    recorder_recovered,
    start,
    stop,
)
from suite.meet.recording.ingest import (
    _recordings_folder,
    _upload_path,
    append_chunk,
    begin_upload,
    process_upload,
)
from suite.meet.recording.recorder_client import RecorderOutcome

PUBLIC_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
    "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
}


class IntegrationTestRecordingReliability(IntegrationTestCase):
    def setUp(self):
        self.owner = "reliability-owner@example.com"
        self.cohost = "reliability-cohost@example.com"
        for email, first_name in ((self.owner, "Reliability Owner"), (self.cohost, "Reliability Cohost")):
            if not frappe.db.exists("User", email):
                frappe.get_doc(
                    {
                        "doctype": "User",
                        "email": email,
                        "first_name": first_name,
                        "enabled": 1,
                        "new_password": "password",
                    }
                ).insert(ignore_permissions=True)
        frappe.conf.recorder_server_url = "http://recorder.test"
        frappe.conf.recorder_secret = "test-recorder-secret"
        frappe.conf.sfu_secret = "test-sfu-secret"
        frappe.conf.recording_fixture_mode = True
        frappe.db.set_single_value("Meet Settings", "enable_recording", 1)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.set_user(self.owner)
        self.room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()

    def tearDown(self):
        frappe.set_user("Administrator")
        for recording in frappe.get_all("Meet Recording", filters={"room_owner": self.owner}, pluck="name"):
            upload_id = frappe.db.get_value("Meet Recording", recording, "upload_id")
            if upload_id:
                _upload_path(upload_id).unlink(missing_ok=True)
            frappe.delete_doc("Meet Recording", recording, force=True, ignore_permissions=True)
        for room in frappe.get_all("Meet Room", filters={"owner": self.owner}, pluck="name"):
            frappe.delete_doc("Meet Room", room, force=True, ignore_permissions=True)
        frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.conf.pop("recording_fixture_mode", None)

    def test_one_active_recording_per_room_and_request_id_is_idempotent(self):
        request_id = str(uuid.uuid4())
        first = start(self.room.name, request_id)
        frappe.db.set_value(
            "Meet Recording",
            first["name"],
            "grant_expires_at",
            int(time.time()) - 1,
            update_modified=False,
        )
        self.assertEqual(start(self.room.name, request_id), first)

        with self.assertRaises(frappe.ValidationError):
            start(self.room.name, str(uuid.uuid4()))

        self.assertEqual(
            frappe.db.count(
                "Meet Recording",
                {
                    "meet_room": self.room.name,
                    "status": ["in", ("Pending", "Recording", "Interrupted", "Stopping")],
                },
            ),
            1,
        )

    def test_one_active_recording_per_room_owner_by_default(self):
        other = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        first = start(self.room.name, str(uuid.uuid4()))

        with self.assertRaisesRegex(frappe.ValidationError, "Room Owner already has"):
            start(other.name, str(uuid.uuid4()))

        stop(self.room.name)
        self.assertEqual(start(other.name, str(uuid.uuid4()))["status"], "Recording")
        self.assertEqual(frappe.db.get_value("Meet Recording", first["name"], "status"), "Processing")

    def test_e2ee_and_recording_are_mutually_exclusive(self):
        self.room.enable_e2ee()
        frappe.db.commit()
        self.assertFalse(get_preflight(self.room.name)["eligible"])
        with self.assertRaises(frappe.ValidationError):
            start(self.room.name, str(uuid.uuid4()))

        frappe.set_user(self.owner)
        other = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        start(other.name, str(uuid.uuid4()))
        with self.assertRaisesRegex(frappe.ValidationError, "Stop the active recording"):
            other.enable_e2ee()

    def test_cohost_controls_recording_but_owner_owns_session(self):
        self.room.add_user_to_table("members", self.cohost, save=True, ignore_permissions=True)
        self.room.add_user_to_table("co_hosts", self.cohost, save=True, ignore_permissions=True)
        frappe.set_user(self.cohost)

        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        self.assertEqual(recording.initiated_by, self.cohost)
        self.assertEqual(recording.room_owner, self.owner)
        self.assertEqual(frappe.get_doc("File", recording.drive_home_folder).owner, self.owner)
        self.assertEqual(stop(self.room.name)["status"], "Processing")
        content = b"cohost-recording"
        digest = hashlib.sha256(content).hexdigest()
        begin_upload(
            recording.name,
            event_sequence=2,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
        )
        recording.reload()
        path = _upload_path(recording.upload_id)
        append_chunk(recording.name, offset=0, chunk=content, chunk_sha256=digest)
        artifact = None
        try:
            with (
                patch(
                    "suite.meet.recording.ingest._validate_media",
                    return_value={"duration_ms": 1000},
                ),
                patch(
                    "suite.meet.recording.ingest._recordings_folder",
                    return_value=recording.drive_home_folder,
                ),
                patch("suite.meet.recording.ingest.update_file_size"),
                patch("suite.meet.recording.ingest.FileManager.upload_file"),
            ):
                result = process_upload(recording.name, event_sequence=3)
            artifact = frappe.get_doc("File", result["artifact"])
            self.assertEqual(artifact.owner, self.owner)
        finally:
            path.unlink(missing_ok=True)
            if artifact:
                frappe.delete_doc("File", artifact.name, force=True, ignore_permissions=True)

    def test_recordings_folder_does_not_alias_foreign_owned_folder(self):
        manager = FileManager()
        if manager.flat:
            self.skipTest("hierarchical Drive storage required")
        home = get_user_folder(self.owner)
        parent = create_drive_file(
            f"recording-folder-test-{frappe.generate_hash(length=8)}",
            home.name,
            "Folder",
            lambda file: manager.create_folder(file),
        )
        frappe.set_user(self.cohost)
        foreign_folder = create_drive_file(
            "Meet Recordings",
            parent.name,
            "Folder",
            lambda file: manager.create_folder(file),
        )
        frappe.set_user(self.owner)
        recording = frappe._dict(drive_home_folder=parent.name, room_owner=self.owner)
        owner_folder = frappe.get_doc("File", _recordings_folder(recording))

        try:
            self.assertEqual(owner_folder.owner, self.owner)
            self.assertNotEqual(owner_folder.file_name, foreign_folder.file_name)
            self.assertNotEqual(owner_folder.file_url, foreign_folder.file_url)
        finally:
            manager.delete_file(owner_folder)
            manager.delete_file(foreign_folder)
            manager.delete_file(parent)
            frappe.delete_doc("File", owner_folder.name, force=True, ignore_permissions=True)
            frappe.delete_doc("File", foreign_folder.name, force=True, ignore_permissions=True)
            frappe.delete_doc("File", parent.name, force=True, ignore_permissions=True)

    def test_recorder_acceptance_timestamp_must_be_bound_to_request(self):
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        client.reserve.return_value = RecorderOutcome("indeterminate")
        with patch("suite.meet.api.recording._client", return_value=client):
            result = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", result["name"])

        invalid = (
            datetime.now(),
            datetime(2000, 1, 1, tzinfo=UTC),
            recording.max_ends_at.replace(tzinfo=UTC) + timedelta(seconds=1),
        )
        for accepted_at in invalid:
            with self.subTest(accepted_at=accepted_at), self.assertRaises(frappe.ValidationError):
                _accept(
                    self.room,
                    recording,
                    RecorderOutcome("accepted", accepted_at, PUBLIC_JWK),
                )

    def test_estimate_contract_for_ad_hoc_scheduled_and_recurring_rooms(self):
        fixed_now = datetime(2026, 8, 10, 12, 0)
        self.assertEqual(_get_estimate(frappe._dict(calendar_event=None))[0], DEFAULT_ESTIMATE_SECONDS)
        cases = (
            (
                "future",
                frappe._dict(start="2026-08-10 13:00", duration="PT1H"),
                60 * 60 + 15 * 60,
            ),
            (
                "in-progress",
                frappe._dict(start="2026-08-10 11:30", duration="PT1H"),
                30 * 60 + 15 * 60,
            ),
            (
                "recurring",
                frappe._dict(
                    start="2026-08-10 13:00",
                    duration="PT2H",
                    recurrence_rule="FREQ=WEEKLY",
                ),
                2 * 60 * 60 + 15 * 60,
            ),
            (
                "capped",
                frappe._dict(start="2026-08-10 13:00", duration="PT8H"),
                MAX_SECONDS,
            ),
            (
                "cancelled",
                frappe._dict(status="Cancelled", start="2026-08-10 13:00", duration="PT1H"),
                DEFAULT_ESTIMATE_SECONDS,
            ),
        )
        for label, event, expected in cases:
            with (
                self.subTest(label=label),
                patch("suite.meet.api.recording.frappe.get_doc", return_value=event),
                patch("suite.meet.api.recording.now_datetime", return_value=fixed_now),
            ):
                seconds, estimated_bytes = _get_estimate(frappe._dict(calendar_event="event"))
                self.assertEqual(seconds, expected)
                self.assertEqual(estimated_bytes, expected * BYTES_PER_SECOND)

    def test_budget_eligibility_boundaries(self):
        for free_bytes, eligible in (
            (MINIMUM_BUDGET_BYTES - 1, False),
            (MINIMUM_BUDGET_BYTES, True),
            (DEFAULT_ESTIMATE_SECONDS * BYTES_PER_SECOND, True),
        ):
            with (
                self.subTest(free_bytes=free_bytes),
                patch("suite.meet.api.recording._get_free_bytes", return_value=free_bytes),
                patch("suite.meet.api.recording._get_drive_destination", return_value="home"),
                patch("suite.meet.api.recording._recorder_available", return_value=True),
            ):
                result = get_preflight(self.room.name)
                self.assertEqual(result["eligible"], eligible)
                self.assertEqual(result["budget_bytes"], min(result["estimated_bytes"], free_bytes))
                self.assertEqual(
                    result["budget_seconds"],
                    min(MAX_SECONDS, result["budget_bytes"] // BYTES_PER_SECOND),
                )

    def test_interruption_failure_and_duplicate_callbacks_are_ordered_and_published(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        with (
            patch("suite.meet.api.recording.authenticate_callback"),
            patch("suite.meet.api.recording.frappe.publish_realtime") as publish,
        ):
            self.assertEqual(
                recorder_interrupted(recording.name, recording.recorder_job_id, 2, "connection_lost"),
                {"status": "Interrupted"},
            )
            interruption_publish_count = publish.call_count
            self.assertEqual(
                recorder_interrupted(recording.name, recording.recorder_job_id, 2, "connection_lost"),
                {"status": "Interrupted"},
            )
            self.assertEqual(publish.call_count, interruption_publish_count)
            self.assertEqual(
                recorder_recovered(recording.name, recording.recorder_job_id, 2),
                {"status": "Recording"},
            )
            recovery_publish_count = publish.call_count
            self.assertEqual(
                recorder_recovered(recording.name, recording.recorder_job_id, 2),
                {"status": "Recording"},
            )
            self.assertEqual(publish.call_count, recovery_publish_count)
            self.assertEqual(
                recorder_interrupted(recording.name, recording.recorder_job_id, 3, "connection_lost"),
                {"status": "Interrupted"},
            )
            self.assertEqual(
                recorder_recovered(recording.name, recording.recorder_job_id, 3),
                {"status": "Recording"},
            )
            second_recovery_publish_count = publish.call_count
            self.assertEqual(
                recorder_failed(recording.name, recording.recorder_job_id, 4, "capture_failed"),
                {"status": "Failed"},
            )
            self.assertGreater(publish.call_count, second_recovery_publish_count)

        recording.reload()
        self.assertEqual(recording.status, "Failed")
        self.assertEqual(recording.state_revision, 6)
        self.assertEqual(recording.recorder_event_sequence, 4)
        self.assertIsNotNone(recording.ended_at)

    def test_callback_timestamps_and_gaps_stay_within_recording(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        recording.status = "Stopping"
        recording.state_revision += 1
        recording.end_reason = "host_stop"
        recording.save(ignore_permissions=True)
        content = b"artifact"
        digest = hashlib.sha256(content).hexdigest()
        started_at = recording.started_at.replace(tzinfo=UTC)

        invalid_ends = (
            "2026-08-10 12:00:00",
            (_system_datetime_as_utc(recording.max_ends_at) + timedelta(seconds=1)).isoformat(),
            (started_at - timedelta(seconds=1)).isoformat(),
        )
        for ended_at in invalid_ends:
            with self.subTest(ended_at=ended_at), self.assertRaises(frappe.ValidationError):
                begin_upload(
                    recording.name,
                    event_sequence=2,
                    size=len(content),
                    sha256=digest,
                    duration_ms=1000,
                    ended_at=ended_at,
                    end_reason="host_stop",
                )
            recording.reload()

        valid_end = (started_at + timedelta(seconds=60)).isoformat()
        gap = {
            "started_at": (started_at - timedelta(seconds=1)).isoformat(),
            "ended_at": (started_at + timedelta(seconds=1)).isoformat(),
            "reason": "capture_interrupted",
        }
        with self.assertRaisesRegex(frappe.ValidationError, "within the recording interval"):
            begin_upload(
                recording.name,
                event_sequence=2,
                size=len(content),
                sha256=digest,
                duration_ms=1000,
                gaps=[gap],
                ended_at=valid_end,
                end_reason="host_stop",
            )

    def test_reconciliation_bounds_stale_states_and_cleans_failed_uploads(self):
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        recording = frappe.get_doc("Meet Recording", started["name"])
        content = b"abandoned-upload"
        digest = hashlib.sha256(content).hexdigest()
        begin_upload(
            recording.name,
            event_sequence=recording.recorder_event_sequence,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
        )
        recording.reload()
        upload_path = _upload_path(recording.upload_id)
        append_chunk(recording.name, offset=0, chunk=content, chunk_sha256=digest)
        self.assertTrue(upload_path.exists())
        frappe.db.set_value(
            "Meet Recording",
            recording.name,
            "modified",
            add_to_date(now_datetime(), days=-2),
            update_modified=False,
        )

        reconcile_pending_recordings()
        recording.reload()
        self.assertEqual(recording.status, "Failed")
        self.assertEqual(recording.failure_code, "processing_failed")

        frappe.db.set_value(
            "Meet Recording",
            recording.name,
            "modified",
            add_to_date(now_datetime(), days=-31),
            update_modified=False,
        )
        reconcile_pending_recordings()
        self.assertFalse(frappe.db.exists("Meet Recording", recording.name))
        self.assertFalse(upload_path.exists())

        pending = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": self.room.name,
                "room_owner": self.owner,
                "initiated_by": self.owner,
                "status": "Pending",
                "estimated_seconds": 60,
                "estimated_bytes": MINIMUM_BUDGET_BYTES,
                "budget_bytes": MINIMUM_BUDGET_BYTES,
                "max_ends_at": add_to_date(now_datetime(), days=-1),
                "recorder_job_id": frappe.generate_hash(length=32),
                "request_id": str(uuid.uuid4()),
                "pending_deadline": add_to_date(now_datetime(), days=-1),
                "drive_home_folder": recording.drive_home_folder,
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        reconcile_pending_recordings()
        self.assertEqual(frappe.db.get_value("Meet Recording", pending.name, "status"), "Failed")

        frappe.conf.recording_fixture_mode = True
        started = start(self.room.name, str(uuid.uuid4()))
        frappe.db.set_value(
            "Meet Recording",
            started["name"],
            {
                "status": "Stopping",
                "state_revision": 2,
                "started_at": add_to_date(now_datetime(), days=-2),
                "max_ends_at": add_to_date(now_datetime(), days=-1),
            },
            update_modified=False,
        )
        reconcile_pending_recordings()
        self.assertEqual(frappe.db.get_value("Meet Recording", started["name"], "status"), "Failed")

    def test_real_drive_trash_restore_and_permanent_delete_removes_blob_and_metadata(self):
        manager = FileManager()
        if manager.s3_enabled or manager.flat:
            self.skipTest("local hierarchical Drive storage required")
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        content = b"real-recording-artifact"
        digest = hashlib.sha256(content).hexdigest()
        begin_upload(
            started["name"],
            event_sequence=2,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
        )
        recording = frappe.get_doc("Meet Recording", started["name"])
        append_chunk(recording.name, offset=0, chunk=content, chunk_sha256=digest)
        with patch("suite.meet.recording.ingest._validate_media", return_value={"duration_ms": 1000}):
            result = process_upload(recording.name, event_sequence=3)
        artifact = frappe.get_doc("File", result["artifact"])
        active_path = manager.get_local_path(artifact.file_url)
        trash_path = manager.get_local_path(
            Path(manager.get_root_storage_key()) / TRASH_PREFIX / artifact.name
        )
        self.assertEqual(active_path.read_bytes(), content)

        remove_or_restore([artifact.name])
        self.assertTrue(trash_path.exists())
        self.assertTrue(frappe.db.exists("Meet Recording", recording.name))
        remove_or_restore([artifact.name])
        self.assertEqual(active_path.read_bytes(), content)
        remove_or_restore([artifact.name])
        delete_entities([artifact.name])
        frappe.db.commit()

        self.assertFalse(trash_path.exists())
        self.assertFalse(frappe.db.exists("Meet Recording", recording.name))
        frappe.delete_doc("File", artifact.name, force=True, ignore_permissions=True)
