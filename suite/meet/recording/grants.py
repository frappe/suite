from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from datetime import datetime
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

GRANT_AUDIENCE = "meet-sfu-recorder"
GRANT_TYPE = "meet-recording-grant+jwt"
MAX_CONNECTION_LIFETIME_SECONDS = 60


def _decode_coordinate(value: Any, name: str) -> bytes:
    if not isinstance(value, str) or not value or "=" in value:
        raise ValueError(f"JWK {name} must be unpadded base64url")
    try:
        encoded = value.encode("ascii")
        decoded = base64.b64decode(encoded + b"=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
    except (UnicodeEncodeError, ValueError):
        raise ValueError(f"JWK {name} must be unpadded base64url") from None
    if len(decoded) != 32:
        raise ValueError(f"JWK {name} must decode to 32 bytes")
    if base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii") != value:
        raise ValueError(f"JWK {name} must use canonical base64url encoding")
    return decoded


def normalize_public_jwk(jwk: Any) -> dict[str, str]:
    """Validate and return the normalized public P-256 JWK."""
    if not isinstance(jwk, dict) or set(jwk) != {"kty", "crv", "x", "y"}:
        raise ValueError("Public JWK must contain exactly kty, crv, x, and y")
    if jwk["kty"] != "EC" or jwk["crv"] != "P-256":
        raise ValueError("Public JWK must be an EC P-256 key")

    x = _decode_coordinate(jwk["x"], "x")
    y = _decode_coordinate(jwk["y"], "y")
    try:
        ec.EllipticCurvePublicNumbers(int.from_bytes(x), int.from_bytes(y), ec.SECP256R1()).public_key()
    except ValueError:
        raise ValueError("JWK coordinates are not a P-256 curve point") from None
    return {"kty": "EC", "crv": "P-256", "x": jwk["x"], "y": jwk["y"]}


def public_jwk_thumbprint(jwk: Any) -> str:
    """Return the RFC 7638 SHA-256 thumbprint in base64url form."""
    normalized = normalize_public_jwk(jwk)
    canonical = json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(hashlib.sha256(canonical).digest()).rstrip(b"=").decode("ascii")


def _unix_seconds(value: int | datetime, name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be Unix seconds or a datetime")
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, int):
        return value
    raise ValueError(f"{name} must be Unix seconds or a datetime")


def mint_recording_grant(
    *,
    secret: str,
    site: str,
    meeting_id: str,
    recording_id: str,
    recorder_job_id: str,
    public_jwk: Any,
    max_ends_at: int | datetime,
    authorization_expires_at: int | datetime | None = None,
    issued_at: int | None = None,
    expires_in: int = 30,
    jti: str | None = None,
) -> str:
    """Mint a short-lived, proof-bound SFU Recording Grant."""
    if not secret or not all(
        isinstance(value, str) and value for value in (site, meeting_id, recording_id, recorder_job_id)
    ):
        raise ValueError("Grant secret and identifiers must be non-empty strings")
    if (
        isinstance(expires_in, bool)
        or not isinstance(expires_in, int)
        or not 1 <= expires_in <= MAX_CONNECTION_LIFETIME_SECONDS
    ):
        raise ValueError("Recording Grant lifetime must be between 1 and 60 seconds")

    now = int(time.time()) if issued_at is None else _unix_seconds(issued_at, "issued_at")
    maximum = _unix_seconds(max_ends_at, "max_ends_at")
    authorization_expiry = (
        maximum
        if authorization_expires_at is None
        else _unix_seconds(authorization_expires_at, "authorization_expires_at")
    )
    if authorization_expiry > maximum:
        raise ValueError("authorization_expires_at must not exceed max_ends_at")
    if authorization_expiry <= now:
        raise ValueError("Recording authorization must expire after issuance")

    normalized_jwk = normalize_public_jwk(public_jwk)
    payload = {
        "iss": f"frappe-site:{site}",
        "aud": GRANT_AUDIENCE,
        "scope": "recording",
        "jti": jti or str(uuid.uuid4()),
        "site": site,
        "meeting_id": meeting_id,
        "recording_id": recording_id,
        "recorder_job_id": recorder_job_id,
        "cnf": {"jwk": normalized_jwk, "jkt": public_jwk_thumbprint(normalized_jwk)},
        "iat": now,
        "exp": min(now + expires_in, authorization_expiry),
        "authorization_expires_at": authorization_expiry,
    }
    return jwt.encode(payload, secret, algorithm="HS256", headers={"typ": GRANT_TYPE})
