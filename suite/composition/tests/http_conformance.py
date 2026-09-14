"""Reusable transport conformance tests for Suite HTTP owners."""

from __future__ import annotations

import re
from importlib import import_module

import frappe
from pydantic import TypeAdapter
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from suite.composition.http import HttpOwner, compile_template, dispatch, match_route

_PARAMETER = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)(?::path)?\}")


def translate(registration: HttpOwner, path: str, method: str = "GET", form: dict | None = None):
    """Run one owner table over a real Werkzeug request."""

    request = Request(EnvironBuilder(path=path, method=method).get_environ())
    frappe.local.request = request
    frappe.local.form_dict = frappe._dict(form or {})
    try:
        dispatch(registration)
        return request, frappe.local.form_dict
    finally:
        frappe.local.request = None
        frappe.local.form_dict = frappe._dict()


def handler_of(registration: HttpOwner, request) -> str | None:
    target = "/api/v2/method/" + registration.target + "."
    return request.path[len(target) :] if request.path.startswith(target) else None


def concrete_path(registration: HttpOwner, route) -> tuple[str, dict[str, str]]:
    values: dict[str, str] = {}

    def replace(match):
        name = match.group(1)
        value = "group/member" if ":path}" in match.group(0) else f"{name}-1"
        values[name] = value
        return value

    return registration.prefix + _PARAMETER.sub(replace, route.path), values


class HttpConformanceMixin:
    """Assertions every product-owned table runs unchanged."""

    HTTP: HttpOwner

    def test_conformance_every_route_reaches_its_v2_handler(self):
        for route in self.HTTP.routes:
            path, expected = concrete_path(self.HTTP, route)
            with self.subTest(route=f"{route.method} {route.path}"):
                request, form = translate(self.HTTP, path, route.method)
                self.assertEqual(handler_of(self.HTTP, request), route.handler)
                self.assertEqual(request.environ["PATH_INFO"], request.path)
                for name, value in expected.items():
                    self.assertEqual(form[name], value)

    def test_conformance_path_identifiers_win_over_body_values(self):
        route = next((row for row in self.HTTP.routes if compile_template(row.path).names), None)
        if route is None:
            self.skipTest("table declares no path identifiers")
        path, expected = concrete_path(self.HTTP, route)
        form = {name: "smuggled" for name in expected}
        _request, translated = translate(self.HTTP, path, route.method, form)
        for name, value in expected.items():
            self.assertEqual(translated[name], value)

    def test_conformance_cmd_cannot_replace_a_route_or_unknown_handler(self):
        route = self.HTTP.routes[0]
        path, _expected = concrete_path(self.HTTP, route)
        request, form = translate(self.HTTP, path, route.method, {"cmd": "frappe.client.get_list"})
        self.assertNotIn("cmd", form)
        self.assertEqual(handler_of(self.HTTP, request), route.handler)

        request, form = translate(
            self.HTTP,
            self.HTTP.prefix + "__http_conformance_unknown__",
            "GET",
            {"cmd": "frappe.client.get_list"},
        )
        self.assertNotIn("cmd", form)
        self.assertEqual(handler_of(self.HTTP, request), self.HTTP.unknown)

    def test_conformance_unknown_path_and_method_have_the_owner_404_target(self):
        request, _form = translate(self.HTTP, self.HTTP.prefix + "__http_conformance_unknown__")
        self.assertEqual(handler_of(self.HTTP, request), self.HTTP.unknown)

        route = self.HTTP.routes[0]
        path, _expected = concrete_path(self.HTTP, route)
        relative = path[len(self.HTTP.prefix) :]
        methods = {row.method for row in self.HTTP.routes if match_route(row, relative) is not None}
        method = next(
            candidate
            for candidate in ("GET", "POST", "PUT", "PATCH", "DELETE")
            if candidate not in methods
        )
        request, _form = translate(self.HTTP, path, method)
        self.assertEqual(handler_of(self.HTTP, request), self.HTTP.unknown)

    def test_conformance_table_matches_frappe_whitelisting(self):
        module = import_module(self.HTTP.target)
        for route in self.HTTP.routes:
            handler = getattr(module, route.handler)
            with self.subTest(route=f"{route.method} {route.path}"):
                self.assertIn(handler, frappe.whitelisted)
                allowed = frappe.allowed_http_methods_for_whitelisted_func[handler]
                self.assertIn(route.method, allowed)
                self.assertEqual(handler in frappe.guest_methods, route.allow_guest)

    def test_conformance_declared_errors_have_shared_http_statuses(self):
        statuses = {400, 401, 403, 404, 409, 410, 413, 429}
        for route in self.HTTP.routes:
            for error in route.errors:
                with self.subTest(route=route.path, error=error.__name__):
                    self.assertIn(getattr(error, "http_status_code", None), statuses)

        unknown = getattr(import_module(self.HTTP.target), self.HTTP.unknown)
        with self.assertRaises(Exception) as raised:
            unknown()
        self.assertEqual(getattr(type(raised.exception), "http_status_code", None), 404)

    def test_conformance_page_cursors_are_opaque_strings(self):
        pages = [route for route in self.HTTP.routes if _is_page(route.output)]
        if not pages:
            self.skipTest("table declares no cursor page")
        for route in pages:
            with self.subTest(route=route.path):
                query = TypeAdapter(route.query).json_schema()
                self.assertIn("cursor", query.get("properties", {}))
                output = TypeAdapter(route.output).json_schema()
                self.assertIn("next_cursor", _schema_properties(output))


def _is_page(annotation) -> bool:
    if annotation is None:
        return False
    try:
        return "next_cursor" in _schema_properties(TypeAdapter(annotation).json_schema())
    except Exception:
        return False


def _schema_properties(schema: dict) -> dict:
    if properties := schema.get("properties"):
        return properties
    reference = schema.get("$ref")
    if reference:
        return schema.get("$defs", {}).get(reference.rsplit("/", 1)[-1], {}).get("properties", {})
    return {}
