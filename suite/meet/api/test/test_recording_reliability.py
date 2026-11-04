# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import hashlib
import io
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

import frappe
from frappe.api import handle
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite import drive
from suite.composition.http import handle_before_request
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
    recorder_stopped,
    start,
    stop,
)
from suite.meet.api.recordings import get_recordings
from suite.meet.patches.backfill_recording_finalization import execute as backfill_recording_finalization
from suite.meet.recording.ingest import (
    _recordings_folder,
    _upload_path,
    append_chunk,
    begin_upload,
    complete_upload,
    delete_recordings_for_purged_artifacts,
    finalization_status,
    process_upload,
    reconcile_due_finalizations,
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
        self.artifacts = []
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
        for owner, artifact in self.artifacts:
            if frappe.db.exists("Drive Node", artifact):
                frappe.set_user(owner)
                self._artifact_request(artifact, "PATCH", state="Trashed")
                self._artifact_request(artifact, "DELETE")
        frappe.set_user("Administrator")
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

        concurrent = start(self.room.name, str(uuid.uuid4()))
        self.assertEqual(concurrent["name"], first["name"])

        self.assertEqual(
            frappe.db.count(
                "Meet Recording",
                {
                    "meet_room": self.room.name,
                    "status": ["in", ("Pending", "Starting", "Recording", "Interrupted", "Stopping")],
                },
            ),
            1,
        )

    def test_one_active_recording_per_room_owner_by_default(self):
        other = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        first = start(self.room.name, str(uuid.uuid4()))
        root = drive.personal_root_for(self.owner)
        charged_bytes = drive.get_storage_usage(root)["used_bytes"]
        reservations = frappe.db.count("Drive Storage Reservation", {"root": root})

        with self.assertRaisesRegex(frappe.ValidationError, "Room Owner already has"):
            start(other.name, str(uuid.uuid4()))

        # A refused start keeps nothing: no recording row for the second room,
        # no reservation for it, and no bytes charged to the owner root.
        self.assertEqual(frappe.db.count("Meet Recording", {"meet_room": other.name}), 0)
        self.assertEqual(frappe.db.count("Drive Storage Reservation", {"root": root}), reservations)
        self.assertEqual(drive.get_storage_usage(root)["used_bytes"], charged_bytes)

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
        self.assertEqual(recording.drive_home_folder, drive.personal_root_for(self.owner))
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
        complete_upload(recording.name, event_sequence=7)
        try:
            with patch("suite.meet.recording.ingest._validate_media", return_value={"duration_ms": 1000}):
                result = process_upload(recording.name)
            self.assertEqual(frappe.db.get_value("Drive Node", result["artifact"], "owner"), self.owner)
        finally:
            path.unlink(missing_ok=True)

    def test_recordings_folder_does_not_alias_foreign_owned_folder(self):
        root = drive.personal_root_for(self.owner)
        parent = drive.ensure_folder(root, f"recording-folder-test-{frappe.generate_hash(length=8)}")
        frappe.set_user("Administrator")
        foreign_folder = drive.ensure_folder(parent, "Meet Recordings")
        frappe.set_user(self.owner)

        recording = frappe._dict(drive_home_folder=parent, room_owner=self.owner)
        owner_folder = _recordings_folder(recording)

        self.assertNotEqual(owner_folder, foreign_folder)
        self.assertEqual(_recordings_folder(recording), owner_folder)
        rows = {
            row.name: row
            for row in frappe.get_all(
                "Drive Node",
                filters={"name": ["in", [owner_folder, foreign_folder]]},
                fields=["name", "owner", "title", "parent_node"],
            )
        }
        self.assertEqual(rows[owner_folder].owner, self.owner)
        self.assertEqual(rows[owner_folder].parent_node, parent)
        self.assertEqual(rows[foreign_folder].title, "Meet Recordings")
        self.assertNotEqual(rows[owner_folder].title, rows[foreign_folder].title)

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
                patch("suite.meet.api.recording._recorder_available", return_value=True),
            ):
                result = get_preflight(self.room.name)
                self.assertEqual(result["eligible"], eligible)
                self.assertEqual(result["budget_bytes"], min(MAX_SECONDS * BYTES_PER_SECOND, free_bytes))
                self.assertEqual(
                    result["budget_seconds"],
                    min(MAX_SECONDS, result["budget_bytes"] // BYTES_PER_SECOND),
                )

    def test_interruption_failure_and_duplicate_callbacks_are_ordered_and_published(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        first_id = str(uuid.uuid4())
        first_interrupted = _system_datetime_as_utc(now_datetime())
        first_interruption = (
            recording.name,
            recording.recorder_job_id,
            6,
            "sfu_disconnected",
            first_id,
            first_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            (first_interrupted + timedelta(seconds=60))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            recording.started_at.replace(tzinfo=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            1,
        )
        first_recovery = (
            recording.name,
            recording.recorder_job_id,
            7,
            first_id,
            first_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            first_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            1,
        )
        second_id = str(uuid.uuid4())
        second_interrupted = first_interrupted
        second_interruption = (
            recording.name,
            recording.recorder_job_id,
            8,
            "sfu_disconnected",
            second_id,
            second_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            (second_interrupted + timedelta(seconds=60))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            first_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            1,
        )
        second_recovery = (
            recording.name,
            recording.recorder_job_id,
            9,
            second_id,
            second_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            second_interrupted.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            1,
        )
        with (
            patch("suite.meet.api.recording.authenticate_callback"),
            patch("suite.meet.api.recording.frappe.publish_realtime") as publish,
        ):
            self.assertEqual(
                recorder_interrupted(*first_interruption),
                {"protocol_version": 1, "status": "Interrupted"},
            )
            interruption_publish_count = publish.call_count
            self.assertEqual(
                recorder_interrupted(*first_interruption),
                {"protocol_version": 1, "status": "Interrupted"},
            )
            self.assertEqual(publish.call_count, interruption_publish_count)
            self.assertEqual(
                recorder_recovered(*first_recovery),
                {"protocol_version": 1, "status": "Recording"},
            )
            recovery_publish_count = publish.call_count
            self.assertEqual(
                recorder_recovered(*first_recovery),
                {"protocol_version": 1, "status": "Recording"},
            )
            self.assertEqual(publish.call_count, recovery_publish_count)
            self.assertEqual(
                recorder_interrupted(*second_interruption),
                {"protocol_version": 1, "status": "Interrupted"},
            )
            self.assertEqual(
                recorder_recovered(*second_recovery),
                {"protocol_version": 1, "status": "Recording"},
            )
            second_recovery_publish_count = publish.call_count
            self.assertEqual(
                recorder_failed(recording.name, recording.recorder_job_id, 10, 1, "capture_failed"),
                {"protocol_version": 1, "status": "Failed"},
            )
            self.assertGreater(publish.call_count, second_recovery_publish_count)

        recording.reload()
        self.assertEqual(recording.status, "Failed")
        self.assertEqual(recording.state_revision, 6)
        self.assertEqual(recording.recorder_event_sequence, 10)
        self.assertIsNotNone(recording.ended_at)
        self.assertTrue(recording.notification_pending)

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
            (_system_datetime_as_utc(recording.max_ends_at) + timedelta(seconds=1))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            (started_at - timedelta(seconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        )
        for ended_at in invalid_ends:
            with self.subTest(ended_at=ended_at), self.assertRaises(frappe.ValidationError):
                begin_upload(
                    recording.name,
                    event_sequence=6,
                    size=len(content),
                    sha256=digest,
                    duration_ms=1000,
                    ended_at=ended_at,
                    end_reason="host_stop",
                )
            recording.reload()

        valid_end = (
            (started_at + timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        gap = {
            "started_at": (started_at - timedelta(seconds=1))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "ended_at": (started_at + timedelta(seconds=1))
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "reason": "capture_interrupted",
        }
        with self.assertRaisesRegex(frappe.ValidationError, "within the recording interval"):
            begin_upload(
                recording.name,
                event_sequence=6,
                size=len(content),
                sha256=digest,
                duration_ms=1000,
                gaps=[gap],
                ended_at=valid_end,
                end_reason="host_stop",
            )

    def test_invalid_terminal_metadata_fails_durably_and_allows_cleanup(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        recording.status = "Stopping"
        recording.state_revision += 1
        recording.end_reason = "host_stop"
        recording.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.db.set_value("Meet Room", self.room.name, "title", "Pending request update")
        started_at = recording.started_at.replace(tzinfo=UTC)
        ended_at = (
            (started_at + timedelta(seconds=60)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        invalid_gap_start = (
            (started_at - timedelta(seconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )

        with patch("suite.meet.api.recording.authenticate_callback"):
            result = recorder_stopped(
                recording.name,
                recording.recorder_job_id,
                recording.recorder_event_sequence + 1,
                8,
                8,
                hashlib.sha256(b"artifact").hexdigest(),
                1000,
                ended_at,
                "host_stop",
                1,
                [
                    {
                        "started_at": invalid_gap_start,
                        "ended_at": ended_at,
                        "reason_code": "capture_interrupted",
                    }
                ],
            )
            failed_revision = frappe.db.get_value("Meet Recording", recording.name, "state_revision")
            frappe.db.commit()
            replay = recorder_stopped(
                recording.name,
                recording.recorder_job_id,
                recording.recorder_event_sequence + 1,
                8,
                8,
                hashlib.sha256(b"artifact").hexdigest(),
                1000,
                ended_at,
                "host_stop",
                1,
                [
                    {
                        "started_at": invalid_gap_start,
                        "ended_at": ended_at,
                        "reason_code": "capture_interrupted",
                    }
                ],
            )

        self.assertEqual(result, {"protocol_version": 1, "offset": 0, "complete": True})
        self.assertEqual(replay, result)
        self.assertEqual(frappe.db.get_value("Meet Room", self.room.name, "title"), "Pending request update")
        recording.reload()
        self.assertEqual(recording.status, "Failed")
        self.assertEqual(recording.state_revision, failed_revision)
        self.assertEqual(recording.finalization_stage, "Terminal")
        self.assertEqual(recording.finalization_failure_type, "deterministic")
        self.assertEqual(recording.finalization_failure_code, "invalid_terminal_metadata")
        self.assertTrue(recording.notification_pending)
        self.assertEqual(
            finalization_status(recording.name),
            {"action": "delete_local", "terminal_result": "Failed"},
        )

    def test_upgrade_backfills_inflight_finalization_state(self):
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        content = b"legacy-artifact"
        digest = hashlib.sha256(content).hexdigest()
        begin_upload(
            started["name"],
            event_sequence=2,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
        )
        recording = frappe.get_doc("Meet Recording", started["name"])
        path = _upload_path(recording.upload_id)
        try:
            append_chunk(recording.name, offset=0, chunk=content, chunk_sha256=digest)
            frappe.db.set_value(
                "Meet Recording",
                recording.name,
                {
                    "finalization_stage": "Awaiting Upload",
                    "modified": add_to_date(now_datetime(), days=-2),
                    "metadata_accepted_at": None,
                    "upload_completed_at": None,
                    "finalization_deadline": None,
                    "finalization_next_retry_at": None,
                },
                update_modified=False,
            )

            backfill_recording_finalization()
            recording.reload()
            self.assertEqual(recording.finalization_stage, "Pending")
            self.assertIsNotNone(recording.metadata_accepted_at)
            self.assertLess(recording.metadata_accepted_at, add_to_date(now_datetime(), days=-1))
            self.assertIsNotNone(recording.upload_completed_at)
            self.assertIsNotNone(recording.finalization_deadline)
            self.assertLess(recording.finalization_deadline, now_datetime())
            self.assertIsNotNone(recording.finalization_next_retry_at)
            before = recording.as_dict()
            backfill_recording_finalization()
            recording.reload()
            self.assertEqual(recording.as_dict(), before)
        finally:
            path.unlink(missing_ok=True)

    def test_host_stop_reason_survives_conflicting_recorder_terminal_reason(self):
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        recording = frappe.get_doc("Meet Recording", started["name"])
        content = b"artifact"
        begin_upload(
            recording.name,
            event_sequence=recording.recorder_event_sequence + 1,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            duration_ms=1000,
            ended_at=_system_datetime_as_utc(now_datetime()).isoformat(),
            end_reason="interruption_timeout",
        )

        recording.reload()
        self.assertEqual(recording.end_reason, "host_stop")

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
            {
                "metadata_accepted_at": add_to_date(now_datetime(), days=-2),
                "finalization_deadline": add_to_date(now_datetime(), days=-1),
            },
            update_modified=False,
        )

        reconcile_due_finalizations()
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

    def _publish_recording(self) -> tuple[str, str]:
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
        complete_upload(recording.name, event_sequence=7)
        with patch("suite.meet.recording.ingest._validate_media", return_value={"duration_ms": 1000}):
            result = process_upload(recording.name)
        artifact = result["artifact"]
        self.artifacts.append((self.owner, artifact))
        stream, _mime = drive.read_file(artifact)
        with stream:
            self.assertEqual(stream.read(), content)
        return recording.name, artifact

    def _artifact_request(self, artifact: str, method: str, **body) -> None:
        request = Request(
            EnvironBuilder(path=f"/api/suite/drive/nodes/{artifact}", method=method).get_environ()
        )
        with (
            patch.object(frappe.local, "request", request, create=True),
            patch.object(frappe.local, "form_dict", frappe._dict(body)),
            patch.object(frappe.local, "response", frappe._dict(type="json")),
        ):
            handle_before_request()
            response = handle(request)
            self.assertEqual(response.status_code, 200)

    def test_trash_and_restore_keep_recording_metadata_and_listing(self):
        name, artifact = self._publish_recording()
        before = get_recordings()
        metadata = frappe.get_doc("Meet Recording", name).as_dict()
        self.assertEqual([row.name for row in before], [name])
        self.assertEqual(before[0].room_title, self.room.title)

        for state in ("Trashed", "Active"):
            with self.subTest(state=state):
                self._artifact_request(artifact, "PATCH", state=state)
                delete_recordings_for_purged_artifacts()
                self.assertTrue(frappe.db.exists("Meet Recording", name))
                self.assertEqual(frappe.get_doc("Meet Recording", name).as_dict(), metadata)
                self.assertEqual(get_recordings(), before)

    def test_unreadable_artifacts_are_hidden_without_removing_recording_metadata(self):
        name, artifact = self._publish_recording()
        frappe.set_user(self.cohost)
        foreign_artifact = drive.store_file(
            drive.personal_root_for(self.cohost), "Private recording.mp4", io.BytesIO(b"private")
        )
        self.artifacts.append((self.cohost, foreign_artifact))
        frappe.set_user(self.owner)
        frappe.db.set_value(
            "Meet Recording",
            name,
            "artifact",
            foreign_artifact,
            update_modified=False,
        )
        self.assertEqual(get_recordings(), [])
        delete_recordings_for_purged_artifacts()
        self.assertTrue(frappe.db.exists("Meet Recording", name))
        self.assertTrue(frappe.db.exists("Drive Node", artifact))

    def test_permanent_purge_hides_artifacts_then_removes_only_their_metadata(self):
        name, artifact = self._publish_recording()
        retained_name, retained_artifact = self._publish_recording()
        self._artifact_request(artifact, "PATCH", state="Trashed")
        self._artifact_request(artifact, "DELETE")
        self.assertFalse(frappe.db.exists("Drive Node", artifact))
        self.assertTrue(frappe.db.exists("Meet Recording", name))
        self.assertEqual([row.name for row in get_recordings()], [retained_name])

        delete_recordings_for_purged_artifacts()
        self.assertFalse(frappe.db.exists("Meet Recording", name))
        self.assertTrue(frappe.db.exists("Meet Recording", retained_name))
        self.assertTrue(frappe.db.exists("Drive Node", retained_artifact))
        delete_recordings_for_purged_artifacts()
        self.assertTrue(frappe.db.exists("Meet Recording", retained_name))

    def test_room_titles_follow_recording_order_and_missing_rooms_have_no_title(self):
        older, _ = self._publish_recording()
        newer, _ = self._publish_recording()
        frappe.db.set_value("Meet Recording", older, "started_at", datetime(2026, 1, 1, 10))
        frappe.db.set_value("Meet Recording", newer, "started_at", datetime(2026, 1, 1, 11))
        frappe.db.set_value("Meet Recording", newer, "meet_room", "missing-recording-room")
        with patch("suite.meet.api.recordings.frappe.get_all", wraps=frappe.get_all) as get_all:
            rows = get_recordings()
        self.assertEqual([row.name for row in rows], [newer, older])
        self.assertEqual([row.room_title for row in rows], [None, self.room.title])
        self.assertEqual(sum(call.args[0] == "Meet Room" for call in get_all.call_args_list), 1)

    def test_recordings_list_is_limited_to_the_latest_one_hundred(self):
        names = []
        for index in range(101):
            name, _ = self._publish_recording()
            frappe.db.set_value(
                "Meet Recording", name, "started_at", datetime(2026, 1, 1) + timedelta(minutes=index)
            )
            names.append(name)

        rows = get_recordings()
        self.assertEqual([row.name for row in rows], list(reversed(names[1:])))
        self.assertEqual([row.room_title for row in rows], [self.room.title] * 100)
