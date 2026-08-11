from __future__ import annotations

import hashlib
import hmac
import time

import frappe
import jwt
from frappe import _

CALLBACK_AUDIENCE = "meet-recording-callback"
CALLBACK_TYPE = "meet-recording-callback+jwt"
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
    "recording",
    "site",
}


def authenticate_callback(
    *, recording: str, job: str, operation: str, operation_id: str, now: int | None = None
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
    if (
        set(claims) != CLAIM_KEYS
        or claims.get("aud") != CALLBACK_AUDIENCE
        or claims.get("site") != frappe.local.site
        or claims.get("iss") != f"meet-recorder:{claims.get('site')}"
        or claims.get("recording") != recording
        or claims.get("job") != job
        or claims.get("operation") != operation
        or claims.get("operation_id") != operation_id
        or not isinstance(claims.get("jti"), str)
        or not claims["jti"]
        or not isinstance(claims.get("iat"), int)
        or not isinstance(claims.get("exp"), int)
        or claims["exp"] - claims["iat"] != 30
        or claims["iat"] > now + 5
        or claims["iat"] < now - 35
        or not isinstance(claims.get("body_sha256"), str)
        or len(claims["body_sha256"]) != 64
    ):
        frappe.throw(_("Invalid recorder callback scope"), frappe.AuthenticationError)

    body_sha256 = hashlib.sha256(frappe.request.get_data(cache=True)).hexdigest()
    if not hmac.compare_digest(claims["body_sha256"], body_sha256):
        frappe.throw(_("Invalid recorder callback body"), frappe.AuthenticationError)

    expected_job = frappe.db.get_value("Meet Recording", recording, "recorder_job_id")
    if expected_job != job:
        frappe.throw(_("Invalid recorder callback binding"), frappe.AuthenticationError)
    replay_key = frappe.cache.make_key(f"meet-recording-callback-jti:{claims['jti']}")
    if not frappe.cache.set(replay_key, "1", ex=40, nx=True):
        frappe.throw(_("Recorder callback authorization was already used"), frappe.AuthenticationError)
    return claims
