"""Parsing input with Pydantic, failing the way Frappe reports bad input.

Frappe already runs whitelisted arguments through Pydantic, but it widens each annotation with
its default's type (so ``status: Literal["a", "b"] = "a"`` accepts any string), skips
``**kwargs`` and calls made outside a request, and reports a failure as a bare
``FrappeTypeError`` naming the whole annotation. ``parse`` validates explicitly and throws a
``ValidationError`` that says which field is wrong and why.
"""

import json
from html import escape
from typing import Annotated, Any, NoReturn

import frappe
from frappe.utils.typing_validations import TypeAdapter
from pydantic import BeforeValidator, ValidationError


def parse[T](type_: type[T], value: Any, label: str | None = None) -> T:
    """Returns `value` validated as `type_`. `label` names it in the error when it has no field name."""

    try:
        return TypeAdapter(type_).validate_python(value)
    except ValidationError as e:
        _throw(e, label)


def parse_json[T](type_: type[T], text: str | bytes, label: str | None = None) -> T:
    """Returns the JSON document `text` validated as `type_`; malformed JSON fails like a wrong shape."""

    try:
        return TypeAdapter(type_).validate_json(text)
    except ValidationError as e:
        _throw(e, label)


def loads_if_str(value: Any) -> Any:
    """Decodes a JSON string, passing anything else through."""

    return json.loads(value) if isinstance(value, str) else value


def without_blanks(data: Any) -> Any:
    """A dict without its None and "" values, so that field defaults apply to them."""

    if isinstance(data, dict):
        return {key: value for key, value in data.items() if value not in (None, "")}
    return data


# Desk's frappe.call form-encodes a list as a JSON string; frappe-ui sends it as JSON.
type JSONList[T] = Annotated[list[T], BeforeValidator(loads_if_str)]


def _throw(error: ValidationError, label: str | None) -> NoReturn:
    frappe.throw("<br>".join(_describe(e, label) for e in error.errors()))


def _describe(error: dict, label: str | None) -> str:
    # Messages render as HTML and can carry the caller's own values and dict keys. Quotes are
    # left alone: pydantic quotes the values it expects, and nothing here lands in an attribute.
    location = ".".join(str(part) for part in (label, *error["loc"]) if part not in (None, ""))
    message = escape(error["msg"], quote=False)
    return f"{escape(location, quote=False)}: {message}" if location else message
