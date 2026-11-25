"""Short-lived, site/capture scoped control and source capabilities."""

import time
from urllib.parse import quote, urlsplit

import frappe
import jwt
import requests


def origin():
    return (frappe.conf.get("recorder_site_origin") or frappe.utils.get_url()).rstrip("/")


def _url(setting):
    value = (frappe.conf.get(setting) or "").rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("Invalid transcription service origin")
    if (
        parsed.scheme == "http"
        and parsed.hostname not in ("localhost", "127.0.0.1", "::1")
        and not frappe.conf.get("developer_mode")
    ):
        raise ValueError("Transcription services require HTTPS")
    return value


def source_token(capture, room, operation, **limits):
    now = int(time.time())
    return jwt.encode(
        {
            "iss": origin(),
            "aud": "meet-transcription-source",
            "site": frappe.local.site,
            "origin": origin(),
            "room": room,
            "capture": capture,
            "operation": operation,
            "iat": now,
            "exp": now + (14460 if operation == "capture" else 120),
            **limits,
        },
        frappe.conf.get("recorder_secret"),
        algorithm="HS256",
        headers={"typ": "meet-transcription-source+jwt"},
    )


def recorder(capture, room, operation, *, body=None):
    method, suffix = {
        "reserve": ("POST", ""),
        "manifest": ("GET", "/manifest"),
        "delete": ("DELETE", ""),
        "complete": ("POST", "/complete"),
    }[operation]
    token = source_token(
        capture,
        room,
        "capture" if operation == "complete" else operation,
        **(body or {}) if operation == "reserve" else {},
    )
    response = requests.request(
        method,
        _url("recorder_server_url") + "/v1/transcriptions/" + quote(capture, safe="") + suffix,
        json=body,
        headers={"Authorization": "Bearer " + token},
        timeout=(2, 10),
        allow_redirects=False,
    )
    if operation == "delete" and response.status_code == 404:
        return {"deleted": True}
    if 300 <= response.status_code < 400:
        raise ValueError("Transcription service redirects are not supported")
    response.raise_for_status()
    if len(response.content) > 32 * 1024 * 1024:
        raise ValueError("Transcription manifest exceeds bounds")
    return response.json()


def sfu(capture, room, operation):
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": origin(),
            "aud": "meet-transcription-control",
            "origin": origin(),
            "site": frappe.local.site,
            "room": room,
            "capture": capture,
            "operation": operation,
            "iat": now,
            "exp": now + 120,
            "jti": frappe.generate_hash(length=32),
        },
        frappe.conf.get("sfu_secret"),
        algorithm="HS256",
        headers={"typ": "meet-transcription-command+jwt"},
    )
    body = (
        {
            "recorder_origin": _url("recorder_server_url"),
            "source_token": source_token(capture, room, "capture"),
            "max_duration_ms": 14400000,
        }
        if operation == "start"
        else {}
    )
    response = requests.request(
        "GET" if operation == "query" else "POST",
        _url("sfu_server_url")
        + "/v1/transcriptions/"
        + quote(capture, safe="")
        + ("" if operation == "query" else "/" + operation),
        json=body,
        headers={"Authorization": "Bearer " + token},
        timeout=(2, 10),
        allow_redirects=False,
    )
    if 300 <= response.status_code < 400:
        raise ValueError("Transcription service redirects are not supported")
    response.raise_for_status()
    return response.json()


def authorize_manifest(job):
    manifest = frappe.parse_json(job.manifest)
    base = _url("recorder_server_url") + "/v1/transcriptions/" + quote(job.capture, safe="")
    return {
        **manifest,
        "segments": [
            {
                **s,
                "encoding": "pcm_s16le",
                "url": base + "/segments/" + quote(s["source_id"], safe=""),
                "authorization": "Bearer "
                + source_token(job.capture, job.meet_room, "source", source_id=s["source_id"]),
            }
            for s in manifest["segments"]
        ],
    }
