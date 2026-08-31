from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import urlsplit

import jwt
import requests
from requests.adapters import HTTPAdapter

from suite.meet.recording.grants import normalize_public_jwk

COMMAND_AUDIENCE = "meet-recorder-control"
COMMAND_TYPE = "meet-recorder-command+jwt"
PROTOCOL_VERSION = 1
MAX_RESPONSE_BYTES = 16 * 1024
TIMEOUT = (2, 5)
REJECTION_REASONS = {"capacity", "storage", "policy", "invalid_job"}
REJECTION_STATUSES = {"capacity": 429, "storage": 507, "policy": 422, "invalid_job": 422}
HEALTH_REASON_CODES = {
    "browser_disconnected",
    "capture_interrupted",
    "configuration_failed",
    "duration_limit",
    "ffmpeg_exited",
    "interruption_timeout",
    "media_attachment_failed",
    "media_subscription_failed",
    "page_crashed",
    "quota_limit",
    "receive_transport_failed",
    "room_empty",
    "service_shutdown",
    "sfu_disconnected",
    "worker_missing_after_restart",
}
COMMAND_STATES = {
    "reserved",
    "configured",
    "proof_complete",
    "joined",
    "capture_ready",
    "interrupted",
    "failed",
    "recovery_required",
    "stopping",
    "complete",
    "partial",
}


@dataclass(frozen=True)
class RecorderOutcome:
    outcome: Literal["accepted", "rejected", "indeterminate"]
    accepted_at: datetime | None = None
    public_jwk: dict[str, str] | None = None
    reason_code: str | None = None
    state: str | None = None
    event_sequence: int | None = None
    milestones: dict[str, datetime] | None = None
    interruption: dict[str, Any] | None = None
    endpoint_generation: int = 0
    replacement_ready_at: datetime | None = None


class RecorderClient:
    def __init__(
        self,
        *,
        base_url: str,
        secret: str,
        site: str,
        origin: str,
        allow_http: bool = False,
        session: requests.Session | None = None,
    ):
        self.base_url = _validate_url(base_url, allow_http=allow_http, allow_loopback_http=True)
        self.origin = _validate_url(origin, allow_http=allow_http)
        if not secret or not site:
            raise ValueError("Recorder secret and site must be configured")
        self.secret = secret
        self.site = site
        self.session = session or requests.Session()
        # Be explicit even if urllib3's current default changes.
        adapter = HTTPAdapter(max_retries=0)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

    def reserve(self, *, room: str, recording: str, job: str, limits: dict[str, Any]) -> RecorderOutcome:
        return self._request("reserve", "POST", "/v1/recordings", room, recording, job, limits)

    def query(self, *, room: str, recording: str, job: str, limits: dict[str, Any]) -> RecorderOutcome:
        return self._request("query", "GET", f"/v1/recordings/{job}", room, recording, job, limits)

    def stop(self, *, room: str, recording: str, job: str, limits: dict[str, Any], operation_id: str) -> bool:
        result = self._raw_request(
            "stop",
            "POST",
            f"/v1/recordings/{job}/stop",
            room,
            recording,
            job,
            limits,
            {"protocol_version": PROTOCOL_VERSION, "job": job, "operation_id": operation_id},
        )
        if result is None:
            return False
        response, body = result
        return response.status_code in (200, 202) and body == {
            "protocol_version": PROTOCOL_VERSION,
            "status": "accepted",
            "job": job,
            "operation_id": operation_id,
        }

    def deliver_grant(
        self,
        *,
        room: str,
        recording: str,
        job: str,
        limits: dict[str, Any],
        grant: str,
        endpoint_generation: int,
    ) -> bool:
        outcome = self._raw_request(
            "grant",
            "POST",
            f"/v1/recordings/{job}/grant",
            room,
            recording,
            job,
            limits,
            {
                "protocol_version": PROTOCOL_VERSION,
                "grant": grant,
                "endpoint_generation": endpoint_generation,
            },
        )
        if outcome is None:
            return False
        response, body = outcome
        return response.status_code == 200 and body == {
            "protocol_version": PROTOCOL_VERSION,
            "status": "accepted",
        }

    def _request(
        self,
        operation: str,
        method: str,
        path: str,
        room: str,
        recording: str,
        job: str,
        limits: dict[str, Any],
    ) -> RecorderOutcome:
        result = self._raw_request(
            operation,
            method,
            path,
            room,
            recording,
            job,
            limits,
            {"protocol_version": PROTOCOL_VERSION, "job": job},
        )
        if result is None:
            return RecorderOutcome("indeterminate")
        response, body = result
        if not isinstance(body, dict) or body.get("job") != job:
            return RecorderOutcome("indeterminate")
        accepted_keys = {
            "protocol_version",
            "status",
            "job",
            "accepted_at",
            "public_jwk",
            "endpoint_generation",
            "state",
            "event_sequence",
        }
        optional_keys = {
            "reason_code",
            "milestones",
            "interruption",
            "replacement_ready_at",
        }
        if (
            response.status_code in (200, 202)
            and accepted_keys.issubset(body)
            and set(body).issubset(accepted_keys | optional_keys)
        ):
            if (
                type(body["protocol_version"]) is not int
                or body["protocol_version"] != PROTOCOL_VERSION
                or body["status"] != "accepted"
            ):
                return RecorderOutcome("indeterminate")
            if (
                not isinstance(body["state"], str)
                or body["state"] not in COMMAND_STATES
                or type(body["event_sequence"]) is not int
                or body["event_sequence"] < 1
                or isinstance(body["endpoint_generation"], bool)
                or not isinstance(body["endpoint_generation"], int)
                or body["endpoint_generation"] < 0
                or (
                    "reason_code" in body
                    and (
                        not isinstance(body["reason_code"], str)
                        or body["reason_code"] not in HEALTH_REASON_CODES
                    )
                )
            ):
                return RecorderOutcome("indeterminate")
            try:
                accepted_at = _utc_datetime(body["accepted_at"])
                public_jwk = normalize_public_jwk(body["public_jwk"])
                replacement_ready_at = (
                    _utc_datetime(body["replacement_ready_at"]) if "replacement_ready_at" in body else None
                )
                raw_milestones = body.get("milestones", {})
                if not isinstance(raw_milestones, dict) or not set(raw_milestones).issubset(
                    {"configured", "proof_complete", "joined", "capture_started"}
                ):
                    raise ValueError
                milestones = {key: _utc_datetime(value) for key, value in raw_milestones.items()}
                interruption = body.get("interruption")
                if interruption is not None:
                    if not isinstance(interruption, dict) or set(interruption) != {
                        "id",
                        "interrupted_at",
                        "deadline",
                        "omission_started_at",
                        "resumed_capture_started_at",
                        "recovered_at",
                    }:
                        raise ValueError
                    interruption = {
                        "id": str(uuid.UUID(interruption["id"])),
                        **{
                            key: _utc_datetime(value) if value is not None else None
                            for key, value in interruption.items()
                            if key != "id"
                        },
                    }
            except (TypeError, ValueError):
                return RecorderOutcome("indeterminate")
            return RecorderOutcome(
                "accepted",
                accepted_at=accepted_at,
                public_jwk=public_jwk,
                endpoint_generation=body["endpoint_generation"],
                state=body["state"],
                reason_code=body.get("reason_code"),
                event_sequence=body["event_sequence"],
                milestones=milestones,
                interruption=interruption,
                replacement_ready_at=replacement_ready_at,
            )
        if response.status_code in (409, 422, 429, 507) and set(body) == {
            "protocol_version",
            "status",
            "job",
            "reason_code",
        }:
            reason_code = body["reason_code"]
            if (
                type(body["protocol_version"]) is int
                and body["protocol_version"] == PROTOCOL_VERSION
                and body["status"] == "rejected"
                and isinstance(reason_code, str)
                and reason_code in REJECTION_REASONS
                and response.status_code == REJECTION_STATUSES[reason_code]
            ):
                return RecorderOutcome("rejected", reason_code=reason_code)
        return RecorderOutcome("indeterminate")

    def _raw_request(
        self,
        operation: str,
        method: str,
        path: str,
        room: str,
        recording: str,
        job: str,
        limits: dict[str, Any],
        body: dict[str, Any],
    ) -> tuple[requests.Response, Any] | None:
        token = self._command_token(operation, room, recording, job, limits)
        try:
            response = self.session.request(
                method,
                self.base_url + path,
                json=body if method == "POST" else None,
                headers={"Authorization": f"Bearer {token}"},
                timeout=TIMEOUT,
                allow_redirects=False,
                stream=True,
            )
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_RESPONSE_BYTES:
                response.close()
                return None
            chunks = response.iter_content(MAX_RESPONSE_BYTES + 1)
            content = next(chunks, b"")
            if len(content) > MAX_RESPONSE_BYTES or next(chunks, b""):
                response.close()
                return None
            if not content:
                return response, None
            if response.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                return None
            return response, json.loads(content)
        except (requests.RequestException, ValueError, json.JSONDecodeError):
            return None

    def _command_token(
        self, operation: str, room: str, recording: str, job: str, limits: dict[str, Any]
    ) -> str:
        now = int(time.time())
        payload = {
            "protocol_version": PROTOCOL_VERSION,
            "iss": f"frappe-site:{self.site}",
            "aud": COMMAND_AUDIENCE,
            "site": self.site,
            "origin": self.origin,
            "room": room,
            "recording": recording,
            "job": job,
            "operation": operation,
            "limits": limits,
            "jti": str(uuid.uuid4()),
            "iat": now,
            "exp": now + 30,
        }
        return jwt.encode(payload, self.secret, algorithm="HS256", headers={"typ": COMMAND_TYPE})


def _validate_url(value: str, *, allow_http: bool, allow_loopback_http: bool = False) -> str:
    if not isinstance(value, str):
        raise ValueError("URL must be configured")
    parsed = urlsplit(value)
    http_allowed = allow_http or (
        allow_loopback_http and parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    )
    allowed_schemes = {"https", "http"} if http_allowed else {"https"}
    if (
        parsed.scheme not in allowed_schemes
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("URL must be a trusted HTTP(S) origin without credentials, path, query, or fragment")
    return value.rstrip("/")


def _utc_datetime(value: Any) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        raise ValueError("accepted_at must be UTC RFC 3339")
    parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    if parsed.tzinfo != UTC:
        raise ValueError("accepted_at must be UTC RFC 3339")
    return parsed
