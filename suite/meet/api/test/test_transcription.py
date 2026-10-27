"""Integration coverage for the private queue and ordinary-user capture controls."""

import hashlib
import json
from datetime import timedelta
from unittest.mock import Mock, patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from suite.meet.api import transcription
from suite.meet.api.recording import get_preflight, start
from suite.meet.speech_context import make_hints
from suite.meet.transcription.protocol import MODEL


class IntegrationTestTranscription(IntegrationTestCase):
    def setUp(self):
        self.previous_user = frappe.session.user
        self.owner = "transcription-owner@example.com"
        self.attendee = "transcription-attendee@example.com"
        for email in (self.owner, self.attendee):
            if not frappe.db.exists("User", email):
                frappe.get_doc(
                    {"doctype": "User", "email": email, "first_name": "Transcription Test", "enabled": 1}
                ).insert(ignore_permissions=True)
        frappe.db.delete("Meet Transcription Job", {"room_owner": self.owner})
        frappe.db.delete("Meet Recording", {"room_owner": self.owner})
        frappe.set_user(self.owner)
        self.room = frappe.get_doc({"doctype": "Meet Room", "meeting_type": "open"}).insert()
        self.jobs = []

    def tearDown(self):
        frappe.set_user("Administrator")
        for name in self.jobs:
            frappe.db.delete("Meet Transcription Job", {"name": name})
        frappe.db.delete("Meet Recording", {"meet_room": self.room.name})
        frappe.db.delete("Meet Transcription Job", {"meet_room": self.room.name})
        frappe.delete_doc("Meet Room", self.room.name, ignore_permissions=True, force=True)
        frappe.set_user(self.previous_user)

    def job(self, status="Queued"):
        doc = frappe.get_doc(
            {
                "doctype": "Meet Transcription Job",
                "capture": frappe.generate_hash(),
                "meet_room": self.room.name,
                "room_owner": self.owner,
                "room_title": "Test",
                "capture_started_at": now_datetime(),
                "status": status,
                "retry_at": now_datetime(),
                "retention_deadline": now_datetime() + timedelta(days=7),
                "manifest": json.dumps({"segments": [], "gaps": []}),
                "model_configuration": json.dumps(MODEL),
                "recognition_hints": json.dumps(make_hints("Test", [])),
                "completed_segments": "[]",
            }
        ).insert(ignore_permissions=True)
        self.jobs.append(doc.name)
        return doc

    def test_attendee_cannot_start_or_inspect_host_preflight(self):
        frappe.set_user(self.attendee)
        with self.assertRaises(frappe.PermissionError):
            get_preflight(self.room.name, False, True)
        with self.assertRaises(frappe.PermissionError):
            start(self.room.name, "4d818270-fad0-4cd1-9fa1-be7987c06599", False, True)

    def test_start_failure_preserves_service_error_with_default_event_sequence(self):
        config = {
            "recorder_server_url": "http://localhost:3999",
            "sfu_server_url": "http://localhost:3998",
            "recorder_secret": "recorder-test-secret",
            "sfu_secret": "sfu-test-secret",
            "transcription_enabled": True,
            "transcription_worker_secret": "a" * 40,
            "recording_fixture_mode": True,
        }
        frappe.db.set_single_value("Meet Settings", "enable_recording", 1)
        frappe.clear_cache(doctype="Meet Settings")
        with (
            patch.dict(frappe.conf, config),
            patch("suite.meet.transcription.client.recorder"),
            patch(
                "suite.meet.transcription.client.sfu",
                side_effect=ConnectionError("Capture service unavailable"),
            ),
            self.assertRaisesRegex(ConnectionError, "Capture service unavailable"),
        ):
            start(self.room.name, "2b79388b-85c6-4eba-8e89-064c41adbc10", False, True)
        failed = frappe.get_doc("Meet Recording", {"meet_room": self.room.name})
        self.assertEqual(failed.status, "Failed")
        self.assertEqual(failed.failure_code, "capture_failed")
        self.assertIsNone(failed.started_at)

    def test_worker_auth_is_not_an_owner_privilege(self):
        with (
            patch("frappe.get_request_header", return_value=""),
            self.assertRaises(frappe.AuthenticationError),
        ):
            transcription.claim("worker")

    def test_queue_has_atomic_lease_and_rejects_stale_completions(self):
        job = self.job()
        with (
            patch.object(transcription, "_authenticate"),
            patch("suite.meet.transcription.client.authorize_manifest", return_value={"segments": []}),
        ):
            claimed = transcription.claim("worker-a")
            self.assertEqual(claimed["job"], job.name)
            self.assertEqual(claimed["hints"], make_hints("Test", []))
            self.assertIsNone(transcription.claim("worker-b")["job"])
            with self.assertRaises(frappe.PermissionError):
                transcription.heartbeat(job.name, "wrong-token", "worker-a")
            with self.assertRaises(frappe.PermissionError):
                transcription.complete(job.name, claimed["lease_token"], "worker-b", [])
            job.reload()
            self.assertEqual(job.model_configuration, json.dumps(MODEL))

    def test_transient_failures_have_exactly_three_retries(self):
        job = self.job("Processing")
        for expected_attempt in (1, 2, 3):
            result = transcription._failure(job, "source_unavailable", True)
            self.assertEqual(result["status"], "Queued")
            self.assertEqual(job.attempts, expected_attempt)
            job.status = "Processing"
        result = transcription._failure(job, "source_unavailable", True)
        self.assertEqual(result["status"], "Failed")
        self.assertTrue(job.notification_pending)
        self.assertFalse(job.artifact)

    def test_failed_remaining_sources_do_not_publish_an_empty_partial_transcript(self):
        job = self.job("Processing")
        source = {
            "source_id": "silence",
            "speaker_id": "speaker-a",
            "speaker_name": "Anita",
            "start_ms": 0,
            "end_ms": 1000,
        }
        job.completed_segments = json.dumps([{**source, "text": ""}])
        job.manifest = json.dumps(
            {
                "segments": [source, {**source, "source_id": "lost", "start_ms": 1000, "end_ms": 2000}],
                "gaps": [],
            }
        )
        with patch.object(transcription, "_publish") as publish:
            result = transcription._failure(job, "source_integrity", False)
        self.assertEqual(result["status"], "Failed")
        publish.assert_not_called()
        self.assertFalse(job.artifact)

    def test_deleted_result_revokes_worker_lease(self):
        job = self.job("Deleted")
        job.lease_worker = "worker"
        job.lease_token_hash = hashlib.sha256(b"old-token").hexdigest()
        job.lease_expires_at = now_datetime() + timedelta(seconds=60)
        with self.assertRaises(frappe.PermissionError):
            transcription._lease(job, "old-token", "worker")

    def test_transcript_only_capture_publishes_once_for_owner_and_purges_source(self):
        from suite.drive.api.permissions import get_user_access_for_user
        from suite.drive.utils.files import FileManager
        from suite.meet.api.recording import get_state, stop
        from suite.meet.transcription.capture import reconcile_capture

        config = {
            "recorder_server_url": "http://localhost:3999",
            "sfu_server_url": "http://localhost:3998",
            "recorder_secret": "recorder-test-secret",
            "sfu_secret": "sfu-test-secret",
            "transcription_enabled": True,
            "transcription_worker_secret": "a" * 40,
            "recording_fixture_mode": True,
        }
        frappe.db.set_single_value("Meet Settings", "enable_recording", 1)
        frappe.clear_cache(doctype="Meet Settings")
        with (
            patch.dict(frappe.conf, config),
            patch("suite.meet.transcription.client.recorder") as recorder,
            patch("suite.meet.transcription.client.sfu", return_value={"state": "capturing"}),
        ):
            recording = start(self.room.name, "6694472d-a129-4777-8e72-8aa8f3bbac80", False, True)
            state = get_state(self.room.name)
            self.assertFalse(state.video_enabled)
            self.assertTrue(state.transcription_enabled)
            self.assertEqual(state.status, "Recording")
            stopped = stop(self.room.name)
            self.assertEqual(stopped["status"], "Stopping")
            job = frappe.get_doc("Meet Transcription Job", {"capture": recording["name"]})
            self.jobs.append(job.name)
            manifest = {
                "capture": job.capture,
                "site": frappe.local.site,
                "room": self.room.name,
                "state": "complete",
                "speech_context": {"vocabulary_version": "frappe-v1", "title": "Frozen room title"},
                "participant_names": ["Silent observer", "Late participant"],
                "ended_at": now_datetime().isoformat(),
                "segments": [
                    {
                        "source_id": "speech-1",
                        "speaker_id": "speaker-a",
                        "speaker_name": "Anita",
                        "start_ms": 1000,
                        "end_ms": 3000,
                        "size": 96000,
                        "sha256": "a" * 64,
                        "sample_rate": 24000,
                    }
                ],
                "gaps": [],
            }
            recorder.return_value = manifest
            reconcile_capture(job)
            self.assertEqual(job.status, "Queued")
            hints = json.loads(job.recognition_hints)
            self.assertEqual(hints["title"], "Frozen room title")
            self.assertEqual(hints["participant_names"], ["Silent observer", "Late participant", "Anita"])
            self.assertIsNone(get_state(self.room.name))
            with patch.object(transcription, "_authenticate"):
                claimed = transcription.claim("worker")
                result = {
                    "source_id": "speech-1",
                    "speaker_id": "speaker-a",
                    "speaker_name": "Anita",
                    "start_ms": 1000,
                    "end_ms": 3000,
                    "text": "कल Atlas signup की क़ीमत confirm करेंगे।",
                }
                ready = transcription.complete(
                    job.name, claimed["lease_token"], "worker", [result], processed_source_ids=["speech-1"]
                )
                duplicate = transcription.complete(
                    job.name, claimed["lease_token"], "worker", [result], processed_source_ids=["speech-1"]
                )
            self.assertEqual(ready["artifact"], duplicate["artifact"])
            artifact = frappe.get_doc("File", ready["artifact"])
            self.assertEqual(artifact.file_name, "Original Transcript.txt")
            with FileManager().get_file(artifact) as content:
                self.assertEqual(
                    content.read().decode("utf-8"),
                    "Transcript\n\n[00:00:01 - 00:00:03] Anita: कल Atlas signup की क़ीमत confirm करेंगे।\n",
                )
            self.assertEqual(artifact.owner, self.owner)
            self.assertTrue(get_user_access_for_user(artifact, self.owner)["read"])
            self.assertFalse(get_user_access_for_user(artifact, self.attendee)["read"])
            self.assertFalse(
                frappe.db.exists("File", {"folder": artifact.folder, "file_name": "Recording.mp4"})
            )
            artifact.file_url = "/different-content.txt"
            with self.assertRaises(frappe.PermissionError):
                artifact.save()
            artifact.reload()
            from suite.drive.api.files import remove_or_restore

            remove_or_restore([artifact.name])
            self.assertEqual(frappe.db.get_value("Meet Transcription Job", job.name, "status"), "Ready")
            remove_or_restore([artifact.name])
            # Ready delivery survives recorder failure; cleanup remains retryable.
            with (
                patch("frappe.sendmail") as notify,
                patch("suite.meet.transcription.client.recorder", side_effect=ConnectionError("offline")),
            ):
                transcription.maintenance()
                owner_messages = [
                    call for call in notify.call_args_list if call.kwargs.get("recipients") == [self.owner]
                ]
                self.assertEqual(len(owner_messages), 1)
            job.reload()
            self.assertTrue(job.notification_sent_at)
            self.assertFalse(job.source_deleted)
            with patch("frappe.sendmail") as notify:
                transcription.maintenance()
                notify.assert_not_called()
            job.reload()
            self.assertTrue(job.source_deleted)
            self.assertTrue(job.notification_sent_at)
            self.assertEqual(recorder.call_args.args[2], "delete")
            artifact.reload()
            artifact.permanent_delete()
            transcription.maintenance()
            self.assertFalse(frappe.db.exists("Meet Transcription Job", job.name))
            with patch.object(transcription, "_authenticate"), self.assertRaises(frappe.DoesNotExistError):
                transcription.complete(job.name, claimed["lease_token"], "worker", [result])
            self.assertEqual(frappe.db.get_value("File", artifact.name, "status"), "Removed")
            frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
            frappe.clear_cache(doctype="Meet Settings")
            frappe.db.delete("Meet Recording", {"name": recording["name"]})

    def test_audio_remains_visible_and_stoppable_when_video_fails(self):
        from suite.meet.api.recording import get_state, stop

        config = {
            "recorder_server_url": "http://localhost:3999",
            "sfu_server_url": "http://localhost:3998",
            "recorder_secret": "recorder-test-secret",
            "sfu_secret": "sfu-test-secret",
            "transcription_enabled": True,
            "transcription_worker_secret": "a" * 40,
            "recording_fixture_mode": True,
        }
        frappe.db.set_single_value("Meet Settings", "enable_recording", 1)
        frappe.clear_cache(doctype="Meet Settings")
        with (
            patch.dict(frappe.conf, config),
            patch("suite.meet.transcription.client.recorder"),
            patch("suite.meet.transcription.client.sfu", return_value={"state": "capturing"}) as sfu,
        ):
            from suite.meet.recording.recorder_client import RecorderOutcome

            client = Mock()
            client.reserve.return_value = RecorderOutcome("rejected", reason_code="capacity")
            with (
                patch("suite.meet.api.recording._fixture_enabled", return_value=False),
                patch("suite.meet.api.recording._client", return_value=client),
            ):
                recording = start(self.room.name, "6ac376c4-54d9-4297-b82e-c363c3b882a4", True, True)
            self.assertEqual(recording["status"], "Recording")
            before = get_state(self.room.name)
            self.assertTrue(before.started_at)

            state = get_state(self.room.name)
            self.assertEqual(state.status, "Recording")
            self.assertEqual(state.video_capture_state, "failed")
            self.assertEqual(state.transcription_capture_state, "capturing")
            self.assertTrue(self.room.has_active_recording())
            with self.assertRaises(frappe.ValidationError):
                self.room.enable_e2ee()
            frappe.db.commit()  # End the rejected policy request and release its lock.
            self.assertEqual(
                start(self.room.name, "83f02efe-9b50-4fcf-8665-a267f9345876", False, True)["name"],
                recording["name"],
            )
            frappe.db.commit()  # Finish the idempotent start request.
            stop(self.room.name)
            state = get_state(self.room.name)
            self.assertEqual(state.status, "Stopping")
            self.assertGreater(state.state_revision, before.state_revision)
            self.assertEqual(sfu.call_args.args[2], "stop")

    def test_lost_sfu_marks_uncertainty_across_independent_speakers(self):
        import requests

        from suite.meet.transcription.capture import reconcile_capture

        job = self.job("Capturing")
        job.capture_started_at = now_datetime() - timedelta(seconds=110)
        job.source_bytes = 192000
        source = {
            "source_id": "speaker-a-source",
            "speaker_id": "speaker-a",
            "speaker_name": "Anita",
            "start_ms": 98000,
            "end_ms": 100000,
            "size": 96000,
            "sha256": "a" * 64,
            "sample_rate": 24000,
        }
        second = {
            **source,
            "source_id": "speaker-b-source",
            "speaker_id": "speaker-b",
            "speaker_name": "Vikram",
            "start_ms": 107000,
            "end_ms": 109000,
        }
        manifest = {
            "capture": job.capture,
            "site": frappe.local.site,
            "room": self.room.name,
            "state": "capturing",
            "segments": [source, second],
            "gaps": [],
        }
        response = requests.Response()
        response.status_code = 404
        with (
            patch("suite.meet.transcription.client.sfu", side_effect=requests.HTTPError(response=response)),
            patch(
                "suite.meet.transcription.client.recorder",
                side_effect=[manifest, {}, {**manifest, "state": "partial"}],
            ) as recorder,
        ):
            reconcile_capture(job)
        gap = recorder.call_args_list[1].kwargs["body"]["gaps"][0]
        self.assertEqual(gap["start_ms"], 0)
        self.assertGreaterEqual(gap["end_ms"], 110000)
        self.assertLess(gap["end_ms"], 112000)
        self.assertEqual(job.status, "Queued")
        self.assertEqual(len(json.loads(job.manifest)["segments"]), 2)

    def test_missing_recorder_source_fails_without_a_false_silence_artifact(self):
        import requests

        from suite.meet.transcription.capture import reconcile_capture

        job = self.job("Capturing")
        response = requests.Response()
        response.status_code = 404
        with patch(
            "suite.meet.transcription.client.recorder", side_effect=requests.HTTPError(response=response)
        ):
            reconcile_capture(job)
        self.assertEqual(job.status, "Failed")
        self.assertEqual(job.failure_code, "source_missing")
        self.assertTrue(job.source_deleted)
        self.assertFalse(job.artifact)
        self.assertTrue(job.notification_pending)

    def test_deleted_transcript_does_not_remove_processing_video_metadata(self):
        from suite.drive.utils import get_user_folder

        recording = frappe.get_doc(
            {
                "doctype": "Meet Recording",
                "meet_room": self.room.name,
                "room_owner": self.owner,
                "initiated_by": self.owner,
                "status": "Starting",
                "video_enabled": 1,
                "transcription_enabled": 1,
                "estimated_seconds": 3600,
                "estimated_bytes": 1000,
                "budget_bytes": 1000,
                "recorder_job_id": frappe.generate_hash(),
                "request_id": frappe.generate_hash(),
                "drive_home_folder": get_user_folder(self.owner).name,
            }
        ).insert(ignore_permissions=True)
        frappe.db.set_value("Meet Recording", recording.name, "status", "Processing")
        job = self.job("Deleted")
        job.capture = recording.name
        job.source_deleted = 1
        job.save(ignore_permissions=True)
        transcription.maintenance()
        self.assertFalse(frappe.db.exists("Meet Transcription Job", job.name))
        self.assertEqual(frappe.db.get_value("Meet Recording", recording.name, "status"), "Processing")

    def test_all_lost_capture_is_failure_instead_of_empty_partial_file(self):
        job = self.job()
        job.manifest = json.dumps(
            {"segments": [], "gaps": [{"start_ms": 0, "end_ms": 1000, "reason": "source_interrupted"}]}
        )
        job.save(ignore_permissions=True)
        with (
            patch.object(transcription, "_authenticate"),
            patch("suite.meet.transcription.client.authorize_manifest", return_value={"segments": []}),
        ):
            claim = transcription.claim("worker")
            result = transcription.complete(
                job.name, claim["lease_token"], "worker", [], partial=True, processed_source_ids=[]
            )
        self.assertEqual(result["status"], "Failed")
        job.reload()
        self.assertFalse(job.artifact)
        self.assertEqual(job.failure_code, "no_usable_segments")
