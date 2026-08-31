from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock

import frappe
import requests

from suite.meet.api.recording import (
    END_REASON_CODES,
    GAP_REASON_CODES,
    INTERRUPTION_REASON_CODES,
    STARTUP_MILESTONES,
    _startup_timestamp,
)
from suite.meet.recording.callback_auth import (
    CALLBACK_BODY_KEYS,
    FAILURE_REASON_CODES,
    _validate_callback_payload,
    valid_callback_claims,
    valid_upload_query,
)
from suite.meet.recording.ingest import _callback_datetime
from suite.meet.recording.recorder_client import (
    COMMAND_STATES,
    HEALTH_REASON_CODES,
    REJECTION_REASONS,
    RecorderClient,
    _utc_datetime,
)

CONTRACT = json.loads((Path(__file__).parent / "contracts" / "v1.json").read_text())


class TestRecordingProtocolContract(TestCase):
    def test_shared_timestamp_vectors_use_the_production_parser(self):
        for value in CONTRACT["vectors"]["timestamps"]["accepted"]:
            self.assertEqual(_utc_datetime(value).isoformat(timespec="milliseconds"), value[:-1] + "+00:00")
            self.assertEqual(
                _startup_timestamp(value).isoformat(timespec="milliseconds"), value[:-1] + "+00:00"
            )
            self.assertEqual(_callback_datetime(value).isoformat(timespec="milliseconds"), value[:-1])
        for value in CONTRACT["vectors"]["timestamps"]["rejected"]:
            with self.assertRaises((TypeError, ValueError)):
                _utc_datetime(value)
            with self.assertRaises(frappe.ValidationError):
                _startup_timestamp(value)
            with self.assertRaises(frappe.ValidationError):
                _callback_datetime(value)

    def test_finite_command_vocabularies_match_production(self):
        self.assertEqual(set(CONTRACT["vocabularies"]["command_states"]), COMMAND_STATES)
        self.assertEqual(set(CONTRACT["vocabularies"]["health_reason_codes"]), HEALTH_REASON_CODES)
        self.assertEqual(set(CONTRACT["vocabularies"]["command_rejection_reason_codes"]), REJECTION_REASONS)
        self.assertEqual(set(CONTRACT["vocabularies"]["startup_milestones"]), set(STARTUP_MILESTONES))
        self.assertEqual(
            set(CONTRACT["vocabularies"]["interruption_reason_codes"]), INTERRUPTION_REASON_CODES
        )
        self.assertEqual(set(CONTRACT["vocabularies"]["callback_failure_reason_codes"]), FAILURE_REASON_CODES)
        self.assertEqual(set(CONTRACT["vocabularies"]["end_reason_codes"]), END_REASON_CODES)
        self.assertEqual(set(CONTRACT["vocabularies"]["gap_reason_codes"]), GAP_REASON_CODES)
        self.assertEqual(CONTRACT["vectors"]["finite_values"], CONTRACT["vocabularies"])

    def test_shared_callback_claim_and_request_vectors_use_production_validators(self):
        claims = CONTRACT["vectors"]["callback_claims"]
        expected = {
            "site": "site.test",
            "recording": "recording-vector",
            "job": "job-vector",
            "operation": "stopped",
            "operation_id": "2",
            "protocol_version": 1,
            "now": 1700000000,
        }
        for value in claims["accepted"]:
            self.assertTrue(valid_callback_claims(value, **expected))
        for value in claims["rejected"]:
            self.assertFalse(valid_callback_claims(value, **expected))

        request_vectors = CONTRACT["vectors"]["callback_requests"]
        for value in request_vectors["accepted"]:
            self.assertEqual(set(value["body"]), CALLBACK_BODY_KEYS[value["operation"]])
            _validate_callback_payload(value["operation"], value["body"])
        for value in request_vectors["rejected"]:
            with self.assertRaises((frappe.AuthenticationError, ValueError)):
                if set(value["body"]) != CALLBACK_BODY_KEYS[value["operation"]]:
                    raise ValueError
                _validate_callback_payload(value["operation"], value["body"])

        accepted_by_operation = {value["operation"]: value["body"] for value in request_vectors["accepted"]}
        finite = CONTRACT["vectors"]["finite_values"]
        for milestone in finite["startup_milestones"]:
            _validate_callback_payload(
                "startup_progress",
                {**accepted_by_operation["startup_progress"], "milestone": milestone},
            )
        for reason_code in finite["interruption_reason_codes"]:
            _validate_callback_payload(
                "interrupted",
                {**accepted_by_operation["interrupted"], "reason_code": reason_code},
            )
        for reason_code in finite["callback_failure_reason_codes"]:
            _validate_callback_payload(
                "failed",
                {**accepted_by_operation["failed"], "reason_code": reason_code},
            )
        for reason_code in finite["end_reason_codes"]:
            _validate_callback_payload(
                "stopped",
                {**accepted_by_operation["stopped"], "end_reason_code": reason_code},
            )
        for reason_code in finite["gap_reason_codes"]:
            _validate_callback_payload(
                "stopped",
                {
                    **accepted_by_operation["stopped"],
                    "gaps": [
                        {
                            "started_at": "2026-08-30T11:59:00.000Z",
                            "ended_at": "2026-08-30T11:59:30.000Z",
                            "reason_code": reason_code,
                        }
                    ],
                },
            )

        upload_vectors = CONTRACT["vectors"]["callback_upload_queries"]
        for value in upload_vectors["accepted"]:
            self.assertTrue(
                valid_upload_query(
                    value,
                    content_type="application/octet-stream",
                    content_length=5,
                    body=b"chunk",
                )
            )
        for value in upload_vectors["rejected"]:
            self.assertFalse(
                valid_upload_query(
                    value,
                    content_type="application/octet-stream",
                    content_length=5,
                    body=b"chunk",
                )
            )

    def test_shared_command_response_vectors_use_the_production_parser(self):
        session = Mock(spec=requests.Session)
        client = RecorderClient(
            base_url="http://recorder.test",
            secret="a-long-enough-test-secret-for-hs256",
            site="site.test",
            origin="http://site.test",
            allow_http=True,
            session=session,
        )
        arguments = {
            "room": "room-vector",
            "recording": "recording-vector",
            "job": "job-vector",
            "limits": {"x": 1},
        }
        for value in CONTRACT["vectors"]["command_responses"]["accepted"]:
            session.request.return_value = _response(202, value)
            self.assertEqual(client.reserve(**arguments).outcome, "accepted")
        for value in CONTRACT["vectors"]["command_responses"]["rejected"]:
            session.request.return_value = _response(202, value)
            self.assertEqual(client.reserve(**arguments).outcome, "indeterminate")

        base = CONTRACT["vectors"]["command_responses"]["accepted"][0]
        for state in CONTRACT["vectors"]["finite_values"]["command_states"]:
            session.request.return_value = _response(202, {**base, "state": state})
            self.assertEqual(client.reserve(**arguments).state, state)
        for reason_code in CONTRACT["vectors"]["finite_values"]["health_reason_codes"]:
            session.request.return_value = _response(202, {**base, "reason_code": reason_code})
            self.assertEqual(client.reserve(**arguments).reason_code, reason_code)

        for value in CONTRACT["vectors"]["command_rejected_responses"]["accepted"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertEqual(client.reserve(**arguments).outcome, "rejected")
        for value in CONTRACT["vectors"]["command_rejected_responses"]["rejected"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertEqual(client.reserve(**arguments).outcome, "indeterminate")

        for value in CONTRACT["vectors"]["grant_responses"]["accepted"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertTrue(client.deliver_grant(**arguments, grant="grant", endpoint_generation=0))
        for value in CONTRACT["vectors"]["grant_responses"]["rejected"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertFalse(client.deliver_grant(**arguments, grant="grant", endpoint_generation=0))

        for value in CONTRACT["vectors"]["stop_responses"]["accepted"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertTrue(client.stop(**arguments, operation_id="stop-vector"))
        for value in CONTRACT["vectors"]["stop_responses"]["rejected"]:
            session.request.return_value = _response(value["http_status"], value["body"])
            self.assertFalse(client.stop(**arguments, operation_id="stop-vector"))

    def test_startup_mapping_covers_every_recorder_milestone(self):
        mapping = CONTRACT["mappings"]["startup_milestone_to_frappe_state"]
        self.assertEqual(set(mapping), set(CONTRACT["vocabularies"]["startup_milestones"]))
        self.assertEqual(set(mapping.values()), {"Starting", "Recording"})

    def test_first_version_accepts_no_unversioned_predecessor(self):
        self.assertEqual(CONTRACT["protocol_version"], 1)
        self.assertEqual(CONTRACT["accepted_protocol_versions"], [1])
        self.assertEqual(CONTRACT["vectors"]["protocol_versions"]["accepted"], [1])


def _response(status: int, body) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response.headers["Content-Type"] = "application/json"
    response._content = json.dumps(body).encode()
    response.raw = BytesIO(response._content)
    return response
