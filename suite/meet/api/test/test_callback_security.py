# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import hashlib
import time
import uuid
from unittest.mock import Mock, patch

import frappe
import jwt
from frappe.tests import IntegrationTestCase

from suite.meet.api.recording import (
    recorder_complete_upload,
    recorder_failed,
    recorder_interrupted,
    recorder_recovered,
    recorder_stopped,
    recorder_upload_chunk,
    start,
    stop,
)
from suite.meet.recording.callback_auth import (
    CALLBACK_AUDIENCE,
    CALLBACK_TYPE,
    authenticate_callback,
)
from suite.meet.recording.ingest import CHUNK_SIZE, _upload_path, append_chunk, begin_upload


class IntegrationTestRecordingCallbackSecurity(IntegrationTestCase):
    def setUp(self):
        self.owner = "callback-owner@example.com"
        if not frappe.db.exists("User", self.owner):
            frappe.get_doc(
                {
                    "doctype": "User",
                    "email": self.owner,
                    "first_name": "Callback Owner",
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
        started = start(self.room.name, str(uuid.uuid4()))
        self.recording = frappe.get_doc("Meet Recording", started["name"])
        self.original_request = getattr(frappe.local, "request", None)

    def tearDown(self):
        if self.original_request is None:
            if hasattr(frappe.local, "request"):
                del frappe.local.request
        else:
            frappe.local.request = self.original_request
        frappe.set_user("Administrator")
        frappe.db.delete("Meet Recording", {"meet_room": self.room.name})
        frappe.delete_doc("Meet Room", self.room.name, force=True, ignore_permissions=True)
        frappe.db.set_single_value("Meet Settings", "enable_recording", 0)
        frappe.clear_cache(doctype="Meet Settings")
        frappe.conf.pop("recording_fixture_mode", None)

    def test_callback_token_rejects_every_wrong_binding(self):
        now = int(time.time())
        valid = self._claims(now)
        cases = {
            "audience": {"aud": "other-audience"},
            "audience-list": {"aud": [CALLBACK_AUDIENCE, "other-audience"]},
            "issuer": {"iss": "meet-recorder:other-site"},
            "site": {"site": "other-site"},
            "recording": {"recording": "other-recording"},
            "job": {"job": "other-job"},
            "operation": {"operation": "failed"},
            "operation-id": {"operation_id": "3"},
            "empty-jti": {"jti": ""},
            "non-string-jti": {"jti": 1},
            "future-issued": {"iat": now + 6, "exp": now + 36},
            "too-old": {"iat": now - 36, "exp": now - 6},
            "wrong-lifetime": {"exp": now + 31},
        }
        for label, changes in cases.items():
            with self.subTest(label=label):
                claims = {**valid, **changes}
                self._set_token(claims)
                with self.assertRaises(frappe.AuthenticationError):
                    self._authenticate(now)

        for key in valid:
            with self.subTest(missing=key):
                claims = dict(valid)
                claims.pop(key)
                self._set_token(claims)
                with self.assertRaises(frappe.AuthenticationError):
                    self._authenticate(now)

        self._set_token({**valid, "extra": True})
        with self.assertRaises(frappe.AuthenticationError):
            self._authenticate(now)

    def test_callback_header_and_replay_contract(self):
        now = int(time.time())
        for authorization in ("", "Bearer ", "Basic token", "Bearer malformed"):
            with self.subTest(authorization=authorization):
                frappe.local.request = Mock(headers={"X-Meet-Recorder-Authorization": authorization})
                with self.assertRaises(frappe.AuthenticationError):
                    self._authenticate(now)

        for headers in (
            {"typ": "wrong", "alg": "HS256"},
            {"typ": CALLBACK_TYPE, "alg": "HS256", "kid": "unexpected"},
        ):
            with self.subTest(headers=headers):
                self._set_token(self._claims(now), headers=headers)
                with self.assertRaises(frappe.AuthenticationError):
                    self._authenticate(now)

        self._set_token(self._claims(now))
        first = self._authenticate(now)
        second = self._authenticate(now)
        self.assertEqual(first, second)

    def test_mutating_callbacks_are_post_only(self):
        for callback in (
            recorder_interrupted,
            recorder_recovered,
            recorder_stopped,
            recorder_upload_chunk,
            recorder_complete_upload,
            recorder_failed,
        ):
            with self.subTest(callback=callback.__name__):
                self.assertEqual(
                    frappe.allowed_http_methods_for_whitelisted_func[callback],
                    ("POST",),
                )

    def test_upload_endpoint_rejects_type_and_size_before_reading_body(self):
        digest = hashlib.sha256(b"chunk").hexdigest()
        with patch("suite.meet.api.recording.authenticate_callback"):
            for content_type in (None, "application/json", "application/octet-stream; charset=utf-8"):
                with self.subTest(content_type=content_type):
                    frappe.local.request = Mock(content_type=content_type, content_length=5)
                    with self.assertRaises(frappe.ValidationError):
                        recorder_upload_chunk(self.recording.name, self.recording.recorder_job_id, 0, digest)

            request = Mock(content_type="application/octet-stream", content_length=CHUNK_SIZE + 1)
            frappe.local.request = request
            with self.assertRaises(frappe.ValidationError):
                recorder_upload_chunk(self.recording.name, self.recording.recorder_job_id, 0, digest)
            request.get_data.assert_not_called()

            request = Mock(content_type="application/octet-stream", content_length=5)
            request.get_data.return_value = b"chunk"
            frappe.local.request = request
            with patch("suite.meet.api.recording.append_chunk", return_value={"offset": 5}) as append:
                self.assertEqual(
                    recorder_upload_chunk(self.recording.name, self.recording.recorder_job_id, 0, digest),
                    {"offset": 5},
                )
            append.assert_called_once_with(
                self.recording.name,
                offset=0,
                chunk=b"chunk",
                chunk_sha256=digest,
            )

    def test_stopped_callback_requires_timezone_bearing_end_time(self):
        with patch("suite.meet.api.recording.authenticate_callback"):
            with self.assertRaisesRegex(frappe.ValidationError, "requires an end time"):
                recorder_stopped(
                    self.recording.name,
                    self.recording.recorder_job_id,
                    2,
                    1,
                    "a" * 64,
                    1000,
                    "",
                    "host_stop",
                )

    def test_upload_chunk_boundary_failures_do_not_mutate_state(self):
        stop(self.room.name)
        content = b"abcdefgh"
        begin_upload(
            self.recording.name,
            event_sequence=2,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            duration_ms=1000,
        )
        self.recording.reload()
        path = _upload_path(self.recording.upload_id)
        try:
            invalid = (
                {"offset": 0, "chunk": b"", "chunk_sha256": hashlib.sha256(b"").hexdigest()},
                {"offset": 0, "chunk": bytearray(b"a"), "chunk_sha256": hashlib.sha256(b"a").hexdigest()},
                {"offset": 0, "chunk": b"a", "chunk_sha256": None},
                {"offset": 0, "chunk": b"a", "chunk_sha256": "a" * 64},
                {"offset": -1, "chunk": b"a", "chunk_sha256": hashlib.sha256(b"a").hexdigest()},
                {"offset": 8, "chunk": b"a", "chunk_sha256": hashlib.sha256(b"a").hexdigest()},
                {"offset": 2**63, "chunk": b"a", "chunk_sha256": hashlib.sha256(b"a").hexdigest()},
                {"offset": 0, "chunk": b"x" * (CHUNK_SIZE + 1), "chunk_sha256": "a" * 64},
            )
            for values in invalid:
                with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
                    append_chunk(self.recording.name, **values)
                self.assertEqual(
                    frappe.db.get_value("Meet Recording", self.recording.name, "upload_offset"),
                    0,
                )
                self.assertFalse(path.exists())
        finally:
            path.unlink(missing_ok=True)

    def _claims(self, now: int) -> dict:
        return {
            "iss": f"meet-recorder:{frappe.local.site}",
            "aud": CALLBACK_AUDIENCE,
            "site": frappe.local.site,
            "recording": self.recording.name,
            "job": self.recording.recorder_job_id,
            "operation": "stopped",
            "operation_id": "2",
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + 30,
        }

    def _set_token(self, claims: dict, headers: dict | None = None):
        token = jwt.encode(
            claims,
            frappe.conf.recorder_secret,
            algorithm="HS256",
            headers=headers or {"typ": CALLBACK_TYPE},
        )
        frappe.local.request = Mock(headers={"X-Meet-Recorder-Authorization": f"Bearer {token}"})

    def _authenticate(self, now: int):
        return authenticate_callback(
            recording=self.recording.name,
            job=self.recording.recorder_job_id,
            operation="stopped",
            operation_id="2",
            now=now,
        )
