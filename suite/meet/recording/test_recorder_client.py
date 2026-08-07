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
        self.arguments = {"room": "room", "recording": "recording", "job": "job", "limits": {"x": 1}}

    @patch("suite.meet.recording.recorder_client.time.time", return_value=100)
    def test_accepted_response_and_exact_command_claims(self, _time):
        self.session.request.return_value = response(
            202,
            {
                "status": "accepted",
                "job": "job",
                "accepted_at": "2026-07-31T10:11:12.123Z",
                "public_jwk": PUBLIC_JWK,
                "state": "reserved",
            },
        )

        outcome = self.client.reserve(**self.arguments)

        self.assertEqual(outcome.outcome, "accepted")
        self.assertEqual(outcome.accepted_at.isoformat(), "2026-07-31T10:11:12.123000+00:00")
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
                "jti",
                "iat",
                "exp",
            },
        )
        self.assertEqual(claims["operation"], "reserve")
        self.assertEqual(call.kwargs["timeout"], (2, 5))
        self.assertFalse(call.kwargs["allow_redirects"])

    def test_explicit_rejection_is_bounded(self):
        self.session.request.return_value = response(
            429, {"status": "rejected", "job": "job", "reason": "capacity"}
        )
        self.assertEqual(self.client.reserve(**self.arguments).outcome, "rejected")

        self.session.request.return_value = response(
            429, {"status": "rejected", "job": "job", "reason": "anything"}
        )
        self.assertEqual(self.client.reserve(**self.arguments).outcome, "indeterminate")

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
                self.assertEqual(self.client.reserve(**self.arguments).outcome, "indeterminate")

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
        self.session.request.return_value = response(200, {"status": "accepted"})
        self.assertTrue(self.client.deliver_grant(**self.arguments, grant="token"))
        self.assertEqual(
            self.session.request.call_args.args[:2], ("POST", "http://recorder.test/v1/recordings/job/grant")
        )

        self.session.request.return_value = response(500, {"status": "error"})
        self.assertFalse(self.client.deliver_grant(**self.arguments, grant="token"))

    def test_stop_requires_exact_acknowledgement_and_sends_operation_id(self):
        self.session.request.return_value = response(
            202, {"status": "accepted", "job": "job", "operation_id": "stop-1"}
        )
        self.assertTrue(self.client.stop(**self.arguments, operation_id="stop-1"))
        self.assertEqual(
            self.session.request.call_args.kwargs["json"], {"job": "job", "operation_id": "stop-1"}
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
