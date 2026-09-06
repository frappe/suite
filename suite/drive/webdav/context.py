"""Per-request context handed to every verb handler.

Handlers never touch frappe.form_dict: frappe.set_user clears it, and under the
streaming_request_paths hook it is empty by construction. Query args live on
request.args, bodies on ctx.body.
"""

import dataclasses
from collections.abc import Iterator
from dataclasses import dataclass, field
from functools import cached_property
from typing import TYPE_CHECKING, Any

import frappe
from werkzeug.wrappers import Request

from suite.drive._core.principals import Principals
from suite.drive.webdav import DAV_PREFIX
from suite.drive.webdav.errors import BadRequest

if TYPE_CHECKING:
    from suite.drive.utils.files import FileManager

CHUNK_SIZE = 1024 * 1024


class BodySource:
    def stream(self) -> Iterator[bytes]:
        raise NotImplementedError

    def read_all(self, limit: int = CHUNK_SIZE) -> bytes:
        raise NotImplementedError


class BufferedBody(BodySource):
    """Baseline: make_form_dict already buffered the raw bytes."""

    def __init__(self, data: bytes):
        self._data = data

    def stream(self) -> Iterator[bytes]:
        for start in range(0, len(self._data), CHUNK_SIZE):
            yield self._data[start : start + CHUNK_SIZE]

    def read_all(self, limit: int = CHUNK_SIZE) -> bytes:
        if len(self._data) > limit:
            raise BadRequest("Request body too large.")
        return self._data


class StreamingBody(BodySource):
    """streaming_request_paths hook active: the body sits unread on request.stream."""

    def __init__(self, stream: Any):
        self._stream = stream

    def stream(self) -> Iterator[bytes]:
        while chunk := self._stream.read(CHUNK_SIZE):
            yield chunk

    def read_all(self, limit: int = CHUNK_SIZE) -> bytes:
        data = self._stream.read(limit + 1)
        if len(data) > limit:
            raise BadRequest("Request body too large.")
        return data


def build_body_source(request: Request) -> BodySource:
    # make_form_dict caches raw bytes on the request; its absence means the
    # streaming hook claimed this path and the stream is still consumable.
    cached = getattr(request, "_cached_data", None)
    if cached is not None:
        return BufferedBody(cached)
    return StreamingBody(request.stream)


@dataclass
class DavContext:
    request: Request
    user: str  # canonical authenticated user, never Guest
    segments: list[str]  # decoded path below /dav; [] = the Personal Root itself
    had_trailing_slash: bool
    depth: str | None  # "0" | "1" | "infinity" | None (verb applies its RFC default)
    overwrite: bool
    body: BodySource
    path: Any = None  # ResolvedPath, filled by the dispatcher once resolved
    extras: dict = field(default_factory=dict)

    @cached_property
    def manager(self) -> FileManager:
        # Only the not-yet-relinked write verbs still reach for this. It goes
        # with the last `manager.*` call in ticket 25 (§12.5).
        from suite.drive.utils.files import FileManager

        return FileManager()

    @cached_property
    def principals(self) -> Principals:
        """The identity this DAV session reaches with.

        §6.9: a DAV client presents credentials and has nowhere to put a link
        token, so the session is the signed-in user's own principals - their
        address, their groups, `$GENERAL`, and `$PUBLIC`. Honouring an
        `X-Drive-Links` header here would turn Basic auth into a carrier for an
        anonymous bearer on a PUT-able, lockable endpoint, which §6.9 rejects by
        name.

        The dispatcher already drops that header from the environ, so there is
        normally nothing to strip. This stays because it is cheap and because it
        is the one place a reader looks to learn what a DAV session reaches
        with.
        """
        from suite.drive import framework

        return dataclasses.replace(
            framework.principals_for(self.user),
            open=("$PUBLIC",),
            link_tickets=(),
        )


def build(request: Request, user: str) -> DavContext:
    return DavContext(
        request=request,
        user=user,
        segments=_decode_segments(request.path),
        had_trailing_slash=request.path != DAV_PREFIX and request.path.endswith("/"),
        depth=_parse_depth(request.headers.get("Depth")),
        overwrite=_parse_overwrite(request.headers.get("Overwrite")),
        body=build_body_source(request),
    )


def validate_segments(segments: list[str]) -> list[str]:
    for segment in segments:
        if segment in (".", ".."):
            raise BadRequest("Relative path segments are not allowed.")
        if "�" in segment or any(ord(c) < 0x20 for c in segment):
            raise BadRequest("Malformed path segment.")
    return segments


def _decode_segments(path: str) -> list[str]:
    # werkzeug has already percent-decoded request.path exactly once (UTF-8)
    remainder = path[len(DAV_PREFIX) :]
    return validate_segments([segment for segment in remainder.split("/") if segment])


def _parse_depth(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized not in ("0", "1", "infinity"):
        raise BadRequest("Invalid Depth header.")
    return normalized


def _parse_overwrite(value: str | None) -> bool:
    if value is None:
        return True
    normalized = value.strip().upper()
    if normalized not in ("T", "F"):
        raise BadRequest("Invalid Overwrite header.")
    return normalized == "T"
