from __future__ import annotations

import json
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
MAX_RESPONSE_BYTES = 16 * 1024
TIMEOUT = (2, 5)
REJECTION_REASONS = {"capacity", "storage", "policy", "invalid_job"}


@dataclass(frozen=True)
class RecorderOutcome:
    outcome: Literal["accepted", "rejected", "indeterminate"]
    accepted_at: datetime | None = None
    public_jwk: dict[str, str] | None = None
    reason: str | None = None
    state: str | None = None
    health_reason: str | None = None


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
            {"job": job, "operation_id": operation_id},
        )
        if result is None:
            return False
        response, body = result
        return response.status_code in (200, 202) and body == {
            "status": "accepted",
            "job": job,
            "operation_id": operation_id,
        }

    def deliver_grant(
        self, *, room: str, recording: str, job: str, limits: dict[str, Any], grant: str
    ) -> bool:
        outcome = self._raw_request(
            "grant", "POST", f"/v1/recordings/{job}/grant", room, recording, job, limits, {"grant": grant}
        )
        if outcome is None:
            return False
        response, body = outcome
        return response.status_code in (200, 204) and (body is None or body == {"status": "accepted"})

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
        result = self._raw_request(operation, method, path, room, recording, job, limits, {"job": job})
        if result is None:
            return RecorderOutcome("indeterminate")
        response, body = result
        if not isinstance(body, dict) or body.get("job") != job:
            return RecorderOutcome("indeterminate")
        accepted_keys = {
            "status",
            "job",
            "accepted_at",
            "public_jwk",
            "state",
        }
        if response.status_code in (200, 202) and set(body) in (
            accepted_keys,
            accepted_keys | {"health_reason"},
        ):
            if body["status"] != "accepted":
                return RecorderOutcome("indeterminate")
            states = {
                "reserved",
                "configured",
                "proof_complete",
                "joined",
                "capture_ready",
                "interrupted",
                "failed",
                "recovery_required",
                "stopping",
            }
            if body["state"] not in states or (
                "health_reason" in body
                and (not isinstance(body["health_reason"], str) or len(body["health_reason"]) > 256)
            ):
                return RecorderOutcome("indeterminate")
            try:
                accepted_at = _utc_datetime(body["accepted_at"])
                public_jwk = normalize_public_jwk(body["public_jwk"])
            except (TypeError, ValueError):
                return RecorderOutcome("indeterminate")
            return RecorderOutcome(
                "accepted",
                accepted_at=accepted_at,
                public_jwk=public_jwk,
                state=body["state"],
                health_reason=body.get("health_reason"),
            )
        if response.status_code in (409, 422, 429, 507) and set(body) == {"status", "job", "reason"}:
            reason = body["reason"]
            if body["status"] == "rejected" and reason in REJECTION_REASONS:
                return RecorderOutcome("rejected", reason=reason)
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
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("accepted_at must be UTC RFC 3339")
    parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    if parsed.tzinfo != UTC:
        raise ValueError("accepted_at must be UTC RFC 3339")
    return parsed
