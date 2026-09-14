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
    handlers = import_module(registration.target)
    for route in registration.routes:
        handler = inspect.unwrap(getattr(handlers, route.handler))
        output = route.output or get_type_hints(handler).get("return")
        bodies = _union_members(route.body)
        for body in bodies or (None,):
            operation_id = route.handler
            if len(bodies) > 1:
                operation_id += "." + _snake_case(body.__name__)
            path_params = list(compile_template(route.path).names)
            operations.append(
                {
                    "id": operation_id,
                    "method": route.method,
                    "path": route.path,
                    "pathParams": path_params,
                    "query": _schema(route.query),
                    "body": _schema(body),
                    "output": _schema(output),
                    "errors": [error.__name__ for error in route.errors],
                    "entity": route.entity,
                    "nodeParams": [name for name in path_params if name == "node"],
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
    except Exception:
        return None


def _snake_case(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
