import json
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

import jwt
import requests

from suite.meet.recording.recorder_client import RecorderClient

PUBLIC_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
    "y": "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
}


def response(status, body=None, content_type="application/json"):
    result = requests.Response()
    result.status_code = status
    result.headers["Content-Type"] = content_type
    result._content = b"" if body is None else json.dumps(body).encode()
    result.raw = BytesIO(result._content)
    return result


class TestRecorderClient(unittest.TestCase):
    def setUp(self):
        self.session = Mock(spec=requests.Session)
        self.client = RecorderClient(
            base_url="http://recorder.test",
            secret="a-long-enough-test-secret-for-hs256",
            site="site.test",
            origin="http://site.test",
            allow_http=True,
            session=self.session,
        )
        self.arguments = {
            "room": "room",
            "recording": "recording",
            "job": "job",
            "limits": {"x": 1},
        }

    @patch("suite.meet.recording.recorder_client.time.time", return_value=100)
    def test_accepted_response_and_exact_command_claims(self, _time):
        self.session.request.return_value = response(
            202,
            {
                "protocol_version": 1,
                "status": "accepted",
                "job": "job",
                "accepted_at": "2026-07-31T10:11:12.123Z",
                "public_jwk": PUBLIC_JWK,
                "endpoint_generation": 0,
                "state": "reserved",
                "event_sequence": 1,
            },
        )

        outcome = self.client.reserve(**self.arguments, recording_allowed=True)

        self.assertEqual(outcome.outcome, "accepted")
        self.assertEqual(outcome.accepted_at.isoformat(), "2026-07-31T10:11:12.123000+00:00")
        self.assertEqual(outcome.event_sequence, 1)
        self.assertEqual(outcome.endpoint_generation, 0)
        call = self.session.request.call_args
        token = call.kwargs["headers"]["Authorization"].removeprefix("Bearer ")
        claims = jwt.decode(
            token,
            "a-long-enough-test-secret-for-hs256",
            algorithms=["HS256"],
            audience="meet-recorder-control",
            options={"verify_exp": False},
        )
        self.assertEqual(
            set(claims),
            {
                "iss",
                "aud",
                "site",
                "origin",
                "room",
                "recording",
                "job",
                "operation",
                "limits",
                "policy",
                "jti",
                "iat",
                "exp",
                "protocol_version",
            },
        )
        self.assertEqual(claims["protocol_version"], 1)
        self.assertEqual(claims["policy"], {"recording_allowed": True})
        self.assertEqual(call.kwargs["json"], {"protocol_version": 1, "job": "job"})
        self.assertEqual(claims["operation"], "reserve")
        self.assertEqual(call.kwargs["timeout"], (2, 5))
        self.assertFalse(call.kwargs["allow_redirects"])

    def test_explicit_rejection_is_bounded(self):
        self.session.request.return_value = response(
            429, {"protocol_version": 1, "status": "rejected", "job": "job", "reason_code": "capacity"}
        )
        self.assertEqual(self.client.reserve(**self.arguments, recording_allowed=True).outcome, "rejected")

        self.session.request.return_value = response(
            507, {"protocol_version": 1, "status": "rejected", "job": "job", "reason_code": "storage"}
        )
        outcome = self.client.reserve(**self.arguments, recording_allowed=True)
        self.assertEqual(outcome.outcome, "rejected")
        self.assertEqual(outcome.reason_code, "storage")

        self.session.request.return_value = response(
            429, {"protocol_version": 1, "status": "rejected", "job": "job", "reason_code": "anything"}
        )
        self.assertEqual(
            self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
        )

    def test_interrupted_response_preserves_unrecovered_timestamps(self):
        self.session.request.return_value = response(
            200,
            {
                "protocol_version": 1,
                "status": "accepted",
                "job": "job",
                "accepted_at": "2026-07-31T10:11:12.123Z",
                "public_jwk": PUBLIC_JWK,
                "endpoint_generation": 1,
                "state": "interrupted",
                "event_sequence": 6,
                "replacement_ready_at": "2026-07-31T10:12:10.000Z",
                "interruption": {
                    "id": "4cad3218-a956-4dec-a522-18f0dd3b75a2",
                    "interrupted_at": "2026-07-31T10:12:00.000Z",
                    "deadline": "2026-07-31T10:13:00.000Z",
                    "omission_started_at": "2026-07-31T10:11:30.000Z",
                    "resumed_capture_started_at": None,
                    "recovered_at": None,
                },
            },
        )

        outcome = self.client.query(**self.arguments)

        self.assertEqual(outcome.outcome, "accepted")
        self.assertIsNone(outcome.interruption["resumed_capture_started_at"])
        self.assertIsNone(outcome.interruption["recovered_at"])
        self.assertEqual(outcome.endpoint_generation, 1)
        self.assertEqual(outcome.replacement_ready_at.isoformat(), "2026-07-31T10:12:10+00:00")

    def test_endpoint_generation_must_be_a_nonnegative_integer(self):
        body = {
            "protocol_version": 1,
            "status": "accepted",
            "job": "job",
            "accepted_at": "2026-07-31T10:11:12.123Z",
            "public_jwk": PUBLIC_JWK,
            "state": "reserved",
            "event_sequence": 1,
        }
        for generation in (-1, True, "0", None):
            with self.subTest(generation=generation):
                self.session.request.return_value = response(202, {**body, "endpoint_generation": generation})
                self.assertEqual(
                    self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
                )

    def test_timeout_invalid_json_wrong_job_and_5xx_are_indeterminate(self):
        cases = [
            requests.Timeout(),
            response(202, {"status": "accepted", "job": "other"}),
            response(202, "not-an-object"),
            response(500, {"status": "error", "job": "job"}),
        ]
        for result in cases:
            with self.subTest(result=result):
                self.session.request.side_effect = result if isinstance(result, Exception) else None
                self.session.request.return_value = None if isinstance(result, Exception) else result
                self.assertEqual(
                    self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
                )

    def test_rejects_missing_wrong_and_unknown_response_protocol_fields(self):
        accepted = {
            "protocol_version": 1,
            "status": "accepted",
            "job": "job",
            "accepted_at": "2026-07-31T10:11:12.123Z",
            "public_jwk": PUBLIC_JWK,
            "endpoint_generation": 0,
            "state": "reserved",
            "event_sequence": 1,
        }
        for body in (
            {key: value for key, value in accepted.items() if key != "protocol_version"},
            {**accepted, "protocol_version": 2},
            {**accepted, "extra": True},
        ):
            with self.subTest(body=body):
                self.session.request.return_value = response(202, body)
                self.assertEqual(
                    self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
                )

    def test_unhashable_state_and_reason_values_are_indeterminate(self):
        accepted = {
            "protocol_version": 1,
            "status": "accepted",
            "job": "job",
            "accepted_at": "2026-07-31T10:11:12.123Z",
            "public_jwk": PUBLIC_JWK,
            "endpoint_generation": 0,
            "state": "reserved",
            "event_sequence": 1,
        }
        for body in ({**accepted, "state": []}, {**accepted, "reason_code": {}}):
            with self.subTest(body=body):
                self.session.request.return_value = response(202, body)
                self.assertEqual(
                    self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
                )

    def test_timestamp_requires_exact_millisecond_precision(self):
        base = {
            "protocol_version": 1,
            "status": "accepted",
            "job": "job",
            "public_jwk": PUBLIC_JWK,
            "endpoint_generation": 0,
            "state": "reserved",
            "event_sequence": 1,
        }
        for timestamp in (
            "2026-07-31T10:11:12Z",
            "2026-07-31T10:11:12.12Z",
            "2026-07-31T10:11:12.1234Z",
            "2026-07-31T10:11:12.123+00:00",
        ):
            with self.subTest(timestamp=timestamp):
                self.session.request.return_value = response(202, {**base, "accepted_at": timestamp})
                self.assertEqual(
                    self.client.reserve(**self.arguments, recording_allowed=True).outcome, "indeterminate"
                )

    def test_rejects_untrusted_urls(self):
        for url in (
            "http://recorder.test",
            "https://user@recorder.test",
            "https://recorder.test/path",
            "https://recorder.test?x=1",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                RecorderClient(base_url=url, secret="x", site="x", origin="https://site.test")

    def test_allows_production_http_only_for_loopback_recorder(self):
        client = RecorderClient(
            base_url="http://127.0.0.1:3010",
            secret="x",
            site="x",
            origin="https://site.test",
        )
        self.assertEqual(client.base_url, "http://127.0.0.1:3010")

        with self.assertRaises(ValueError):
            RecorderClient(
                base_url="http://recorder.test:3010",
                secret="x",
                site="x",
                origin="https://site.test",
            )

    def test_grant_delivery_requires_explicit_success(self):
        self.session.request.return_value = response(200, {"protocol_version": 1, "status": "accepted"})
        self.assertTrue(self.client.deliver_grant(**self.arguments, grant="token", endpoint_generation=2))
        self.assertEqual(
            self.session.request.call_args.args[:2], ("POST", "http://recorder.test/v1/recordings/job/grant")
        )
        self.assertEqual(
            self.session.request.call_args.kwargs["json"],
            {"protocol_version": 1, "grant": "token", "endpoint_generation": 2},
        )

        self.session.request.return_value = response(500, {"status": "error"})
        self.assertFalse(self.client.deliver_grant(**self.arguments, grant="token", endpoint_generation=2))

    def test_stop_requires_exact_acknowledgement_and_sends_operation_id(self):
        self.session.request.return_value = response(
            202,
            {"protocol_version": 1, "status": "accepted", "job": "job", "operation_id": "stop-1"},
        )
        self.assertTrue(self.client.stop(**self.arguments, operation_id="stop-1"))
        self.assertEqual(
            self.session.request.call_args.kwargs["json"],
            {"protocol_version": 1, "job": "job", "operation_id": "stop-1"},
        )

        for result in (
            requests.Timeout(),
            response(202, {"status": "accepted", "job": "job", "operation_id": "other"}),
            response(204),
        ):
            with self.subTest(result=result):
                self.session.request.side_effect = result if isinstance(result, Exception) else None
                self.session.request.return_value = None if isinstance(result, Exception) else result
                self.assertFalse(self.client.stop(**self.arguments, operation_id="stop-1"))
