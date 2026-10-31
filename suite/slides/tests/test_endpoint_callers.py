"""Every Slides endpoint is reachable, or listed here with why it stays.

Removing a page can remove an endpoint's last caller without anything failing.
These tests make that loss show up: an endpoint must be routed, and a route
must be called from app code, unless `RETIRED` says why not.
"""

import ast
import re
from pathlib import Path
from unittest import TestCase

import frappe

from suite.slides.http.routes import CONTRACT_ROUTES

RETIRED = {
    "create_presentation": "kept until end-of-PR check (Q180)",
    "save_presentation_thumbnail": "kept until end-of-PR check (Q180)",
    "get_presentations": "kept until end-of-PR check (Q180)",
    "get_media_file": "live: media URLs point at it directly (MEDIA_PROXY_PATH), not through a route",
    "documents.access": "Drive's session gives the role; only the offline-copy warm list asks it",
    "documents.isComposite": "documents.get returns is_composite",
}

APP = Path(frappe.get_app_path("suite"))
FRONTEND = APP.parent / "frontend" / "src"
TEST_FILE = re.compile(r"\.(test|spec)\.[jt]s$")


def is_whitelist(decorator: ast.expr) -> bool:
    target = decorator
    if isinstance(decorator, ast.Call):
        target = decorator.func

    return isinstance(target, ast.Attribute) and target.attr == "whitelist"


def whitelisted_in(path: Path) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.FunctionDef) and any(map(is_whitelist, node.decorator_list)):
            names.add(node.name)

    return names


def whitelisted_names() -> set[str]:
    names: set[str] = set()
    for path in (APP / "slides").rglob("*.py"):
        if "tests" not in path.parts and not path.name.startswith("test_"):
            names |= whitelisted_in(path)

    return names


def is_app_code(path: Path) -> bool:
    in_client = "client" in path.relative_to(FRONTEND).parts
    return path.suffix in {".js", ".ts", ".vue"} and not in_client and not TEST_FILE.search(path.name)


def app_source() -> str:
    sources: list[str] = []
    for path in FRONTEND.rglob("*"):
        if is_app_code(path):
            sources.append(path.read_text())

    return "\n".join(sources)


def uncalled_routes() -> list[str]:
    source = app_source()
    uncalled: list[str] = []
    for route in CONTRACT_ROUTES:
        name = re.escape(route.public_name)
        caller = rf"api\.slides\.{name}(?!\w)"
        if route.public_name not in RETIRED and not re.search(caller, source):
            uncalled.append(route.public_name)

    return uncalled


class TestEndpointCallers(TestCase):
    def test_every_whitelisted_function_is_routed_or_retired(self):
        routed = {route.handler for route in CONTRACT_ROUTES}

        self.assertEqual(sorted(whitelisted_names() - routed - RETIRED.keys()), [])

    def test_every_route_has_a_caller_in_app_code_or_is_retired(self):
        self.assertEqual(uncalled_routes(), [])
