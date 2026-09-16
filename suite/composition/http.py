"""Translate Suite resource URLs onto Frappe's v2 method API."""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import frappe

PREFIX = "/api/suite/"
V2_PREFIX = "/api/v2/method/"
ORIGINAL_PATH = "suite.original_path"

_FIELD = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)(?::(path))?\}")


class BadRequest(frappe.ValidationError):
    http_status_code = 400


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    handler: str
    body: Any = None
    errors: tuple[type[Exception], ...] = ()
    allow_guest: bool = False
    query: Any = None
    output: Any = None
    entity: dict[str, str] | None = None


@dataclass(frozen=True)
class HttpOwner:
    """One product-owned route table and its Frappe handler module."""

    owner: str
    prefix: str
    target: str
    routes: tuple[Route, ...]
    unknown: str = "unknown"
    strip_owner: bool = True


@dataclass(frozen=True)
class _Matcher:
    pattern: re.Pattern[str]
    names: tuple[str, ...]


@lru_cache(maxsize=None)
def compile_template(template: str) -> _Matcher:
    """Compile a route template without letting literals become regex."""

    pieces: list[str] = []
    names: list[str] = []
    position = 0
    for field in _FIELD.finditer(template):
        pieces.append(re.escape(template[position : field.start()]))
        name, converter = field.groups()
        if name in names:
            raise ValueError(f"Duplicate route parameter {name}")
        names.append(name)
        pieces.append("(.+)" if converter == "path" else "([^/]+)")
        position = field.end()
    pieces.append(re.escape(template[position:]))
    if "{" in template or "}" in template:
        consumed = _FIELD.sub("", template)
        if "{" in consumed or "}" in consumed:
            raise ValueError(f"Invalid route template {template}")
    return _Matcher(re.compile("^" + "".join(pieces) + "$"), tuple(names))


def match_route(route: Route, path: str) -> dict[str, str] | None:
    """Return path parameters when one method-independent path matches."""

    matcher = compile_template(route.path)
    match = matcher.pattern.match(path)
    if match is None:
        return None
    return dict(zip(matcher.names, match.groups(), strict=True))


def handle_before_request() -> None:
    """Select an owner and translate its resource path."""

    request = getattr(frappe.local, "request", None)
    if request is None or not request.path.startswith(PREFIX) or request.method == "OPTIONS":
        return

    relative = request.path[len(PREFIX) :]
    first = relative.split("/", 1)[0]

    from suite.composition.registrations import HTTP_OWNERS

    target = HTTP_OWNERS.get(first)
    if target is None:
        return
    registration = frappe.get_attr(target)
    dispatch(registration, request=request)


def dispatch(registration: HttpOwner, *, request=None) -> None:
    """Translate a request through one already-selected owner table."""

    request = request or getattr(frappe.local, "request", None)
    if request is None or request.method == "OPTIONS":
        return
    if not request.path.startswith(registration.prefix):
        return

    relative = request.path[len(registration.prefix) :].rstrip("/")
    if registration.strip_owner:
        owner, separator, relative = relative.partition("/")
        if owner != registration.owner or not separator:
            return

    for route in registration.routes:
        if route.method != request.method:
            continue
        parameters = match_route(route, relative)
        if parameters is None:
            continue
        frappe.local.form_dict.update(parameters)
        _rewrite(request, registration.target + "." + route.handler)
        return

    _rewrite(request, registration.target + "." + registration.unknown)


def _rewrite(request, target: str) -> None:
    """Rewrite both path representations used by Frappe's API router."""

    frappe.local.form_dict.pop("cmd", None)
    v2_target = V2_PREFIX + target
    request.environ.setdefault(ORIGINAL_PATH, request.path)
    request.environ["PATH_INFO"] = v2_target
    request.path = v2_target
    for cached in ("full_path", "url", "base_url"):
        request.__dict__.pop(cached, None)


def original_path() -> str | None:
    """Return the client path after translation."""

    request = getattr(frappe.local, "request", None)
    return request.environ.get(ORIGINAL_PATH) if request is not None else None
