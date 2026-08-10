# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import hashlib
import time
import uuid
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import frappe
import jwt
from frappe.tests import IntegrationTestCase

from suite.drive.api.storage import get_storage_usage
from suite.meet.api.recording import (
    _limits,
    _system_datetime_as_utc,
    get_preflight,
    get_state,
    reconcile_pending_recordings,
    recorder_failed,
    recorder_interrupted,
    start,
    stop,
)
from suite.meet.recording.callback_auth import CALLBACK_AUDIENCE, CALLBACK_TYPE, authenticate_callback
from suite.meet.recording.ingest import _upload_path, append_chunk, begin_upload, complete_upload
from suite.meet.recording.recorder_client import RecorderOutcome

PUBLIC_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
    "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
}


class IntegrationTestRecordingApi(IntegrationTestCase):
    def test_recorder_limits_use_javascript_compatible_utc_timestamp(self):
        recording = Mock(
            budget_bytes=1,
            max_ends_at=datetime(2026, 8, 1, 12, 30, 45, 123456),
        )

        with patch("frappe.utils.get_system_timezone", return_value="UTC"):
            self.assertEqual(_limits(recording)["max_ends_at"], "2026-08-01T12:30:45.123Z")

    def test_recording_deadlines_are_converted_from_system_timezone(self):
        with patch("frappe.utils.get_system_timezone", return_value="Asia/Kolkata"):
            self.assertEqual(
                _system_datetime_as_utc("2026-08-02 04:45:00"),
                datetime(2026, 8, 1, 23, 15, tzinfo=UTC),
            )

    def test_recorder_uses_configured_site_origin(self):
        frappe.conf.recorder_site_origin = "https://meet.example.com"
        try:
            from suite.meet.api.recording import _client

            self.assertEqual(_client().origin, "https://meet.example.com")
        finally:
            frappe.conf.pop("recorder_site_origin", None)

    def setUp(self):
        self.owner = "recording-owner@example.com"
        if not frappe.db.exists("User", self.owner):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": self.owner,
                    "first_name": "Recording Owner",
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
        frappe.db.delete("Meet Recording", {"meet_room": self.room.name})
        frappe.delete_doc("Meet Room", self.room.name, force=True, ignore_permissions=True)
        frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
        frappe.db.commit()
        frappe.clear_cache(doctype="Meet Settings")
        frappe.conf.pop("recording_fixture_mode", None)

    def test_preflight_start_retry_state_and_stop(self):
        preflight = get_preflight(self.room.name)
        self.assertTrue(preflight["eligible"])
        self.assertGreater(preflight["budget_bytes"], 0)

        request_id = str(uuid.uuid4())
        started = start(self.room.name, request_id)
        self.assertEqual(started["status"], "Recording")
        self.assertEqual(start(self.room.name, request_id), started)
        self.assertEqual(get_state(self.room.name)["name"], started["name"])

        frappe.db.commit()
        stopped = stop(self.room.name)
        self.assertEqual(stopped["status"], "Processing")
        self.assertIsNone(get_state(self.room.name))

    def test_start_retry_after_grant_expiry_keeps_active_recording(self):
        request_id = str(uuid.uuid4())
        started = start(self.room.name, request_id)
        recording = frappe.get_doc("Meet Recording", started["name"])
        recording.db_set("grant_expires_at", int(time.time()) - 1, update_modified=False)
        before = {
            "status": recording.status,
            "state_revision": recording.state_revision,
            "stop_operation_id": recording.stop_operation_id,
            "end_reason": recording.end_reason,
        }

        with patch("suite.meet.api.recording._client") as client:
            retried = start(self.room.name, request_id)

        recording.reload()
        self.assertEqual(retried, started)
        self.assertEqual(
            {
                "status": recording.status,
                "state_revision": recording.state_revision,
                "stop_operation_id": recording.stop_operation_id,
                "end_reason": recording.end_reason,
            },
            before,
        )
        client.assert_not_called()

    def test_non_host_cannot_stop_recording(self):
        started = start(self.room.name, str(uuid.uuid4()))
        frappe.set_user("Administrator")

        with self.assertRaises(frappe.PermissionError):
            stop(self.room.name)

        self.assertEqual(
            frappe.db.get_value("Meet Recording", started["name"], "status"),
            "Recording",
        )

    def test_artifact_upload_is_ordered_hash_bound_and_replay_safe(self):
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        content = b"recording-artifact"
        digest = hashlib.sha256(content).hexdigest()

        state = begin_upload(
            started["name"],
            event_sequence=2,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
        )
        self.assertEqual(state, {"offset": 0, "complete": False})
        recording = frappe.get_doc("Meet Recording", started["name"])
        path = _upload_path(recording.upload_id)
        try:
            first = content[:8]
            first_hash = hashlib.sha256(first).hexdigest()
            self.assertEqual(
                append_chunk(started["name"], offset=0, chunk=first, chunk_sha256=first_hash),
                {"offset": len(first)},
            )
            self.assertEqual(
                append_chunk(started["name"], offset=0, chunk=first, chunk_sha256=first_hash),
                {"offset": len(first)},
            )
            conflicting = b"x" * len(first)
            with self.assertRaises(frappe.ValidationError):
                append_chunk(
                    started["name"],
                    offset=0,
                    chunk=conflicting,
                    chunk_sha256=hashlib.sha256(conflicting).hexdigest(),
                )
            with self.assertRaises(frappe.ValidationError):
                append_chunk(
                    started["name"],
                    offset=len(first) + 1,
                    chunk=content[8:],
                    chunk_sha256=hashlib.sha256(content[8:]).hexdigest(),
                )
            self.assertEqual(
                append_chunk(
                    started["name"],
                    offset=len(first),
                    chunk=content[8:],
                    chunk_sha256=hashlib.sha256(content[8:]).hexdigest(),
                ),
                {"offset": len(content)},
            )
            self.assertEqual(path.read_bytes(), content)
        finally:
            path.unlink(missing_ok=True)

    def test_recorder_callback_token_is_exact_and_job_bound(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        now = int(time.time())
        claims = {
            "iss": f"meet-recorder:{frappe.local.site}",
            "aud": CALLBACK_AUDIENCE,
            "site": frappe.local.site,
            "recording": recording.name,
            "job": recording.recorder_job_id,
            "operation": "stopped",
            "operation_id": "2",
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + 30,
        }
        token = jwt.encode(
            claims,
            frappe.conf.recorder_secret,
            algorithm="HS256",
            headers={"typ": CALLBACK_TYPE},
        )
        original_request = getattr(frappe.local, "request", None)
        frappe.local.request = Mock(headers={"X-Meet-Recorder-Authorization": f"Bearer {token}"})
        try:
            self.assertEqual(
                authenticate_callback(
                    recording=recording.name,
                    job=recording.recorder_job_id,
                    operation="stopped",
                    operation_id="2",
                    now=now,
                )["jti"],
                claims["jti"],
            )
            with self.assertRaises(frappe.AuthenticationError):
                authenticate_callback(
                    recording=recording.name,
                    job=recording.recorder_job_id,
                    operation="complete_upload",
                    operation_id="2",
                    now=now,
                )
        finally:
            if original_request is None:
                del frappe.local.request
            else:
                frappe.local.request = original_request

    def test_completed_upload_creates_owner_drive_file_and_consumes_reservation(self):
        usage_before = get_storage_usage(self.owner)
        started = start(self.room.name, str(uuid.uuid4()))
        reserved = get_storage_usage(self.owner)
        budget = frappe.db.get_value("Meet Recording", started["name"], "budget_bytes")
        self.assertEqual(reserved["reserved_size"], usage_before.get("reserved_size", 0) + budget)
        stop(self.room.name)
        content = b"validated-mp4"
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
        append_chunk(
            recording.name,
            offset=0,
            chunk=content,
            chunk_sha256=digest,
        )
        artifact = None
        try:
            frappe.set_user("Guest")
            with (
                patch("suite.meet.recording.ingest._validate_media", return_value={"duration_ms": 1000}),
                patch(
                    "suite.meet.recording.ingest._recordings_folder",
                    return_value=recording.drive_home_folder,
                ),
                patch("suite.meet.recording.ingest.update_file_size"),
                patch("suite.meet.recording.ingest.FileManager.upload_file"),
            ):
                result = complete_upload(recording.name, event_sequence=3)
                self.assertEqual(complete_upload(recording.name, event_sequence=3), result)

            completed = frappe.get_doc("Meet Recording", recording.name)
            artifact = frappe.get_doc("File", completed.artifact)
            self.assertEqual(result, {"artifact": artifact.name, "status": "Ready"})
            self.assertEqual(completed.artifact_size, len(content))
            self.assertEqual(completed.artifact_sha256, digest)
            self.assertEqual(artifact.owner, self.owner)
            self.assertEqual(artifact.folder, recording.drive_home_folder)
            self.assertEqual(artifact.file_type, "Video")
            self.assertEqual(artifact.mime_type, "video/mp4")
            self.assertTrue(artifact.file_name.startswith(f"{self.room.name} - "))
            artifact.status = "Trashed"
            artifact.save(ignore_permissions=True)
            self.assertTrue(frappe.db.exists("Meet Recording", recording.name))
            artifact.status = "Removed"
            artifact.save(ignore_permissions=True)
            self.assertFalse(frappe.db.exists("Meet Recording", recording.name))
        finally:
            frappe.set_user(self.owner)
            path.unlink(missing_ok=True)
            if artifact:
                frappe.delete_doc("File", artifact.name, force=True, ignore_permissions=True)

    def test_completed_upload_with_capture_gap_creates_partial_artifact(self):
        started = start(self.room.name, str(uuid.uuid4()))
        stop(self.room.name)
        content = b"partial-mp4"
        digest = hashlib.sha256(content).hexdigest()
        gap = {
            "started_at": "2026-08-01T00:00:00.000Z",
            "ended_at": "2026-08-01T00:00:01.000Z",
            "reason": "ffmpeg_exited",
        }
        begin_upload(
            started["name"],
            event_sequence=2,
            size=len(content),
            sha256=digest,
            duration_ms=1000,
            gaps=[gap],
            ended_at="2026-08-01T00:00:01.000Z",
        )
        recording = frappe.get_doc("Meet Recording", started["name"])
        self.assertIsNone(recording.ended_at.tzinfo)
        path = _upload_path(recording.upload_id)
        append_chunk(recording.name, offset=0, chunk=content, chunk_sha256=digest)
        artifact = None
        try:
            with (
                patch("suite.meet.recording.ingest._validate_media", return_value={"duration_ms": 1000}),
                patch(
                    "suite.meet.recording.ingest._recordings_folder",
                    return_value=recording.drive_home_folder,
                ),
                patch("suite.meet.recording.ingest.update_file_size"),
                patch("suite.meet.recording.ingest.FileManager.upload_file"),
            ):
                result = complete_upload(recording.name, event_sequence=3)
            completed = frappe.get_doc("Meet Recording", recording.name)
            artifact = frappe.get_doc("File", completed.artifact)
            self.assertEqual(result["status"], "Partial")
            self.assertEqual(frappe.parse_json(completed.capture_gaps), [gap])
        finally:
            path.unlink(missing_ok=True)
            if artifact:
                frappe.delete_doc("File", artifact.name, force=True, ignore_permissions=True)

    def test_outsider_cannot_preflight_or_read_state(self):
        outsider = "recording-outsider@example.com"
        if not frappe.db.exists("User", outsider):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": outsider,
                    "first_name": "Recording Outsider",
                    "enabled": 1,
                    "new_password": "password",
                }
            ).insert(ignore_permissions=True)
        frappe.set_user(outsider)

        with self.assertRaises(frappe.PermissionError):
            get_preflight(self.room.name)
        with self.assertRaises(frappe.PermissionError):
            get_state(self.room.name)

    def test_http_acceptance_persists_recorder_timestamp_and_key_then_delivers_grant(self):
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        accepted_at = datetime(2026, 7, 31, 10, 11, 12, 123000, tzinfo=UTC)
        client.reserve.return_value = RecorderOutcome("accepted", accepted_at, PUBLIC_JWK)
        client.deliver_grant.return_value = True

        with patch("suite.meet.api.recording._client", return_value=client):
            result = start(self.room.name, str(uuid.uuid4()))

        recording = frappe.get_doc("Meet Recording", result["name"])
        self.assertEqual(result, {"name": recording.name, "status": "Recording", "grant_delivered": True})
        self.assertEqual(recording.started_at, accepted_at.replace(tzinfo=None))
        self.assertEqual(frappe.parse_json(recording.recorder_public_jwk), PUBLIC_JWK)
        self.assertEqual(recording.recorder_key_thumbprint, "xx0BcA-wMohw8atYDJOe6peGModklG2wRHBlXHMvl0M")
        client.deliver_grant.assert_called_once()

    def test_interruption_callback_publishes_interrupted_state(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])

        with patch("suite.meet.api.recording.authenticate_callback"):
            result = recorder_interrupted(
                recording.name,
                recording.recorder_job_id,
                2,
                "connection_lost",
            )

        recording.reload()
        self.assertEqual(result, {"status": "Interrupted"})
        self.assertEqual(recording.status, "Interrupted")
        self.assertEqual(recording.recorder_event_sequence, 2)

    def test_duplicate_interruption_callback_does_not_advance_state(self):
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])

        with patch("suite.meet.api.recording.authenticate_callback"):
            first = recorder_interrupted(recording.name, recording.recorder_job_id, 2, "connection_lost")
            second = recorder_interrupted(recording.name, recording.recorder_job_id, 2, "connection_lost")

        recording.reload()
        self.assertEqual(first, second)
        self.assertEqual(recording.state_revision, 2)
        self.assertEqual(recording.recorder_event_sequence, 2)

    def test_failed_recording_releases_storage_reservation(self):
        usage_before = get_storage_usage(self.owner)
        started = start(self.room.name, str(uuid.uuid4()))
        recording = frappe.get_doc("Meet Recording", started["name"])
        self.assertGreater(
            get_storage_usage(self.owner)["reserved_size"], usage_before.get("reserved_size", 0)
        )

        with patch("suite.meet.api.recording.authenticate_callback"):
            recorder_failed(recording.name, recording.recorder_job_id, 2, "capture_failed")

        self.assertEqual(get_storage_usage(self.owner)["reserved_size"], usage_before.get("reserved_size", 0))

    def test_reconciliation_continues_after_one_recording_fails(self):
        with (
            patch("suite.meet.api.recording.frappe.get_all", side_effect=[["first", "second"], []]),
            patch(
                "suite.meet.api.recording._reconcile_pending",
                side_effect=[RuntimeError("broken recording"), None],
            ) as reconcile,
            patch("suite.meet.api.recording.frappe.log_error") as log_error,
        ):
            reconcile_pending_recordings()

        self.assertEqual(reconcile.call_count, 2)
        log_error.assert_called_once()

    def test_explicit_rejection_deletes_pending_but_indeterminate_keeps_it(self):
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        client.reserve.return_value = RecorderOutcome("rejected", reason="capacity")
        with (
            patch("suite.meet.api.recording._client", return_value=client),
            patch("suite.meet.api.recording.frappe.publish_realtime") as publish,
        ):
            self.assertEqual(start(self.room.name, str(uuid.uuid4())), {"status": "Rejected"})
        self.assertFalse(frappe.db.exists("Meet Recording", {"meet_room": self.room.name}))
        self.assertTrue(
            any(
                (call.kwargs.get("message") or call.args[1]).get("recording") is None
                for call in publish.call_args_list
            )
        )

        client.reserve.return_value = RecorderOutcome("indeterminate")
        with patch("suite.meet.api.recording._client", return_value=client):
            result = start(self.room.name, str(uuid.uuid4()))
        self.assertEqual(result["status"], "Pending")
        self.assertTrue(frappe.db.exists("Meet Recording", result["name"]))

    def test_ambiguous_grant_delivery_stops_the_accepted_session(self):
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        client.reserve.return_value = RecorderOutcome(
            "accepted", datetime(2026, 7, 31, tzinfo=UTC), PUBLIC_JWK
        )
        client.deliver_grant.return_value = False
        client.stop.return_value = True
        request_id = str(uuid.uuid4())
        with patch("suite.meet.api.recording._client", return_value=client):
            result = start(self.room.name, request_id)

        self.assertEqual(result["status"], "Stopping")
        self.assertFalse(result["grant_delivered"])
        self.assertEqual(
            frappe.db.get_value("Meet Recording", result["name"], "status"),
            "Stopping",
        )
        client.stop.assert_called_once()

    def test_missing_sfu_secret_makes_recorder_unavailable(self):
        secret = frappe.conf.pop("sfu_secret")
        try:
            self.assertFalse(get_preflight(self.room.name)["recorder_available"])
        finally:
            frappe.conf.sfu_secret = secret

    def test_production_stop_calls_recorder_after_stopping_and_keeps_ambiguous_state(self):
        started = start(self.room.name, str(uuid.uuid4()))
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        client.stop.return_value = False
        with patch("suite.meet.api.recording._client", return_value=client):
            result = stop(self.room.name)
        recording = frappe.get_doc("Meet Recording", started["name"])
        self.assertEqual(result["status"], "Stopping")
        self.assertEqual(recording.status, "Stopping")
        client.stop.assert_called_once()
        self.assertEqual(client.stop.call_args.kwargs["operation_id"], recording.stop_operation_id)

        with patch("suite.meet.api.recording._client", return_value=client):
            reconcile_pending_recordings()
        self.assertEqual(client.stop.call_count, 2)
        self.assertEqual(client.stop.call_args.kwargs["operation_id"], recording.stop_operation_id)

    def test_pending_reconciliation_accepts_rejects_and_keeps_indeterminate(self):
        frappe.conf.recording_fixture_mode = False
        outcomes = [
            RecorderOutcome("accepted", datetime(2026, 7, 31, tzinfo=UTC), PUBLIC_JWK),
            RecorderOutcome("rejected", reason="capacity"),
            RecorderOutcome("indeterminate"),
        ]
        client = Mock()
        client.deliver_grant.return_value = True
        with patch("suite.meet.api.recording._client", return_value=client):
            names = []
            for outcome in outcomes:
                client.reserve.return_value = RecorderOutcome("indeterminate")
                result = start(self.room.name, str(uuid.uuid4()))
                frappe.db.set_value("Meet Recording", result["name"], "pending_deadline", "2000-01-01")
                names.append(result["name"])
                client.query.return_value = outcome
                reconcile_pending_recordings()
                if outcome.outcome == "accepted":
                    frappe.db.delete("Meet Recording", result["name"])
                    frappe.db.commit()
        self.assertFalse(frappe.db.exists("Meet Recording", names[1]))
        self.assertEqual(frappe.db.get_value("Meet Recording", names[2], "status"), "Pending")

    def test_reconciliation_compensates_policy_change_without_blind_delete(self):
        frappe.conf.recording_fixture_mode = False
        client = Mock()
        client.reserve.return_value = RecorderOutcome("indeterminate")
        with patch("suite.meet.api.recording._client", return_value=client):
            result = start(self.room.name, str(uuid.uuid4()))
            frappe.db.set_value("Meet Recording", result["name"], "pending_deadline", "2000-01-01")
            frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
            frappe.clear_cache(doctype="Meet Settings")
            client.query.return_value = RecorderOutcome(
                "accepted", datetime(2026, 7, 31, tzinfo=UTC), PUBLIC_JWK
            )
            client.stop.return_value = False
            reconcile_pending_recordings()
            self.assertTrue(frappe.db.exists("Meet Recording", result["name"]))
            operation_id = client.stop.call_args.kwargs["operation_id"]
            client.stop.return_value = True
            reconcile_pending_recordings()
        self.assertEqual(client.stop.call_args.kwargs["operation_id"], operation_id)
        self.assertFalse(frappe.db.exists("Meet Recording", result["name"]))
