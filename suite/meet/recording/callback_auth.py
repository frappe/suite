from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import uuid
from datetime import datetime

import frappe
import jwt
from frappe import _

from suite.meet.recording.grants import normalize_public_jwk

CALLBACK_AUDIENCE = "meet-recording-callback"
CALLBACK_TYPE = "meet-recording-callback+jwt"
PROTOCOL_VERSION = 1
CLAIM_KEYS = {
    "aud",
    "body_sha256",
    "exp",
    "iat",
    "iss",
    "job",
    "jti",
    "operation",
    "operation_id",
    "protocol_version",
    "recording",
    "site",
}

CALLBACK_BODY_KEYS = {
    "startup_progress": {
        "protocol_version",
        "recording_id",
        "job",
        "event_sequence",
        "milestone",
        "occurred_at",
    },
    "interrupted": {
        "protocol_version",
        "recording_id",
        "job",
        "event_sequence",
        "reason_code",
        "interruption_id",
        "interrupted_at",
        "interruption_deadline",
        "omission_started_at",
    },
    "recovered": {
        "protocol_version",
        "recording_id",
        "job",
        "event_sequence",
        "interruption_id",
        "resumed_capture_started_at",
        "recovered_at",
    },
    "replacement_ready": {
        "protocol_version",
        "recording_id",
        "job",
        "event_sequence",
        "interruption_id",
        "endpoint_generation",
        "public_jwk",
        "ready_at",
    },
    "failed": {"protocol_version", "recording_id", "job", "event_sequence", "reason_code"},
    "stopped": {
        "protocol_version",
        "recording_id",
        "job",
        "event_sequence",
        "captured_bytes",
        "size",
        "sha256",
        "duration_ms",
        "ended_at",
        "end_reason_code",
        "gaps",
    },
    "segment_progress": {"protocol_version", "recording_id", "job", "captured_bytes"},
    "complete_upload": {"protocol_version", "recording_id", "job", "event_sequence"},
}
UPLOAD_QUERY_KEYS = {"protocol_version", "recording_id", "job", "offset", "chunk_sha256"}
STARTUP_MILESTONES = {"configured", "proof_complete", "joined", "capture_started"}
INTERRUPTION_REASON_CODES = {
    "browser_disconnected",
    "capture_interrupted",
    "configuration_failed",
    "ffmpeg_exited",
    "media_attachment_failed",
    "media_subscription_failed",
    "page_crashed",
    "receive_transport_failed",
    "sfu_disconnected",
}
END_REASON_CODES = {
    "duration_limit",
    "host_stop",
    "interruption_timeout",
    "quota_limit",
    "room_empty",
    "service_shutdown",
}
GAP_REASON_CODES = {"capture_interrupted", "ffmpeg_exited", "renderer_interrupted"}
FAILURE_REASON_CODES = {"capture_failed", "processing_failed", "storage_unavailable", "quota_exhausted"}


def _invalid_payload():
    frappe.throw(_("Invalid recorder callback body"), frappe.AuthenticationError)


def _is_integer(value, *, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


def _is_canonical_timestamp(value) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _timestamp(value):
    if not _is_canonical_timestamp(value):
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _is_uuid(value) -> bool:
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False


def _validate_callback_payload(operation: str, body: dict):
    if (
        type(body.get("protocol_version")) is not int
        or body["protocol_version"] != PROTOCOL_VERSION
        or not isinstance(body.get("recording_id"), str)
        or not body["recording_id"]
        or not isinstance(body.get("job"), str)
        or not body["job"]
    ):
        _invalid_payload()

    sequence = body.get("event_sequence")
    if operation in {
        "startup_progress",
        "interrupted",
        "recovered",
        "replacement_ready",
        "failed",
        "stopped",
        "complete_upload",
    } and not _is_integer(sequence, minimum=1):
        _invalid_payload()

    valid = True
    if operation == "startup_progress":
        valid = (
            isinstance(body.get("milestone"), str)
            and body["milestone"] in STARTUP_MILESTONES
            and _is_canonical_timestamp(body.get("occurred_at"))
        )
    elif operation == "interrupted":
        interrupted = _timestamp(body.get("interrupted_at"))
        deadline = _timestamp(body.get("interruption_deadline"))
        omission_started = _timestamp(body.get("omission_started_at"))
        valid = (
            isinstance(body.get("reason_code"), str)
            and body["reason_code"] in INTERRUPTION_REASON_CODES
            and _is_uuid(body.get("interruption_id"))
            and interrupted is not None
            and deadline is not None
            and omission_started is not None
            and deadline.timestamp() - interrupted.timestamp() == 60
            and omission_started <= interrupted
        )
    elif operation == "recovered":
        resumed = _timestamp(body.get("resumed_capture_started_at"))
        recovered = _timestamp(body.get("recovered_at"))
        valid = (
            _is_uuid(body.get("interruption_id"))
            and resumed is not None
            and recovered is not None
            and resumed <= recovered
        )
    elif operation == "replacement_ready":
        try:
            normalize_public_jwk(body.get("public_jwk"))
        except (TypeError, ValueError):
            valid = False
        valid = (
            valid
            and _is_uuid(body.get("interruption_id"))
            and _is_integer(body.get("endpoint_generation"))
            and _is_canonical_timestamp(body.get("ready_at"))
        )
    elif operation == "failed":
        valid = isinstance(body.get("reason_code"), str) and body["reason_code"] in FAILURE_REASON_CODES
    elif operation == "segment_progress":
        valid = _is_integer(body.get("captured_bytes"))
    elif operation == "stopped":
        gaps = body.get("gaps")
        valid = (
            _is_integer(body.get("captured_bytes"))
            and _is_integer(body.get("size"), minimum=1)
            and _is_integer(body.get("duration_ms"), minimum=1)
            and isinstance(body.get("sha256"), str)
            and re.fullmatch(r"[0-9a-f]{64}", body["sha256"]) is not None
            and _is_canonical_timestamp(body.get("ended_at"))
            and isinstance(body.get("end_reason_code"), str)
            and body["end_reason_code"] in END_REASON_CODES
            and isinstance(gaps, list)
            and all(
                isinstance(gap, dict)
                and set(gap) == {"started_at", "ended_at", "reason_code"}
                and _is_canonical_timestamp(gap["started_at"])
                and _is_canonical_timestamp(gap["ended_at"])
                and _timestamp(gap["started_at"]) <= _timestamp(gap["ended_at"])
                and isinstance(gap["reason_code"], str)
                and gap["reason_code"] in GAP_REASON_CODES
                for gap in gaps
            )
        )
    if not valid:
        _invalid_payload()


def valid_upload_query(args, *, content_type, content_length, body) -> bool:
    return (
        isinstance(args, dict)
        and set(args) == UPLOAD_QUERY_KEYS
        and args.get("protocol_version") == str(PROTOCOL_VERSION)
        and bool(args.get("recording_id"))
        and bool(args.get("job"))
        and isinstance(args.get("offset"), str)
        and re.fullmatch(r"0|[1-9]\d*", args["offset"]) is not None
        and isinstance(args.get("chunk_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", args["chunk_sha256"]) is not None
        and content_type == "application/octet-stream"
        and type(content_length) is int
        and 0 < content_length <= 8 * 1024 * 1024
        and isinstance(body, bytes)
        and len(body) == content_length
        and hmac.compare_digest(hashlib.sha256(body).hexdigest(), args["chunk_sha256"])
    )


def _validate_upload_query():
    content_length = frappe.request.content_length
    if (
        frappe.request.content_type != "application/octet-stream"
        or type(content_length) is not int
        or not 0 < content_length <= 8 * 1024 * 1024
    ):
        frappe.throw(_("Invalid recorder callback query"), frappe.AuthenticationError)
    body = frappe.request.get_data(cache=True)
    if not valid_upload_query(
        frappe.request.args.to_dict(),
        content_type=frappe.request.content_type,
        content_length=content_length,
        body=body,
    ):
        frappe.throw(_("Invalid recorder callback query"), frappe.AuthenticationError)
    return body


def valid_callback_claims(
    claims,
    *,
    site: str,
    recording: str,
    job: str,
    operation: str,
    operation_id: str,
    protocol_version: int,
    now: int,
) -> bool:
    return (
        isinstance(claims, dict)
        and set(claims) == CLAIM_KEYS
        and claims.get("aud") == CALLBACK_AUDIENCE
        and claims.get("site") == site
        and claims.get("iss") == f"meet-recorder:{site}"
        and claims.get("recording") == recording
        and claims.get("job") == job
        and claims.get("operation") == operation
        and claims.get("operation_id") == operation_id
        and type(claims.get("protocol_version")) is int
        and claims.get("protocol_version") == PROTOCOL_VERSION
        and claims.get("protocol_version") == protocol_version
        and isinstance(claims.get("jti"), str)
        and bool(claims["jti"])
        and type(claims.get("iat")) is int
        and type(claims.get("exp")) is int
        and claims["exp"] - claims["iat"] == 30
        and claims["iat"] <= now + 5
        and claims["iat"] >= now - 35
        and isinstance(claims.get("body_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", claims["body_sha256"]) is not None
    )


def authenticate_callback(
    *,
    protocol_version: int,
    recording: str,
    job: str,
    operation: str,
    operation_id: str,
    now: int | None = None,
):
    authorization = frappe.request.headers.get("X-Meet-Recorder-Authorization", "")
    if not authorization.startswith("Bearer ") or len(authorization) == 7:
        frappe.throw(_("Missing recorder callback authorization"), frappe.AuthenticationError)
    token = authorization[7:]
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        frappe.throw(_("Invalid recorder callback authorization"), frappe.AuthenticationError)
    if set(header) != {"alg", "typ"} or header.get("alg") != "HS256" or header.get("typ") != CALLBACK_TYPE:
        frappe.throw(_("Invalid recorder callback authorization"), frappe.AuthenticationError)

    now = now if now is not None else int(time.time())
    try:
        claims = jwt.decode(
            token,
            frappe.conf.get("recorder_secret"),
            algorithms=["HS256"],
            audience=CALLBACK_AUDIENCE,
            issuer=f"meet-recorder:{frappe.local.site}",
            options={"require": list(CLAIM_KEYS)},
        )
    except jwt.PyJWTError:
        frappe.throw(_("Invalid recorder callback authorization"), frappe.AuthenticationError)
    if not valid_callback_claims(
        claims,
        site=frappe.local.site,
        recording=recording,
        job=job,
        operation=operation,
        operation_id=operation_id,
        protocol_version=protocol_version,
        now=now,
    ):
        frappe.throw(_("Invalid recorder callback scope"), frappe.AuthenticationError)

    body_data = (
        _validate_upload_query() if operation == "upload_chunk" else frappe.request.get_data(cache=True)
    )
    body_sha256 = hashlib.sha256(body_data).hexdigest()
    if not hmac.compare_digest(claims["body_sha256"], body_sha256):
        frappe.throw(_("Invalid recorder callback body"), frappe.AuthenticationError)

    if operation != "upload_chunk":
        try:
            body = json.loads(body_data)
        except (TypeError, ValueError, json.JSONDecodeError):
            frappe.throw(_("Invalid recorder callback body"), frappe.AuthenticationError)
        if not isinstance(body, dict) or set(body) != CALLBACK_BODY_KEYS.get(operation):
            frappe.throw(_("Invalid recorder callback body"), frappe.AuthenticationError)
        _validate_callback_payload(operation, body)

    expected_job = frappe.db.get_value("Meet Recording", recording, "recorder_job_id")
    if expected_job != job:
        frappe.throw(_("Invalid recorder callback binding"), frappe.AuthenticationError)
    replay_key = frappe.cache.make_key(f"meet-recording-callback-jti:{claims['jti']}")
    if not frappe.cache.set(replay_key, "1", ex=40, nx=True):
        frappe.throw(_("Recorder callback authorization was already used"), frappe.AuthenticationError)
    return claims
