"""Authenticated Frappe queue access; source downloads never follow redirects."""

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from protocol import MAX_SEGMENT_BYTES, Source, WorkError, origin


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class Site:
    origin: str
    secret: str = field(repr=False)
    recorder_origins: tuple[str, ...]

    @classmethod
    def parse(cls, value: dict, *, allow_http: bool = False):
        site_origin = origin(value["origin"], allow_http=allow_http)
        recorders = tuple(origin(item, allow_http=allow_http) for item in value["recorder_origins"])
        if not recorders or not isinstance(value["secret"], str) or len(value["secret"]) < 32:
            raise ValueError("Configure recorder origins and a separate strong worker secret per site")
        return cls(site_origin, value["secret"], recorders)


class Gateway:
    def __init__(self, site: Site, worker_id: str, *, timeout=30):
        self.site, self.worker_id, self.timeout = site, worker_id, timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def _read(self, request, *, maximum: int, timeout=None):
        try:
            with self.opener.open(request, timeout=timeout or self.timeout) as response:
                data = response.read(maximum + 1)
                if len(data) > maximum:
                    raise WorkError("response_too_large")
                return data
        except urllib.error.HTTPError as error:
            error.close()
            if error.code in (401, 403, 409):
                raise WorkError("authorization_or_lease_rejected") from None
            raise WorkError(
                "source_unavailable" if request.method == "GET" else "queue_request_failed",
                transient=error.code in (408, 425, 429) or error.code >= 500,
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise WorkError("transport_failed", transient=True) from None

    def call(self, operation: str, payload: dict) -> dict:
        if operation not in {"claim", "heartbeat", "complete", "fail", "queue_status"}:
            raise ValueError("Unknown queue operation")
        body = json.dumps({"worker_id": self.worker_id, **payload}, allow_nan=False).encode()
        if len(body) > 16 * 1024 * 1024:
            raise WorkError("result_too_large")
        request = urllib.request.Request(
            self.site.origin + "/api/method/suite.meet.api.transcription." + operation,
            data=body,
            method="POST",
            headers={
                "X-Meet-Transcription-Authorization": "Bearer " + self.site.secret,
                "Content-Type": "application/json",
            },
        )
        try:
            result = json.loads(
                self._read(
                    request,
                    maximum=16 * 1024 * 1024,
                    timeout=min(self.timeout, 10)
                    if operation in {"claim", "heartbeat", "queue_status"}
                    else self.timeout,
                )
            )
            result = result.get("message", result)
            if not isinstance(result, dict):
                raise ValueError
            return result
        except (ValueError, AttributeError):
            raise WorkError("invalid_queue_response") from None

    def source(self, source: Source, authorized: dict) -> bytes:
        # The current lease heartbeat refreshes capabilities. Immutable source fields
        # must agree with the original manifest before any capability is used.
        if Source.parse(authorized) != source:
            raise WorkError("source_manifest_changed")
        url = authorized.get("url", "")
        parsed = urlsplit(url)
        if (
            f"{parsed.scheme}://{parsed.netloc}" not in self.site.recorder_origins
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith("/v1/transcriptions/")
            or "/segments/" not in parsed.path
        ):
            raise WorkError("source_origin_rejected")
        authorization = authorized.get("authorization", "")
        if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
            raise WorkError("source_authorization_missing")
        data = self._read(
            urllib.request.Request(url, headers={"Authorization": authorization}, method="GET"),
            maximum=MAX_SEGMENT_BYTES,
        )
        source.check_audio(data)
        return data
