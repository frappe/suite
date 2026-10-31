"""Export product HTTP tables as frontend transport contracts."""

from __future__ import annotations

import inspect
import json
import re
import types
from importlib import import_module
from pathlib import Path
from typing import Union, get_args, get_origin, get_type_hints

import frappe
from pydantic import TypeAdapter

from suite.composition.http import HttpOwner, compile_template
from suite.composition.registrations import HTTP_OWNERS

REPO = Path(__file__).resolve().parents[2]


def write_all() -> dict[str, str]:
    """Write one committed contract input per registered owner."""

    written: dict[str, str] = {}
    for registration in _owners():
        path = _contract_path(registration.owner)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(export(registration), indent=2, sort_keys=False) + "\n")
        written[registration.owner] = str(path)
    return written


def export(registration: HttpOwner) -> dict:
    operations = []
    public_names: set[str] = set()
    operation_ids: set[str] = set()
    handlers = import_module(registration.target)
    for route in (*registration.routes, *registration.contract_routes):
        handler = inspect.unwrap(getattr(handlers, route.handler))
        output = route.output or get_type_hints(handler).get("return")
        bodies = _union_members(route.body)
        for body in bodies or (None,):
            if route.kind not in ("query", "mutation"):
                raise ValueError(f"{registration.owner}.{route.handler}: missing operation kind")
            public_name = (
                route.public_name.get(body.__name__)
                if isinstance(route.public_name, dict) and body
                else route.public_name
            )
            if not isinstance(public_name, str) or not re.fullmatch(
                r"[A-Za-z]\w*(\.[A-Za-z]\w*)+", public_name
            ):
                raise ValueError(f"{registration.owner}.{route.handler}: missing public name")
            if any(
                public_name == name
                or public_name.startswith(name + ".")
                or name.startswith(public_name + ".")
                for name in public_names
            ):
                raise ValueError(f"Duplicate or overlapping public name: {registration.owner}.{public_name}")
            public_names.add(public_name)
            operation_id = route.id or route.handler
            if len(bodies) > 1:
                operation_id += "." + _snake_case(body.__name__)
            if operation_id in operation_ids:
                raise ValueError(f"Duplicate operation ID: {registration.owner}.{operation_id}")
            operation_ids.add(operation_id)
            query_schema, body_schema, output_schema = (
                _schema(route.query),
                _schema(body),
                None if route.response_bytes or (route.stream and route.method == "GET") else _schema(output),
            )
            _check_page(route, query_schema, body_schema, output_schema)
            path_params = list(compile_template(route.path).names)
            operations.append(
                {
                    "id": operation_id,
                    "kind": route.kind,
                    "publicName": public_name,
                    "page": route.page,
                    "envelope": route.envelope,
                    "method": route.method,
                    "path": route.path,
                    "pathParams": path_params,
                    "query": query_schema,
                    "body": body_schema,
                    "output": output_schema,
                    "errors": [error.__name__ for error in route.errors],
                    "entity": route.entity,
                    "nodeParams": [name for name in path_params if name == "node"],
                    "stream": route.stream,
                    "bytes": route.response_bytes or (route.stream and route.method == "GET"),
                }
            )
    return {"owner": registration.owner, "prefix": registration.prefix, "operations": operations}


def _owners() -> list[HttpOwner]:
    owners: list[HttpOwner] = []
    seen: set[str] = set()
    for target in HTTP_OWNERS.values():
        registration = frappe.get_attr(target)
        if registration.owner not in seen:
            seen.add(registration.owner)
            owners.append(registration)
    return owners


def _contract_path(owner: str) -> Path:
    if owner == "suite":
        return REPO / "frontend/src/platform/transport/contract.json"
    return REPO / f"frontend/src/apps/{owner}/client/contract.json"


def _union_members(annotation) -> tuple:
    if annotation is None:
        return ()
    if get_origin(annotation) in (types.UnionType, Union):
        return tuple(member for member in get_args(annotation) if member is not type(None))
    return (annotation,)


def _schema(annotation) -> dict | None:
    if annotation is None:
        return None
    try:
        return TypeAdapter(annotation).json_schema()
    except Exception as error:
        raise ValueError(f"Cannot export schema for {annotation}") from error


def _check_page(route, query: dict | None, body: dict | None, output: dict | None) -> None:
    page = route.page
    if page is None:
        return
    fields = {**(query or {}).get("properties", {}), **(body or {}).get("properties", {})}
    result = (output or {}).get("properties", {})
    cursor = (
        set(page) == {"cursor", "rows", "next"}
        and fields.get(page.get("cursor"), {}).get("type") == "string"
        and page.get("next") in result
    )
    offset = (
        set(page) == {"offset", "rows", "total"}
        and fields.get(page.get("offset"), {}).get("type") == "integer"
        and result.get(page.get("total"), {}).get("type") == "integer"
    )
    more = (
        set(page) == {"offset", "rows", "more"}
        and fields.get(page.get("offset"), {}).get("type") == "integer"
        and result.get(page.get("more"), {}).get("type") == "boolean"
    )
    valid = (
        route.kind == "query"
        and all(isinstance(name, str) and name for name in page.values())
        and result.get(page.get("rows"), {}).get("type") == "array"
        and (cursor or offset or more)
    )
    if not valid:
        raise ValueError(f"{route.handler}: invalid page metadata")


def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
