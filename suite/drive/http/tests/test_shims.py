"""The 69 legacy names of §11.7: what each one is, and what it answers now.

Three things are proved here, and none of them needs a database.

**The inventory is executable.** The 69 names are read out of the legacy
modules with `ast`, not typed into a list, so a name added or removed on that
surface fails this file rather than drifting past it. Every name is classified,
and the guest-callable set is frozen against the 26 §11.7 counts.

**A forwarder forwards.** Each one is called with its own workflow stubbed, and
the assertion is on the arguments it passed and the shape it answered - the
keys the old client reads, under the names it reads them by.

**A retired name refuses.** It answers `DriveRetired` at 410, and it is checked
that nothing was minted and nothing was written on the way there.

`test_dispatch` proves the same names still resolve over real HTTP; the `_core`
suites prove the workflows behind them.
"""

import ast
import inspect
import pathlib
import sys
import unittest
from datetime import datetime
from typing import ClassVar
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase
from frappe.utils import strip_html_tags
from frappe.utils.html_utils import clean_html

from suite.drive._core.errors import (
    DriveConflict,
    DriveForbidden,
    DriveLinkExpired,
    DriveLocked,
    DriveNotFound,
)
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, READ, UPLOAD
from suite.drive.http import shims
from suite.drive.http.tests import ensure_local_context, local_attribute

APP = pathlib.Path(__file__).resolve().parents[3]

# The eleven files §11.7 counts, and the dotted prefix each one is addressed by.
LEGACY_MODULES = {
    "drive/api/files.py": "api.files",
    "drive/api/list.py": "api.list",
    "drive/api/permissions.py": "api.permissions",
    "drive/api/activity.py": "api.activity",
    "drive/api/notifications.py": "api.notifications",
    "drive/api/storage.py": "api.storage",
    "drive/api/scripts.py": "api.scripts",
    "drive/api/embed.py": "api.embed",
    "drive/api/product.py": "api.product",
    "drive/api/s3.py": "api.s3",
    "drive/overrides/file.py": "overrides.file",
}

# §11.7: 26 of the 69 may be reached without a session. Frozen, because
# widening this set is how a private file becomes a public one.
GUEST_CALLABLE = frozenset(
    {
        "api.files.upload_file",
        "api.files.get_thumbnail",
        "api.files.create_auth_token",
        "api.files.get_file_content",
        "api.files.stream_file_content",
        "api.files.download_folder",
        "api.files.download_status",
        "api.files.download_archive",
        "api.files.translate_old_name",
        "api.files.get_entity_type",
        "api.files.redirect_to_original",
        "api.list.files",
        "api.permissions.get_user_access",
        "api.permissions.get_general_access",
        "api.permissions.get_entity_with_permissions",
        "api.embed.get_file_content",
        "api.s3.fetch",
        "api.product.signup",
        "api.product.oauth_providers",
        "api.product.send_otp",
        "api.product.verify_otp",
        "api.product.get_settings",
        "api.product.accept_invite",
        "api.product.get_translations",
        "api.product.disk_settings",
        "api.product.signup_disabled",
    }
)

SOMEONE = Principals(
    user="a@example.com",
    own=("a@example.com", "$GENERAL"),
    open=("$PUBLIC",),
    is_admin=False,
)
GUEST = Principals(user="Guest", own=(), open=("$PUBLIC",), is_admin=False)


def setUpModule():
    ensure_local_context()


def _guest_flags(text: str, prefix: str) -> dict[str, bool]:
    """Read one module's whitelisted names and their `allow_guest` flags."""
    found: dict[str, bool] = {}
    tree = ast.parse(text)

    def walk(node, holder=None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                walk(child, child.name)
            elif isinstance(child, ast.FunctionDef):
                for decorator in child.decorator_list:
                    call = decorator.func if isinstance(decorator, ast.Call) else decorator
                    if getattr(call, "attr", getattr(call, "id", "")) != "whitelist":
                        continue
                    guest = any(
                        keyword.arg == "allow_guest"
                        and isinstance(keyword.value, ast.Constant)
                        and bool(keyword.value.value)
                        for keyword in getattr(decorator, "keywords", [])
                    )
                    found[f"{prefix}.{holder + '.' if holder else ''}{child.name}"] = guest

    walk(tree)
    return found


def shim_entry_points() -> set[str]:
    """Every `shims.<name>` the eleven legacy modules reach for."""
    found: set[str] = set()
    for relative in LEGACY_MODULES:
        tree = ast.parse((APP / relative).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and getattr(node.value, "id", "") == "shims":
                found.add(node.attr)
    return found


def whitelisted_names() -> dict[str, bool]:
    """Read every legacy whitelisted name, and whether a guest may reach it."""
    found: dict[str, bool] = {}
    for relative, prefix in LEGACY_MODULES.items():
        tree = ast.parse((APP / relative).read_text())

        def walk(node, holder=None):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.ClassDef):
                    walk(child, child.name)
                elif isinstance(child, ast.FunctionDef):
                    for decorator in child.decorator_list:
                        call = decorator.func if isinstance(decorator, ast.Call) else decorator
                        if getattr(call, "attr", getattr(call, "id", "")) != "whitelist":
                            continue
                        guest = any(
                            keyword.arg == "allow_guest"
                            and isinstance(keyword.value, ast.Constant)
                            and bool(keyword.value.value)
                            for keyword in getattr(decorator, "keywords", [])
                        )
                        label = f"{prefix}.{holder + '.' if holder else ''}{child.name}"
                        found[label] = guest

        walk(tree)
    return found


# The revision §11.7 is measured against: the last commit before the shim
# landed. A permanent name is one the plan never touches, so "untouched" is
# checked against this tree rather than against a phrase in the body.
BASE_REVISION = "e390a4487"


def _relative_of(name: str) -> tuple[str, str]:
    """Split one dotted legacy name into its module path and its tail."""
    prefix, _dot, tail = name.rpartition(".")
    while prefix not in LEGACY_MODULES.values():
        prefix, _dot, held = prefix.rpartition(".")
        tail = f"{held}.{tail}"
    return next(key for key, value in LEGACY_MODULES.items() if value == prefix), tail


def _function_shape(text: str, wanted: str) -> str:
    """Return one function's structure, ignoring formatting and prose.

    `ast.dump` drops comments and whitespace; the docstring is stripped on top
    of that. What is left is the code, so a reworded comment passes and a
    changed statement, argument, or decorator does not.
    """
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.FunctionDef) and node.name == wanted:
            body = node.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body = body[1:]
            return ast.dump(ast.Module(body=[*node.decorator_list, node.args, *body], type_ignores=[]))
    raise AssertionError(f"{wanted} has no source")


def original_shape(name: str) -> str:
    """Return one legacy function's structure at `BASE_REVISION`."""
    import subprocess

    relative, tail = _relative_of(name)
    text = subprocess.run(
        ["git", "-C", str(APP.parent), "show", f"{BASE_REVISION}:suite/{relative}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return _function_shape(text, tail.split(".")[-1])


def current_shape(name: str) -> str:
    """Return one legacy function's structure in the working tree."""
    relative, tail = _relative_of(name)
    return _function_shape((APP / relative).read_text(), tail.split(".")[-1])


def source_of(name: str) -> str:
    """Return one legacy function's own source text."""
    prefix, _dot, tail = name.rpartition(".")
    while prefix not in LEGACY_MODULES.values():
        prefix, _dot, held = prefix.rpartition(".")
        tail = f"{held}.{tail}"
    relative = next(key for key, value in LEGACY_MODULES.items() if value == prefix)
    text = (APP / relative).read_text()
    tree = ast.parse(text)
    wanted = tail.split(".")[-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == wanted:
            return ast.get_source_segment(text, node) or ""
    raise AssertionError(f"{name} has no source")


def delegated_calls(name: str) -> list[str]:
    """The `shims.<x>` names one legacy function actually calls.

    A substring search for "shims." passes on a comment, so a body that
    re-implements the workflow and says it forwards reads as a forwarder. This
    walks for a real call node instead.
    """
    tree = ast.parse(source_of(name))
    return [
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "shims"
    ]


def node_row(**overrides) -> frappe._dict:
    row = frappe._dict(
        name="n1",
        title="Report.pdf",
        kind="file",
        parent="f1",
        root="r1",
        path="",
        state="Active",
        size=2048,
        mime="application/pdf",
        url=None,
        blob="b1",
        content_doctype=None,
        content_docname=None,
        content_modified=None,
        is_template=0,
        owner="a@example.com",
        creation="2026-01-01 00:00:00",
        modified="2026-01-02 00:00:00",
        modified_by="a@example.com",
    )
    row.update(overrides)
    return row


class _Stdin:
    """`msgprint` asks `sys.stdin.isatty()`, and nothing else about the caller.

    The message a client reads is always cleaned with `clean_html`; the
    exception text is stripped with `strip_html_tags` only when the run has a
    terminal (`frappe/utils/messages.py:77-85`). The site gate found three
    failures that a piped run had passed, so a test that reads whichever
    terminal the runner happens to have proves half the path. This decides it.
    """

    def __init__(self, terminal: bool):
        self.terminal = terminal

    def isatty(self) -> bool:
        return self.terminal


class _MemoryCache:
    """The three cache calls `upload_file` makes, answered from memory.

    Everything else is the real cache. `frappe.cache` is one shared object and
    `frappe._` reads the merged translation dict off it, so replacing the whole
    object with a `MagicMock` makes every translated string a mock. A refusal
    raised under that patch then carries a mock repr, and `msgprint` raises
    `TypeError` out of `strip_html_tags` when the run has a terminal.
    """

    def __init__(self, real):
        self.real = real
        self.values = {}

    def __call__(self):
        return self

    def __getattr__(self, name):
        return getattr(self.real, name)

    def get_value(self, key, *args, **kwargs):
        return self.values.get(key)

    def set_value(self, key, value, *args, **kwargs):
        self.values[key] = value

    def delete_value(self, key, *args, **kwargs):
        self.values.pop(key, None)


class ShimCase(UnitTestCase):
    """Every test runs with the caller fixed and no database in reach."""

    def setUp(self):
        frappe.local.response = frappe._dict()
        frappe.local.message_log = []
        self.caller = patch.object(shims, "_principals", return_value=SOMEONE)
        self.caller.start()
        self.addCleanup(self.caller.stop)
        self.people = patch.object(shims, "_user_info", return_value={})
        self.people.start()
        self.addCleanup(self.people.stop)

    def stub(self, module: str):
        """Replace one `_core` module the shim reaches for."""
        replacement = MagicMock()
        patcher = patch.object(shims, module, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)
        return replacement

    def stub_legacy_inbox(self, rows=()):
        """Answer the pointerless legacy inbox without a database.

        The three notification forwarders read `tabDrive Notification` directly
        for the rows §9.5's activity pointer cannot express. A case about the
        pointer path says so by naming an empty legacy inbox; `_legacy_inbox`
        and `_mark_legacy_read` have cases of their own below.
        """
        read = patch.object(shims, "_legacy_inbox", return_value=list(rows))
        self.addCleanup(read.stop)
        count = patch.object(shims, "_legacy_unread_count", return_value=len(rows))
        self.addCleanup(count.stop)
        write = patch.object(shims, "_mark_legacy_read", return_value=0)
        self.addCleanup(write.stop)
        return read.start(), count.start(), write.start()

    def stub_unadopted_children(self, answer=False):
        """Say the folder holds no legacy row, without a database.

        `list.files` answers a folder that still holds a `File` no node holds
        off both stores, because `writer.api.docs.create_document` writes one.
        A case about the node path says so here; `_merged_folder_page` has
        cases of its own below.
        """
        patcher = patch.object(shims, "_unadopted_children", return_value=answer)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def stub_unadopted_row(self, answer=False):
        """Say the upload destination is a node, without a database.

        `upload_file` writes to the `File` store for a parent no node holds,
        because `writer.api.embed.add` names one. A case about the node path
        says so here; `_legacy_upload` has cases of its own below.
        """
        patcher = patch.object(shims, "_unadopted_row", return_value=answer)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def stub_unadopted_access(self, answer=None):
        """Say no `File` is waiting for this id, without a database.

        `get_user_access` reads the `File` store for an id no node holds, for
        the same reason `get_entity_with_permissions` does. A case about the
        node path says so by naming nothing there; `_legacy_user_access` has
        cases of its own below.
        """
        patcher = patch.object(shims, "_legacy_user_access", return_value=answer)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def stub_unadopted_visit(self, answer=False):
        """Say the visited id is a node, without a database.

        `track_visit` records an open on the `File` store for an id no node
        holds, because every document `create_document` writes is one. A case
        about the node path says so here; `_legacy_visit` has cases of its own
        below.
        """
        patcher = patch.object(shims, "_legacy_visit", return_value=answer)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def stub_unadopted_file(self, answer=None):
        """Say no `File` is waiting for this id, without a database.

        `get_entity_with_permissions` reads the `File` store for an id no node
        holds, because a content type still in the expand phase writes one
        (§10.2). A case about the node path says so by naming nothing there;
        `_legacy_entity_with_permissions` has cases of its own below.
        """
        patcher = patch.object(shims, "_legacy_entity_with_permissions", return_value=answer)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def stub_cache(self):
        """Hold the shim's own upload keys in memory, and leave the rest alone."""
        stub = _MemoryCache(frappe.cache)
        patcher = patch.object(frappe, "cache", stub)
        patcher.start()
        self.addCleanup(patcher.stop)
        return stub


# --------------------------------------------------------------------------
# The inventory
# --------------------------------------------------------------------------


class TestInventory(ShimCase):
    def test_every_whitelisted_name_on_the_legacy_surface_is_classified(self):
        self.assertEqual(set(whitelisted_names()), set(shims.CLASSIFICATION))

    def test_the_surface_is_still_sixty_nine_names(self):
        self.assertEqual(len(shims.CLASSIFICATION), 69)
        self.assertEqual(len(whitelisted_names()), 69)

    def test_the_four_classes_partition_the_surface(self):
        counted = sum(len(shims.names_of(kind)) for kind in ("forwarder", "permanent", "retired", "retained"))
        self.assertEqual(counted, 69)
        self.assertEqual(len(shims.names_of("forwarder")), 37)
        self.assertEqual(len(shims.names_of("permanent")), 21)
        self.assertEqual(len(shims.names_of("retired")), 3)
        self.assertEqual(len(shims.names_of("retained")), 8)

    def test_the_two_permanent_names_of_the_table_are_permanent(self):
        for name in ("api.s3.fetch", "overrides.file.get_file_for_doc"):
            self.assertEqual(shims.CLASSIFICATION[name], "permanent", name)

    def test_no_legacy_name_lives_outside_the_eleven_modules_walked(self):
        """`LEGACY_MODULES` is a frozen list, so something has to notice a new one.

        `whitelisted_names` reads those eleven files. A twelfth `api/*.py`
        module holding a whitelisted name would be a legacy address nothing in
        this file classifies, guards a guest flag on, or hands to Cleanup.
        The whole package is walked here, and the files that may hold one are
        named: the eleven, plus §11.2's own route module.
        """
        allowed = set(LEGACY_MODULES) | {"drive/http/routes.py"}
        found = set()
        for path in (APP / "drive").rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text())):
                if not isinstance(node, ast.FunctionDef):
                    continue
                for decorator in node.decorator_list:
                    call = decorator.func if isinstance(decorator, ast.Call) else decorator
                    if getattr(call, "attr", getattr(call, "id", "")) == "whitelist":
                        found.add(path.relative_to(APP).as_posix())
        self.assertEqual(found, allowed)

    def test_every_forwarder_delegates_and_holds_no_second_implementation(self):
        """A call node, not the text "shims.": a body that re-implements the
        workflow and carries a comment saying it forwards passes a substring
        search."""
        for name in shims.names_of("forwarder"):
            with self.subTest(name=name):
                self.assertTrue(delegated_calls(name), name)

    def test_no_permanent_name_was_rewritten(self):
        for name in shims.names_of("permanent"):
            with self.subTest(name=name):
                self.assertNotIn("shims.", source_of(name))

    def test_every_retained_name_says_why_it_was_retained(self):
        self.assertEqual(set(shims.names_of("retained")), set(shims.RETAINED_REASON))
        for name, reason in shims.RETAINED_REASON.items():
            with self.subTest(name=name):
                self.assertTrue(reason.strip(), name)

    def test_every_retired_name_refuses_through_this_module(self):
        """`_retire` is what raises `DriveRetired` with §11.7's replacement in
        the message. A name that raised on its own would answer a different
        class, a different code, and no replacement."""
        for name in shims.names_of("retired"):
            with self.subTest(name=name):
                delegated = delegated_calls(name)
                self.assertTrue(delegated, name)
                for attr in delegated:
                    self.assertIn("_retire(", inspect.getsource(getattr(shims, attr)))


class TestGuestPosture(ShimCase):
    def test_the_guest_callable_set_is_exactly_the_twenty_six(self):
        guests = {name for name, guest in whitelisted_names().items() if guest}
        self.assertEqual(guests, set(GUEST_CALLABLE))
        self.assertEqual(len(guests), 26)

    def test_no_session_only_name_became_guest_callable(self):
        for name, guest in whitelisted_names().items():
            with self.subTest(name=name):
                self.assertEqual(guest, name in GUEST_CALLABLE)

    def test_a_guest_holds_no_personal_marks_and_no_root(self):
        with patch.object(shims, "_principals", return_value=GUEST):
            self.assertIsNone(shims._own_root(GUEST))


# --------------------------------------------------------------------------
# Retired behavior
# --------------------------------------------------------------------------


class TestRetired(ShimCase):
    def test_create_auth_token_mints_nothing(self):
        with patch.object(shims.frappe, "get_doc") as writer:
            with self.assertRaises(shims.DriveRetired) as caught:
                shims.create_auth_token("n1")
        writer.assert_not_called()
        self.assertEqual(caught.exception.http_status_code, 410)
        self.assertIn("nodes/:id/content", str(caught.exception))

    def test_get_new_title_guesses_no_title(self):
        with self.assertRaises(shims.DriveRetired) as caught:
            shims.get_new_title("Report", "f1")
        self.assertEqual(caught.exception.http_status_code, 410)
        self.assertIn("409", str(caught.exception))

    def test_sync_from_disk_refuses_rather_than_reporting_an_empty_run(self):
        with patch.object(shims.frappe, "get_doc") as writer:
            with self.assertRaises(shims.DriveRetired) as caught:
                shims.sync_from_disk()
        writer.assert_not_called()
        self.assertEqual(caught.exception.http_status_code, 410)

    def test_a_download_token_is_refused_not_honoured(self):
        nodes = self.stub("node_core")
        with self.assertRaises(shims.DriveRetired):
            shims.get_file_content("n1", token="whatever")
        nodes.get.assert_not_called()

    def test_a_retired_refusal_is_a_drive_error(self):
        from suite.drive._core.errors import DriveError

        self.assertTrue(issubclass(shims.DriveRetired, DriveError))


class TestRefusalText(ShimCase):
    """A refusal has to survive the trip to the reader.

    `msgprint` cleans the message it logs, and strips tags from the exception
    as well when the run has a terminal. Both delete everything between angle
    brackets, so a route named `nodes/<id>/content` reached the caller as
    `nodes//content` and told nobody what to call.
    """

    def test_a_retired_name_names_a_route_the_reader_can_still_read(self):
        """`message_log` is what the client renders, and it is cleaned whether
        the run has a terminal or not. The exception text is only stripped on a
        terminal, so asserting on it alone hides the defect from a piped run."""
        refusals = {
            "create_auth_token": lambda: shims.create_auth_token("n1"),
            "get_new_title": lambda: shims.get_new_title("Report", "f1"),
            "sync_from_disk": shims.sync_from_disk,
            "get_file_content token": lambda: shims.get_file_content("n1", token="t"),
        }
        for name, call in refusals.items():
            with self.subTest(name=name):
                frappe.local.message_log = []
                with self.assertRaises(shims.DriveRetired) as caught:
                    call()
                served = frappe.local.message_log[-1]["message"]
                self.assertEqual(served, str(caught.exception))

    def test_the_replacement_route_reaches_the_client_whole(self):
        frappe.local.message_log = []
        with self.assertRaises(shims.DriveRetired):
            shims.create_auth_token("n1")
        self.assertIn(
            "GET /api/suite/drive/nodes/:id/content",
            frappe.local.message_log[-1]["message"],
        )

    def refuse(self, call, terminal: bool):
        """Raise one refusal with the terminal decided, and read both texts.

        `message_log` holds `clean_html(msg)`, which `_server_messages` carries
        to the client. The exception holds `strip_html_tags(msg)`, but only on
        a terminal. A message that survives the trip reads the same in both.
        """
        frappe.local.message_log = []
        with patch("sys.stdin", _Stdin(terminal)):
            with self.assertRaises(frappe.ValidationError) as caught:
                call()
        return frappe.local.message_log[-1]["message"], str(caught.exception)

    def assert_arrives_whole(self, name: str, call, expected: str):
        """The client and the caller both read `expected`, terminal or not."""
        for terminal in (False, True):
            with self.subTest(name=name, terminal=terminal):
                served, raised = self.refuse(call, terminal)
                self.assertEqual(served, expected)
                self.assertEqual(raised, expected)

    def test_a_bad_argument_names_the_type_that_arrived(self):
        """`type([])` is `<class 'list'>` and both cleaners delete all of it,
        so five argument checks named neither what was wanted nor what came.
        `__name__` says the same thing in words that survive."""
        calls = {
            "set_favourite": (
                lambda: shims.set_favourite(entities="n1"),
                "Expected list but got str",
            ),
            "remove_or_restore": (
                lambda: shims.remove_or_restore({"name": "n1"}),
                "Expected list but got dict",
            ),
            "delete_entities": (
                lambda: shims.delete_entities(entity_names=[]),
                "Expected non-empty list but got list",
            ),
            "move": (
                lambda: shims.move(entity_names={}),
                "Expected a non-empty list but got dict",
            ),
            "remove_recents": (
                lambda: shims.remove_recents(entity_names="n1"),
                "Expected list but got str",
            ),
        }
        for name, (call, expected) in calls.items():
            self.assert_arrives_whole(name, call, expected)

    def test_a_refusal_echoes_the_method_the_caller_sent(self):
        """`method` is whatever the legacy client put in the request body."""
        self.stub_unadopted_row()
        self.assert_arrives_whole(
            "update_access",
            lambda: shims.update_access("n1", "<share>"),
            "Drive access method share is not supported",
        )

    def test_a_missing_root_names_the_user_it_looked_for(self):
        """A mail address is written `<a@example.com>` often enough that the
        refusal named nobody at all."""
        roots = self.stub("roots")
        roots.personal_root_for.return_value = None
        roots.provision_personal_root.return_value = None
        addressed = Principals(
            user="<a@example.com>", own=("a@example.com",), open=("$PUBLIC",), is_admin=False
        )
        self.assert_arrives_whole(
            "_home",
            lambda: shims._home(addressed),
            "a@example.com has no personal Drive folder",
        )

    def test_a_workflow_refusal_keeps_its_words_at_the_legacy_boundary(self):
        """`_legacy` throwing again is what puts a `_core` message in front of
        `clean_html` for the first time: a bare `raise` sent no text at all.
        Several `_core` refusals spell an id the caller sent, and a node named
        `a<b>c` cost the message the name it was about."""

        @shims._legacy
        def refused():
            raise DriveNotFound("Drive node a<b>c was not found")

        self.assert_arrives_whole("core refusal", refused, "Drive node abc was not found")

    def test_every_retired_refusal_arrives_whole_on_a_terminal(self):
        """All four, not one. Each names a route, and a route is what the
        reader has to be able to read."""
        download = "Drive signs a download URL at GET /api/suite/drive/nodes/:id/content."
        refusals = {
            "create_auth_token": (
                lambda: shims.create_auth_token("n1"),
                f"suite.drive.api.files.create_auth_token is no longer supported. {download}",
            ),
            "get_file_content token": (
                lambda: shims.get_file_content("n1", token="t"),
                "the suite.drive.api.files.get_file_content download token is no longer "
                f"supported. {download}",
            ),
            "get_new_title": (
                lambda: shims.get_new_title("Report", "f1"),
                "suite.drive.api.files.get_new_title is no longer supported. Drive answers "
                "a sibling collision with a 409 refusal at write time.",
            ),
            "sync_from_disk": (
                shims.sync_from_disk,
                "suite.drive.api.scripts.sync_from_disk is no longer supported. The Drive "
                "Build migration imports the storage tree.",
            ),
        }
        for name, (call, expected) in refusals.items():
            self.assert_arrives_whole(name, call, expected)

    def test_no_message_the_shim_writes_spells_an_angle_bracket(self):
        """Stronger than "carries no HTML tag", and it is the module's rule.
        A lone `<` is escaped by `clean_html` and kept by `strip_html_tags`, so
        the client and the terminal read different words even where no tag is
        formed. A value that arrives at runtime goes through `_spelled`."""
        tree = ast.parse((APP / "drive/http/shims.py").read_text())
        marked = [
            arg.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_"
            for arg in node.args
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
        ]
        self.assertTrue(marked)
        routed = [text for text in marked if "/api/suite/drive/" in text]
        self.assertGreaterEqual(len(routed), 3)
        for text in marked:
            with self.subTest(text=text):
                self.assertNotIn("<", text)
                self.assertNotIn(">", text)

    def test_no_message_the_shim_writes_carries_an_html_tag(self):
        """Every user-facing string in the module is wrapped in `_()`."""
        tree = ast.parse((APP / "drive/http/shims.py").read_text())
        marked = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_"
        ]
        self.assertTrue(marked)
        for node in marked:
            for arg in node.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    with self.subTest(line=node.lineno):
                        self.assertEqual(strip_html_tags(arg.value), arg.value)


# --------------------------------------------------------------------------
# api/permissions.py
# --------------------------------------------------------------------------


class TestPermissionForwarders(ShimCase):
    def test_a_role_becomes_the_five_legacy_bits(self):
        self.assertEqual(
            shims._bits(EDIT),
            {"read": 1, "comment": 1, "upload": 1, "write": 1, "share": 0},
        )
        self.assertEqual(shims._bits(MANAGE)["share"], 1)
        self.assertEqual(shims._bits(READ), {"read": 1, "comment": 0, "upload": 0, "write": 0, "share": 0})
        self.assertEqual(set(shims._bits(0).values()), {0})

    def test_get_user_access_answers_the_caller_role(self):
        nodes = self.stub("node_core")
        access = self.stub("access")
        self.stub_unadopted_access()
        nodes.stored.return_value = node_row(owner="b@example.com")
        access.effective_role.return_value = COMMENT
        answer = shims.get_user_access("n1")
        self.assertEqual(answer["read"], 1)
        self.assertEqual(answer["comment"], 1)
        self.assertEqual(answer["write"], 0)
        self.assertEqual(answer["type"], "guest")

    def test_get_user_access_answers_zeros_for_a_node_the_caller_cannot_see(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_access()
        nodes.stored.side_effect = DriveNotFound("gone")
        self.assertEqual(
            shims.get_user_access("n1"),
            {"read": 0, "comment": 0, "upload": 0, "write": 0, "share": 0, "type": "guest"},
        )

    def test_get_user_access_takes_a_row_as_well_as_an_id(self):
        nodes = self.stub("node_core")
        access = self.stub("access")
        self.stub_unadopted_access()
        nodes.stored.return_value = node_row()
        access.effective_role.return_value = READ
        shims.get_user_access({"name": "n1"})
        nodes.stored.assert_called_once_with("n1")

    def test_the_access_label_names_the_rung_the_bits_come_from(self):
        """Legacy called the owner `admin` and handed them every bit. §5.9
        resolves an owner like anyone else - `_core.access` has no owner rule -
        so an owner holds UPLOAD on a node they created in a folder shared to
        them at UPLOAD. Reading `owner` here made the payload contradict
        itself: `type: "admin"` beside `share: 0`. The bits are the half the
        SPA hides its buttons on, so the label follows them."""
        nodes = self.stub("node_core")
        access = self.stub("access")
        self.stub_unadopted_access()
        nodes.stored.return_value = node_row(owner=SOMEONE.user)
        for role, label in ((MANAGE, "admin"), (EDIT, "user"), (UPLOAD, "guest"), (READ, "guest")):
            with self.subTest(role=role):
                access.effective_role.return_value = role
                answer = shims.get_user_access("n1")
                self.assertEqual(answer["type"], label)
                self.assertEqual(answer["share"], int(role >= MANAGE))

    def test_general_access_reads_public_then_site_then_restricted(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row()
        with patch.object(shims, "_principal_role", side_effect=[READ]):
            self.assertEqual(shims.get_general_access("n1")["type"], "public")
        with patch.object(shims, "_principal_role", side_effect=[0, READ]):
            self.assertEqual(shims.get_general_access("n1")["type"], "site")
        with patch.object(shims, "_principal_role", side_effect=[0, 0]):
            answer = shims.get_general_access("n1")
        self.assertEqual(answer["type"], "restricted")
        self.assertEqual(answer["read"], 0)

    def test_general_access_needs_read_on_the_entity_first(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("gone")
        with self.assertRaises(DriveNotFound):
            shims.get_general_access("n1")

    def test_entity_with_permissions_keeps_the_old_payload(self):
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        access = self.stub("access")
        activity = self.stub("activity_core")
        nodes.get.return_value = node_row()
        access.effective_role.return_value = MANAGE
        nodes.breadcrumbs.return_value = [{"name": "r1", "title": "My Drive"}]
        activity.personal_marks.return_value = {"n1": {"favourite": "fav1", "opened_at": None}}
        with patch.object(shims, "_share_marker", return_value=-2):
            answer = shims.get_entity_with_permissions("n1")

        for key in (
            "name",
            "file_name",
            "folder",
            "file_url",
            "file_size",
            "file_type",
            "is_folder",
            "content_doctype",
            "content_docname",
            "creation",
            "modified",
            "owner",
            "attached_to_doctype",
            "attached_to_name",
            "read",
            "write",
            "share",
            "comment",
            "upload",
            "type",
            "breadcrumbs",
            "is_favourite",
            "share_count",
            "kind",
        ):
            self.assertIn(key, answer)
        self.assertEqual(answer["file_name"], "Report.pdf")
        self.assertEqual(answer["folder"], "f1")
        self.assertEqual(answer["file_size"], 2048)
        self.assertEqual(answer["file_type"], "PDF")
        self.assertEqual(answer["is_folder"], 0)
        self.assertEqual(answer["kind"], "native")
        self.assertEqual(answer["is_favourite"], "n1")
        self.assertEqual(answer["share_count"], -2)

    def test_entity_with_permissions_appends_the_leaf_to_the_trail(self):
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        access = self.stub("access")
        activity = self.stub("activity_core")
        nodes.get.return_value = node_row()
        access.effective_role.return_value = READ
        nodes.breadcrumbs.return_value = [{"name": "r1", "title": "My Drive"}]
        activity.personal_marks.return_value = {}
        with patch.object(shims, "_share_marker", return_value=0):
            answer = shims.get_entity_with_permissions("n1")
        self.assertEqual(
            answer["breadcrumbs"],
            [{"name": "r1", "file_name": "My Drive"}, {"name": "n1", "file_name": "Report.pdf"}],
        )

    def test_entity_with_permissions_still_fills_the_data_envelope(self):
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        access = self.stub("access")
        activity = self.stub("activity_core")
        nodes.get.return_value = node_row()
        access.effective_role.return_value = READ
        nodes.breadcrumbs.return_value = []
        activity.personal_marks.return_value = {}
        with patch.object(shims, "_share_marker", return_value=0):
            answer = shims.get_entity_with_permissions("n1")
        self.assertIs(frappe.response["data"], answer)

    def test_entity_with_permissions_refuses_a_node_that_is_not_active(self):
        """The old query filtered `status: STATUS_ACTIVE`, so a trashed file
        opened as a page said "We couldn't find what you're looking for."
        §8.1 reads a node in any state, which is right for a route that can
        restore one; this name only ever served a page."""
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        self.stub("access")
        for state in ("Trashed", "Purged"):
            with self.subTest(state=state):
                nodes.get.return_value = node_row(state=state)
                with self.assertRaises(DriveNotFound):
                    shims.get_entity_with_permissions("n1")

    def test_entity_with_permissions_refuses_a_missing_id(self):
        with self.assertRaises(DriveNotFound):
            shims.get_entity_with_permissions(None)

    def test_a_link_keeps_its_url_and_a_managed_file_does_not(self):
        link = shims._legacy_row(node_row(kind="link", mime=None, url="https://example.com"))
        self.assertEqual(link["file_type"], "Link")
        self.assertEqual(link["file_url"], "https://example.com")
        managed = shims._legacy_row(node_row(url="/private/files/x"))
        self.assertIsNone(managed["file_url"])

    def test_shared_with_list_puts_the_owner_first_and_hides_the_rest(self):
        access = self.stub("access")
        access.grants_for.return_value = {
            "grants": [
                {"principal": "b@example.com", "role": EDIT},
                {"principal": "$GROUP:Design", "role": READ},
                {"principal": "$PUBLIC", "role": READ},
                {"principal": "$LINK:abcdefghijklmnopqrstuv", "role": EDIT},
                {"principal": "c@example.com", "role": 0},
            ]
        }
        db = MagicMock()
        db.get_value.return_value = "owner@example.com"
        with patch.object(shims.frappe, "db", db):
            with patch.object(shims, "_user_info", side_effect=[{}, {"user": "owner@example.com"}]):
                answer = shims.get_shared_with_list("n1")
        self.assertEqual(answer[0], {"user": "owner@example.com"})
        self.assertEqual([row["user"] for row in answer[1:]], ["$GROUP:Design", "b@example.com"])
        self.assertEqual(answer[1]["is_group"], 1)
        self.assertEqual(answer[1]["full_name"], "Design")
        self.assertEqual(answer[2]["write"], 1)

    def test_shared_with_list_asks_the_workflow_for_the_manage_gate(self):
        self.stub_unadopted_row()
        access = self.stub("access")
        access.grants_for.side_effect = DriveNotFound("gone")
        with self.assertRaises(DriveNotFound):
            shims.get_shared_with_list("n1")


class TestUnadoptedFolderPage(ShimCase):
    """`list.files` over both stores, for a folder that still holds a legacy row.

    `writer.api.docs.create_document` writes a `File` with no node into the
    caller's `Users/<email>` folder, and the trail
    `get_entity_with_permissions` publishes for that document names the
    folders it is in. Opening one met `node_core.children`, which refuses a
    parent no node holds, and after Build it answers a page the new row is
    not on.
    """

    @staticmethod
    def shaped(name, file_name, size=0, modified="2026-01-01 00:00:00"):
        return {"name": name, "file_name": file_name, "file_size": size, "modified": modified}

    def merge(self, *, adopted, legacy, node_rows=(), over=False):
        """Name what each store holds for one folder, without a database."""
        db = MagicMock()
        db.exists.return_value = adopted
        self.enterContext(patch.object(shims.frappe, "db", db))
        self.enterContext(patch.object(shims, "_unadopted_children", return_value=True))
        self.enterContext(patch.object(shims, "_legacy_children", return_value=(list(legacy), over)))
        self.enterContext(patch.object(shims, "_legacy_list_rows", side_effect=lambda _, rows: list(rows)))
        nodes = self.stub("node_core")
        nodes.MAX_PAGE_SIZE = 100
        nodes.children.return_value = {"rows": list(node_rows), "next_cursor": None}
        return nodes

    def test_a_column_sorts_by_the_name_the_client_is_shown(self):
        """`_ordered` sorts §11.4's node columns. The merged page has one row
        shape in common with itself and it is the answer's, so the sort reads
        `file_name`, `file_size`, and `modified`."""
        rows = [
            self.shaped("n2", "beta", size=3, modified="2026-01-02 00:00:00"),
            self.shaped("n1", "alpha", size=9, modified="2026-01-01 00:00:00"),
        ]
        by_name = [row["name"] for row in shims._ordered_legacy(rows, "file_name", True)]
        self.assertEqual(by_name, ["n1", "n2"])
        by_size = [row["name"] for row in shims._ordered_legacy(rows, "file_size", True)]
        self.assertEqual(by_size, ["n2", "n1"])
        by_time = [row["name"] for row in shims._ordered_legacy(rows, "modified", False)]
        self.assertEqual(by_time, ["n2", "n1"])

    def test_an_unknown_column_falls_back_to_the_one_the_row_publishes(self):
        rows = [
            self.shaped("n1", "alpha", modified="2026-01-02 00:00:00"),
            self.shaped("n2", "beta", modified="2026-01-01 00:00:00"),
        ]
        self.assertEqual(
            [row["name"] for row in shims._ordered_legacy(rows, "Owner", True)],
            ["n2", "n1"],
        )

    def test_the_id_breaks_a_tie_the_title_cannot(self):
        """Three levels, the old query's: the column, then `file_name` in the
        same direction, then `name` ascending."""
        rows = [self.shaped("n2", "same"), self.shaped("n1", "same")]
        self.assertEqual(
            [row["name"] for row in shims._ordered_legacy(rows, "file_name", True)],
            ["n1", "n2"],
        )

    def test_a_folder_with_no_legacy_row_never_reads_the_file_store(self):
        """The probe is what keeps an adopted tree on the SQL-sorted window
        §11.4 measured."""
        self.stub_unadopted_children(False)
        nodes = self.stub("node_core")
        self.stub("access")
        self.stub("activity_core")
        nodes.children.return_value = {"rows": [], "next_cursor": None}
        with patch.object(shims, "_merged_folder_page") as merged:
            shims.files("f1")
        merged.assert_not_called()
        nodes.children.assert_called()

    def test_a_folder_no_node_holds_is_answered_off_the_file_store_alone(self):
        nodes = self.merge(adopted=False, legacy=[self.shaped("l1", "Legacy")])
        answer = shims.files("f1")
        self.assertEqual([row["name"] for row in answer], ["l1"])
        nodes.children.assert_not_called()

    def test_a_folder_a_node_holds_still_shows_the_row_written_since(self):
        """After Build the folder is a node and the documents written since
        are the only rows the node half cannot see."""
        self.merge(
            adopted=True,
            legacy=[self.shaped("l1", "beta")],
            node_rows=[self.shaped("n1", "alpha")],
        )
        answer = shims.files("f1", order_by="file_name")
        self.assertEqual([row["name"] for row in answer], ["n1", "l1"])

    def test_the_merged_page_answers_the_old_envelope(self):
        self.merge(
            adopted=True,
            legacy=[self.shaped("l1", "b"), self.shaped("l2", "d")],
            node_rows=[self.shaped("n1", "a"), self.shaped("n2", "c")],
        )
        page = shims.files("f1", order_by="file_name", limit=2, paginated=True)
        self.assertEqual([row["name"] for row in page["rows"]], ["n1", "l1"])
        self.assertTrue(page["has_next"])
        self.assertEqual(page["next_start"], 2)

        rest = shims.files("f1", order_by="file_name", start=2, limit=2, paginated=True)
        self.assertEqual([row["name"] for row in rest["rows"]], ["n2", "l2"])
        self.assertFalse(rest["has_next"])

    def test_a_page_that_stopped_at_a_bound_still_says_there_is_more(self):
        """Past the bound neither half is the whole match set, so the page
        length cannot say there is nothing after it."""
        self.merge(adopted=False, legacy=[self.shaped("l1", "a")], over=True)
        page = shims.files("f1", paginated=True)
        self.assertTrue(page["has_next"])


class TestUnadoptedFolderGate(ShimCase):
    """`_legacy_children`: the old body's read, and the old body's gate."""

    def store(self, *, readable=True, rows=()):
        from suite.drive.api import list as legacy_list
        from suite.drive.api import permissions

        self.enterContext(patch.object(shims.frappe, "qb", MagicMock()))
        self.enterContext(patch.object(legacy_list, "_get_basic_query", MagicMock()))
        data = MagicMock(return_value=list(rows))
        self.enterContext(patch.object(legacy_list, "get_query_data", data))
        gate = MagicMock(return_value=readable)
        self.enterContext(patch.object(permissions, "user_has_permission", gate))
        return data, gate

    def test_a_folder_on_this_store_alone_keeps_the_old_gate(self):
        """`PermissionError` is the class `ErrorPage.vue` sends a signed-out
        visitor to the login page on, and it is what the old body threw."""
        _, gate = self.store(readable=False)
        with self.assertRaises(frappe.PermissionError):
            shims._legacy_children("f1", order_by="modified", ascending=True, file_kinds=None, adopted=False)
        gate.assert_called_once_with("f1", "read")

    def test_an_adopted_folder_is_gated_by_the_store_that_holds_it(self):
        """`node_core.children` reads and authorizes the folder. Asking the
        legacy rules a second time would let one store refuse a page the
        other had already granted."""
        _, gate = self.store(readable=False)
        rows, _ = shims._legacy_children(
            "f1", order_by="modified", ascending=True, file_kinds=None, adopted=True
        )
        gate.assert_not_called()
        self.assertEqual(rows, [])

    def test_the_read_is_the_old_query_run_whole_and_bounded(self):
        data, _ = self.store(rows=[{"name": f"l{n}"} for n in range(3)])
        shims._legacy_children("f1", order_by="file_name", ascending=False, file_kinds=["PDF"], adopted=False)
        self.assertEqual(data.call_args.kwargs["entity_name"], "f1")
        self.assertEqual(data.call_args.kwargs["order_by"], "file_name")
        self.assertFalse(data.call_args.kwargs["ascending"])
        self.assertEqual(data.call_args.kwargs["file_kinds"], ["PDF"])
        self.assertFalse(data.call_args.kwargs["paginated"])
        self.assertEqual(data.call_args.kwargs["limit"], shims.MAX_SORTABLE_ROWS + 1)

    def test_a_read_that_reached_the_bound_says_so_and_is_cut_to_it(self):
        self.store(rows=[{"name": f"l{n}"} for n in range(shims.MAX_SORTABLE_ROWS + 1)])
        rows, over = shims._legacy_children(
            "f1", order_by="modified", ascending=True, file_kinds=None, adopted=False
        )
        self.assertEqual(len(rows), shims.MAX_SORTABLE_ROWS)
        self.assertTrue(over)


class TestUnadoptedUploadTarget(ShimCase):
    """`upload_file` writes to the store that holds the destination.

    `writer.api.embed.add` uploads a picture into the document the editor has
    open, and a document `writer.api.docs.create_document` wrote is a `File`
    with no node. `upload_core.create_upload` reads the parent as a node, so
    the node branch refuses every picture added to a document the product
    itself creates.
    """

    def store(self, *, node=False, file=True):
        db = MagicMock()
        db.exists.side_effect = lambda doctype, name: node if doctype == "Drive Node" else file
        self.enterContext(patch.object(shims.frappe, "db", db))
        return db

    def test_an_id_a_node_holds_is_not_an_unadopted_row(self):
        db = self.store(node=True)
        self.assertFalse(shims._unadopted_row("f1"))
        db.exists.assert_called_once_with("Drive Node", "f1")

    def test_an_id_only_the_file_store_holds_is_an_unadopted_row(self):
        self.store()
        self.assertTrue(shims._unadopted_row("f1"))

    def test_an_id_neither_store_holds_is_not_an_unadopted_row(self):
        """An unknown parent keeps the workflow's own refusal. The legacy
        write must not be reached by naming something that is not there."""
        self.store(file=False)
        self.assertFalse(shims._unadopted_row("f1"))
        self.assertFalse(shims._unadopted_row(None))

    def test_a_node_less_parent_is_written_to_the_file_store(self):
        uploads = self.stub("upload_core")
        self.stub("node_core")
        self.stub_unadopted_row(True)
        with patch.object(shims, "_legacy_upload", return_value={"name": "e1"}) as legacy:
            answer = shims.upload_file(parent="d1", total_file_size=12, file_modified=1, embed=1)
        self.assertEqual(answer, {"name": "e1"})
        uploads.create_upload.assert_not_called()
        self.assertEqual(legacy.call_args.kwargs["parent"], "d1")
        self.assertEqual(legacy.call_args.kwargs["total_file_size"], 12)
        self.assertEqual(legacy.call_args.kwargs["file_modified"], 1)
        self.assertEqual(legacy.call_args.kwargs["embed"], 1)

    def test_a_node_parent_is_never_written_to_the_file_store(self):
        nodes = self.stub("node_core")
        uploads = self.stub("upload_core")
        nodes.stored.return_value = node_row()
        uploads.create_upload.return_value = {"upload_id": "u1", "mode": "chunked"}
        uploads.finish_upload.return_value = "n1"
        upload = MagicMock()
        upload.filename = "Report.pdf"
        upload.mimetype = "application/pdf"
        upload.stream.read.return_value = b"x" * 12
        self.enterContext(local_attribute("request", MagicMock(files={"file": upload})))
        self.enterContext(local_attribute("form_dict", frappe._dict()))
        self.stub_cache()
        self.stub_unadopted_row()
        with (
            patch.object(shims, "_legacy_upload") as legacy,
            patch.object(shims, "_legacy_list_rows", return_value=[{"name": "n1"}]),
            patch.object(shims.frappe, "publish_realtime"),
        ):
            shims.upload_file(parent="f1")
        legacy.assert_not_called()

    def test_a_directory_upload_into_a_node_less_parent_walks_the_file_store(self):
        """A `fullpath` names folders to create. `create_folder` answers a
        legacy parent again, so the old walk works whole and the file lands in
        the deepest folder it made."""
        self.stub("node_core")
        uploads = self.stub("upload_core")
        self.stub_unadopted_row(True)
        with (
            patch.object(shims, "_legacy_ensure_path", return_value="d2") as walk,
            patch.object(shims, "_legacy_upload", return_value={"name": "e1"}) as legacy,
        ):
            shims.upload_file(parent="d1", fullpath="pictures/cat.png")
        walk.assert_called_once_with("pictures/cat.png", "d1")
        self.assertEqual(legacy.call_args.kwargs["parent"], "d2")
        uploads.create_upload.assert_not_called()

    def test_the_walk_is_the_old_body_and_answers_its_deepest_folder(self):
        from suite.drive.api import files as legacy_files
        from suite.drive.api import permissions

        with (
            patch.object(shims, "_", side_effect=lambda text: text),
            patch.object(legacy_files, "ensure_path", return_value="d2") as walk,
            patch.object(permissions, "user_has_permission", return_value=True),
        ):
            self.assertEqual(shims._legacy_ensure_path("pictures/cat.png", "d1"), "d2")
        walk.assert_called_once_with("pictures/cat.png", "d1")

    def test_the_walk_is_gated_by_the_rule_that_wrote_the_folder(self):
        """The old body checked upload on the parent the caller named, before
        it walked. Nothing is created for a caller the folder refuses."""
        from suite.drive.api import files as legacy_files
        from suite.drive.api import permissions

        with (
            patch.object(shims, "_", side_effect=lambda text: text),
            patch.object(legacy_files, "ensure_path") as walk,
            patch.object(permissions, "user_has_permission", return_value=False) as gate,
        ):
            with self.assertRaises(frappe.PermissionError):
                shims._legacy_ensure_path("pictures/cat.png", "d1")
        gate.assert_called_once_with("d1", "upload")
        walk.assert_not_called()


class TestUnadoptedAccessRead(ShimCase):
    """`_legacy_user_access`: the `File` store, for an id no node holds.

    The same second store `TestUnadoptedFileRead` covers below, reached by the
    name three Writer reads are built on. Zeros for a row the caller owns is a
    deny §11.7 may not synthesize, and it is what the node read answers for an
    id it cannot find.
    """

    OWNS: ClassVar[dict] = {"read": 1, "write": 1, "comment": 1, "share": 1, "upload": 1, "type": "admin"}

    def store(self, *, node=False, file=True, access=None):
        """Name what each store holds, and answer the legacy access rule."""
        from suite.drive.api import permissions

        db = MagicMock()
        db.exists.side_effect = lambda doctype, name: node if doctype == "Drive Node" else file
        self.enterContext(patch.object(shims.frappe, "db", db))
        bits = MagicMock(return_value=dict(access or self.OWNS))
        self.enterContext(patch.object(permissions, "get_user_access_for_user", bits))
        return db, bits

    def test_an_id_a_node_holds_is_not_read_off_the_file_store(self):
        """The store is decided by which one holds the id. Asking the legacy
        rule about a row that has a node would answer twice about one row."""
        db, bits = self.store(node=True)
        self.assertIsNone(shims._legacy_user_access("n1"))
        bits.assert_not_called()
        db.exists.assert_called_once_with("Drive Node", "n1")

    def test_an_id_neither_store_holds_answers_nothing(self):
        _, bits = self.store(file=False)
        self.assertIsNone(shims._legacy_user_access("n1"))
        bits.assert_not_called()

    def test_the_owner_of_a_node_less_row_holds_every_bit_the_old_rule_gave_them(self):
        """The defect this read exists for. `create_document` writes a `File`
        with no node on every site running this commit, and the node read
        answers all-zeros for it, which is a deny nobody wrote."""
        _, bits = self.store()
        self.assertEqual(shims._legacy_user_access("n1"), self.OWNS)
        bits.assert_called_once_with("n1", frappe.session.user)

    def test_a_row_is_passed_on_rather_than_read_again(self):
        """The old body took the row `_visible_rows` had already selected."""
        _, bits = self.store()
        row = {"name": "n1", "owner": SOMEONE.user}
        shims._legacy_user_access(row)
        self.assertIs(bits.call_args.args[0], row)

    def test_the_forwarder_answers_the_file_row_without_reading_a_node(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_access(dict(self.OWNS))
        self.assertEqual(shims.get_user_access("n1"), self.OWNS)
        nodes.stored.assert_not_called()

    def test_a_refusal_from_the_workflow_is_never_retried_on_the_file_store(self):
        """§5.2 answers `DriveNotFound` for a node the caller may not read.
        The zeros below it are the old body's answer to that question, not a
        second question put to the legacy rules."""
        nodes = self.stub("node_core")
        nodes.stored.side_effect = DriveNotFound("not for you")
        legacy = self.stub_unadopted_access()
        self.assertEqual(shims.get_user_access("n1")["read"], 0)
        legacy.assert_called_once_with("n1")

    def test_a_name_less_entity_reads_neither_store(self):
        _, bits = self.store()
        self.assertIsNone(shims._legacy_user_access(None))
        self.assertIsNone(shims._legacy_user_access({}))
        bits.assert_not_called()


class TestUnadoptedRename(ShimCase):
    """`_legacy_rename`: the title, for an id no node holds.

    `CoreEditor.vue` renames an untitled document from its first line on the
    first Enter, so the forwarder's refusal reached a reader who had made no
    gesture at all: a red toast reading "Drive node <id> was not found" while
    they were typing.
    """

    def rows(self, *, unadopted=True):
        row = MagicMock()
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=unadopted))
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        answer = MagicMock(return_value={"name": "f1", "file_name": "New.md"})
        self.enterContext(patch.object(shims, "_legacy_file_row", answer))
        return row, answer

    def test_a_node_less_row_is_renamed_by_the_rule_that_named_it(self):
        row, answer = self.rows()
        nodes = self.stub("node_core")
        self.assertEqual(shims.rename("f1", "New.md")["file_name"], "New.md")
        row.rename.assert_called_once_with("New.md")
        nodes.update.assert_not_called()
        answer.assert_called_once_with("f1")

    def test_an_id_a_node_holds_is_renamed_by_the_workflow(self):
        row, _ = self.rows(unadopted=False)
        nodes = self.stub("node_core")
        nodes.stored.return_value = node_row(title="New.md")
        shims.rename("n1", "New.md")
        nodes.update.assert_called_once_with(SOMEONE, "n1", title="New.md")
        row.rename.assert_not_called()


class TestUnadoptedTrash(ShimCase):
    """`_LegacyTrash`: trash and restore, for ids no node holds.

    Writer's own `RemoveDialog.vue` names the document the editor has open, so
    Delete refused every document the product creates.
    """

    def store(self, *, unadopted=True):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=unadopted))
        toggle = MagicMock()
        self.enterContext(patch("suite.drive.api.files.toggle_entity_status", toggle))
        manager = MagicMock()
        self.enterContext(patch("suite.drive.utils.files.FileManager", manager))
        rows = MagicMock(side_effect=lambda doctype, name: name)
        self.enterContext(patch.object(shims.frappe, "get_doc", rows))
        return toggle, manager

    def test_a_node_less_row_is_toggled_by_the_rule_that_wrote_it(self):
        toggle, _ = self.store()
        nodes = self.stub("node_core")
        shims.remove_or_restore(["f1"])
        self.assertEqual(toggle.call_args.args[0], "f1")
        nodes.update.assert_not_called()

    def test_one_manager_and_one_lock_set_serve_the_whole_list(self):
        """The old body built both once for the list, so two files owned by
        one person lock that person's storage once."""
        toggle, manager = self.store()
        self.stub("node_core")
        shims.remove_or_restore(["f1", "f2"])
        self.assertEqual(manager.call_count, 1)
        managers = {id(call.args[1]) for call in toggle.call_args_list}
        locks = {id(call.args[2]) for call in toggle.call_args_list}
        self.assertEqual(len(managers), 1)
        self.assertEqual(len(locks), 1)

    def test_a_list_of_nodes_builds_no_manager_at_all(self):
        _, manager = self.store(unadopted=False)
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(state="Active")
        shims.remove_or_restore(["n1"])
        manager.assert_not_called()
        nodes.update.assert_called_once_with(SOMEONE, "n1", state="Trashed")


class TestUnadoptedShare(ShimCase):
    """The three sharing names, for an id no node holds.

    Writer's `ShareDialog.vue` and `InfoDialog.vue` open on the document the
    editor has, so Share and Show Info refused every document the product
    creates.
    """

    def store(self, *, unadopted=True):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=unadopted))
        row = MagicMock()
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        return row

    def test_a_node_less_row_is_shared_by_the_rule_that_wrote_it(self):
        row = self.store()
        access = self.stub("access")
        shims.update_access("f1", "share", user="b@example.com", read=1, comment=1)
        row.share.assert_called_once_with(user="b@example.com", read=1, comment=1)
        access.grant.assert_not_called()

    def test_the_caller_spelling_of_the_public_principal_is_kept(self):
        """`File.share` reads `""` as anyone with the link. Handing it the
        `$PUBLIC` the node path normalises to would write a row for a user of
        that name."""
        row = self.store()
        self.stub("access")
        shims.update_access("f1", "share", user="", read=1)
        self.assertEqual(row.share.call_args.kwargs["user"], "")

    def test_a_node_less_row_is_unshared_by_the_rule_that_wrote_it(self):
        row = self.store()
        access = self.stub("access")
        shims.update_access("f1", "unshare", user="b@example.com")
        row.unshare.assert_called_once_with(user="b@example.com")
        access.revoke.assert_not_called()

    def test_an_unknown_method_is_still_refused_on_the_file_store(self):
        self.store()
        self.stub("access")
        with self.assertRaises(frappe.ValidationError):
            shims.update_access("f1", "publish", read=1)

    def test_a_share_link_is_refused_before_either_store_is_named(self):
        """§11.7 retires the capability, so the store makes no difference."""
        row = self.store()
        self.stub("access")
        with self.assertRaises(frappe.ValidationError):
            shims.update_access("f1", "share", user="$LINK")
        row.share.assert_not_called()

    def test_the_general_access_of_a_node_less_row_is_the_old_three_answers(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        from suite.drive.api import permissions

        bits = MagicMock(
            side_effect=[
                {"read": 1},
                {"read": 0},
                {"read": 1, "write": 0, "comment": 0, "share": 0, "upload": 0},
            ]
        )
        self.enterContext(patch.object(permissions, "get_user_access_for_user", bits))
        nodes = self.stub("node_core")

        self.assertEqual(shims.get_general_access("f1")["type"], "site")

        nodes.get.assert_not_called()
        self.assertEqual(
            [call.args[1] for call in bits.call_args_list], [frappe.session.user, "Guest", "$GENERAL"]
        )

    def test_a_caller_who_cannot_read_a_node_less_row_is_refused(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        from suite.drive.api import permissions

        self.enterContext(
            patch.object(permissions, "get_user_access_for_user", MagicMock(return_value={"read": 0}))
        )
        self.stub("node_core")
        with self.assertRaises(frappe.PermissionError):
            shims.get_general_access("f1")

    def test_the_shared_with_list_of_a_node_less_row_reads_the_old_rows(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        from suite.drive.api import permissions

        self.enterContext(patch.object(permissions, "user_has_permission", MagicMock(return_value=True)))
        rows = MagicMock(return_value=[frappe._dict(user="$GROUP:Team", read=1)])
        self.enterContext(patch.object(shims.frappe, "get_all", rows))
        self.enterContext(patch.object(shims.frappe, "db", MagicMock()))
        self.enterContext(patch.object(shims, "_user_info", MagicMock(return_value={})))
        access = self.stub("access")

        people = shims.get_shared_with_list("f1")

        access.grants_for.assert_not_called()
        self.assertEqual(people[0]["is_group"], 1)
        self.assertEqual(people[0]["full_name"], "Team")

    def test_a_caller_without_the_share_bit_is_refused_the_list(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        from suite.drive.api import permissions

        self.enterContext(patch.object(permissions, "user_has_permission", MagicMock(return_value=False)))
        self.stub("access")
        with self.assertRaises(frappe.PermissionError):
            shims.get_shared_with_list("f1")


class TestUnadoptedContent(ShimCase):
    """`_legacy_file_content`: the bytes, for an id no node holds.

    `list.files` opens a folder no node holds, so the files it already held are
    on a page again and clicking one asks for its bytes.
    """

    def store(self, *, row=None):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        self.enterContext(
            patch("suite.drive.api.permissions.user_has_permission", MagicMock(return_value=True))
        )
        self.enterContext(
            patch.object(shims.frappe, "get_value", MagicMock(return_value=row and frappe._dict(row)))
        )
        served = MagicMock(return_value="bytes")
        self.enterContext(patch("suite.drive.api.files.get_file_internal", served))
        return served

    def test_a_node_less_row_is_served_by_the_old_reader(self):
        served = self.store(row={"name": "f1", "file_type": "Image", "status": "Active"})
        nodes = self.stub("node_core")
        self.assertEqual(shims.get_file_content("f1"), "bytes")
        nodes.signed_content_url.assert_not_called()
        self.assertEqual(served.call_args.args[0].name, "f1")

    def test_a_node_less_document_is_not_downloadable(self):
        """`Document` is a forbidden download type, so the old body answered
        "Not found" and never reached its own redirect to the editor. No
        client asks this name about a document."""
        served = self.store(row={"name": "f1", "file_type": "Document", "status": "Active"})
        self.stub("node_core")
        with self.assertRaises(frappe.DoesNotExistError):
            shims.get_file_content("f1")
        served.assert_not_called()

    def test_a_trashed_node_less_row_is_not_found(self):
        self.store(row={"name": "f1", "file_type": "Image", "status": "Trashed"})
        self.stub("node_core")
        with self.assertRaises(frappe.DoesNotExistError):
            shims.get_file_content("f1")

    def test_a_retired_token_is_refused_before_either_store(self):
        self.stub("node_core")
        with self.assertRaises(frappe.ValidationError):
            shims.get_file_content("f1", token="t1")


class TestUnadoptedPurge(ShimCase):
    """`delete_entities` and `does_entity_exist`, for ids no node holds.

    `writer/utils/docximporter.js` rolls back the pictures a failed import
    uploaded, and every one of those is a `File` under the document.
    """

    def test_a_named_node_less_row_is_purged_by_the_rule_that_wrote_it(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        row = MagicMock()
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        nodes = self.stub("node_core")
        shims.delete_entities(["f1"])
        row.permanent_delete.assert_called_once_with()
        nodes.purge.assert_not_called()

    def test_clearing_the_trash_still_names_only_the_node_view(self):
        """§11.2 has no trash view for the `File` store, and listing one here
        would be a view this shim invented."""
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=False))
        self.enterContext(patch.object(shims, "_home", return_value="r1"))
        nodes = self.stub("node_core")
        nodes.views.return_value = {"rows": [], "next_cursor": None}
        shims.delete_entities(clear_all=True)
        nodes.purge.assert_not_called()

    def test_a_node_less_folder_answers_the_name_check_off_the_old_table(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        self.enterContext(
            patch("suite.drive.api.permissions.user_has_permission", MagicMock(return_value=True))
        )
        db = MagicMock()
        db.exists.return_value = "f2"
        self.enterContext(patch.object(shims.frappe, "db", db))
        nodes = self.stub("node_core")
        self.assertTrue(shims.does_entity_exist("Notes.txt", "f1"))
        nodes.title_taken.assert_not_called()

    def test_the_name_check_keeps_the_upload_gate_on_the_old_table(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        self.enterContext(
            patch("suite.drive.api.permissions.user_has_permission", MagicMock(return_value=False))
        )
        self.stub("node_core")
        with self.assertRaises(frappe.PermissionError):
            shims.does_entity_exist("Notes.txt", "f1")


class TestUnadoptedNewFolder(ShimCase):
    """`_legacy_create_folder`: a folder under a parent no node holds."""

    def test_a_node_less_parent_takes_a_file_folder(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock()))
        self.enterContext(
            patch("suite.drive.api.permissions.user_has_permission", MagicMock(return_value=True))
        )
        self.enterContext(patch("suite.drive.utils.validate_filename", MagicMock()))
        self.enterContext(patch("suite.drive.utils.files.FileManager", MagicMock()))
        self.enterContext(patch("suite.drive.utils.files.storage_key", MagicMock(return_value="")))
        made = MagicMock(return_value=frappe._dict(name="f2"))
        self.enterContext(patch("suite.drive.utils.create_drive_file", made))
        answer = MagicMock(return_value={"name": "f2"})
        self.enterContext(patch.object(shims, "_legacy_file_row", answer))
        nodes = self.stub("node_core")

        self.assertEqual(shims.create_folder("Reports", "f1")["name"], "f2")

        nodes.create_folder.assert_not_called()
        self.assertEqual(made.call_args.args[:3], ("Reports", "f1", "Folder"))

    def test_a_node_less_parent_takes_a_file_link(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=True))
        self.enterContext(
            patch("suite.drive.api.permissions.user_has_permission", MagicMock(return_value=True))
        )
        self.enterContext(patch("suite.drive.utils.validate_filename", MagicMock()))
        self.enterContext(patch.object(shims.frappe.utils, "now_datetime", MagicMock()))
        row = MagicMock()
        row.name = "f2"
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        self.enterContext(patch.object(shims, "_legacy_file_row", MagicMock(return_value={"name": "f2"})))
        nodes = self.stub("node_core")

        self.assertEqual(shims.create_link("Docs", "https://example.com", "f1")["name"], "f2")

        nodes.create_link.assert_not_called()
        row.insert.assert_called_once_with()

    def test_a_parent_a_node_holds_is_still_the_workflow(self):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=False))
        nodes = self.stub("node_core")
        nodes.stored.return_value = node_row()
        shims.create_folder("Reports", "n1")
        nodes.create_folder.assert_called_once_with(SOMEONE, "n1", "Reports")


class TestUnadoptedFavourite(ShimCase):
    """`_legacy_favourite`: the caller's own mark, for an id no node holds."""

    def store(self, *, unadopted=True, held=False):
        self.enterContext(patch.object(shims, "_unadopted_row", return_value=unadopted))
        db = MagicMock()
        db.exists.return_value = "mark-1" if held else None
        self.enterContext(patch.object(shims.frappe, "db", db))
        doc = MagicMock()
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=doc)))
        drop = MagicMock()
        self.enterContext(patch.object(shims.frappe, "delete_doc", drop))
        return doc, drop

    def test_a_node_less_row_is_marked_on_the_old_table(self):
        doc, _ = self.store()
        activity = self.stub("activity_core")
        shims.set_favourite([{"name": "f1", "is_favourite": True}])
        doc.insert.assert_called_once_with()
        activity.set_favourite.assert_not_called()

    def test_a_mark_the_caller_already_holds_is_dropped(self):
        _, drop = self.store(held=True)
        self.stub("activity_core")
        shims.set_favourite([{"name": "f1", "is_favourite": False}])
        drop.assert_called_once_with("Drive Favourite", "mark-1")

    def test_a_silent_client_still_toggles_the_old_table(self):
        """The old body toggled when the client named no value, and the mark
        it read is the caller's own row, not a node's."""
        doc, _ = self.store(held=False)
        self.stub("activity_core")
        shims.set_favourite([{"name": "f1"}])
        doc.insert.assert_called_once_with()

    def test_clearing_everything_clears_both_stores(self):
        _, drop = self.store(held=True)
        activity = self.stub("activity_core")
        activity.favourites.return_value = {"rows": [], "next_cursor": None}
        self.enterContext(patch.object(shims, "_legacy_favourites_held", return_value=["f1", "f2"]))
        shims.set_favourite(clear_all=True)
        self.assertEqual([call.args[1] for call in drop.call_args_list], ["mark-1", "mark-1"])
        activity.favourites.assert_called()


class TestUnadoptedMove(ShimCase):
    """`_legacy_move`: the folder, for rows no node holds.

    The two stores are two trees until Build joins them, so a move that
    crosses is refused by name rather than performed against a guess.
    """

    def store(self, unadopted):
        self.enterContext(patch.object(shims, "_unadopted_row", side_effect=unadopted))
        row = MagicMock()
        row.move.return_value = {"file_name": "Reports", "name": "f9", "folder": "f0"}
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        return row

    def test_a_node_less_row_is_moved_by_the_rule_that_placed_it(self):
        row = self.store(lambda name: True)
        nodes = self.stub("node_core")
        answer = shims.move(["f1"], "f9")
        row.move.assert_called_once_with("f9")
        nodes.update.assert_not_called()
        self.assertEqual(answer["name"], "f9")

    def test_an_unnamed_destination_stays_the_old_default(self):
        """`File.move` falls back to the caller's legacy user folder. The node
        personal root is a different folder until Build joins them."""
        row = self.store(lambda name: True)
        self.stub("node_core")
        shims.move(["f1"])
        row.move.assert_called_once_with(None)

    def test_a_node_less_row_will_not_cross_into_the_node_tree(self):
        self.store(lambda name: name != "n9")
        self.stub("node_core")
        with self.assertRaises(frappe.ValidationError):
            shims.move(["f1"], "n9")

    def test_a_node_will_not_cross_into_the_file_tree(self):
        self.store(lambda name: name == "f9")
        nodes = self.stub("node_core")
        with self.assertRaises(frappe.ValidationError):
            shims.move(["n1"], "f9")
        nodes.update.assert_not_called()

    def test_a_list_that_names_both_stores_is_refused_whole(self):
        row = self.store(lambda name: name == "f1")
        self.stub("node_core")
        with self.assertRaises(frappe.ValidationError):
            shims.move(["f1", "n2"], "f9")
        row.move.assert_not_called()


class TestUnadoptedVisit(ShimCase):
    """`_legacy_visit`: the opened-at row, for an id no node holds.

    `writer.api.general.get_document_list` orders the caller's own documents
    by `Drive Recent.opened_at` and publishes it as `accessed`.
    Nothing but this call writes that row, so a forwarder that only visits
    nodes left every document `create_document` writes with no opened-at.
    """

    def store(self, *, node=False, file=True):
        """Name what each store holds, and answer the two legacy writes."""
        db = MagicMock()
        db.exists.side_effect = lambda doctype, name: node if doctype == "Drive Node" else file
        db.get_value.return_value = "f1"
        self.enterContext(patch.object(shims.frappe, "db", db))
        row = MagicMock()
        self.enterContext(patch.object(shims.frappe, "get_doc", MagicMock(return_value=row)))
        viewed = MagicMock()
        self.enterContext(patch("suite.drive.utils.users.mark_as_viewed", viewed))
        read = MagicMock(return_value=0)
        self.enterContext(patch.object(shims, "_mark_legacy_read", read))
        return db, row, viewed, read

    def test_an_id_a_node_holds_is_left_to_the_workflow(self):
        """The store is decided by which one holds the id."""
        _, _, viewed, _ = self.store(node=True)
        self.assertFalse(shims._legacy_visit(SOMEONE, "n1"))
        viewed.assert_not_called()

    def test_an_id_neither_store_holds_is_left_to_the_workflow(self):
        """`_core` still owns the refusal for an id that is nowhere."""
        _, _, viewed, _ = self.store(file=False)
        self.assertFalse(shims._legacy_visit(SOMEONE, "n1"))
        viewed.assert_not_called()

    def test_a_node_less_row_is_recorded_by_the_rule_that_wrote_it(self):
        _, row, viewed, _ = self.store()
        self.assertTrue(shims._legacy_visit(SOMEONE, "f1"))
        viewed.assert_called_once_with(row)

    def test_the_badge_for_the_opened_row_is_cleared_too(self):
        """The visible half of this call: the old body marked every unread
        notification about the file it opened as read."""
        _, _, _, read = self.store()
        shims._legacy_visit(SOMEONE, "f1")
        read.assert_called_once_with(SOMEONE, None, entity="f1")

    def test_the_gate_is_the_rule_that_wrote_the_row(self):
        """`File` carries a `has_permission` hook, so `get_doc` refuses a
        reader with no access. No deny is invented here."""
        db, _, viewed, _ = self.store()
        self.enterContext(
            patch.object(shims.frappe, "get_doc", MagicMock(side_effect=frappe.PermissionError))
        )
        with self.assertRaises(frappe.PermissionError):
            shims._legacy_visit(SOMEONE, "f1")
        viewed.assert_not_called()

    def test_the_forwarder_records_a_node_less_open_without_touching_the_workflow(self):
        activity = self.stub("activity_core")
        self.stub_unadopted_visit(True)
        self.assertIsNone(shims.track_visit("f1"))
        activity.visit.assert_not_called()

    def test_a_content_document_no_node_holds_still_names_its_file(self):
        """Sheets and Slides send `doctype`/`docname`, and the old body
        resolved that pair against `tabFile`. Both types are still in the
        expand phase, so the node lookup answers nothing for either."""
        db = MagicMock()
        db.get_value.side_effect = [None, "f1"]
        db.exists.return_value = False
        self.enterContext(patch.object(shims.frappe, "db", db))
        self.stub_unadopted_visit(True)

        shims.track_visit(doctype="Presentation", docname="p1")

        self.assertEqual(db.get_value.call_args_list[-1].args[0], "File")

    def test_a_content_document_a_node_holds_is_not_named_off_the_file_store(self):
        db = MagicMock()
        db.get_value.return_value = "f1"
        db.exists.return_value = True
        self.enterContext(patch.object(shims.frappe, "db", db))
        self.assertIsNone(shims._legacy_content_entity("Presentation", "p1"))


class TestUnadoptedFileRead(ShimCase):
    """`_legacy_entity_with_permissions`: the `File` store, for an id no node holds.

    §10.2 keeps a content type's legacy rows working while it is in the expand
    phase, and `writer.api.docs.create_document` writes one on every site
    running this commit. The node store cannot express that row, so this name
    reads the store that holds it.
    """

    FILE_ROW: ClassVar[dict] = {
        "name": "n1",
        "file_name": "Legacy Document",
        "folder": "f1",
        "file_url": "/private/files/legacy",
        "file_size": 12,
        "file_type": "Document",
        "is_folder": 0,
        "content_doctype": "Writer Document",
        "content_docname": "w1",
        "creation": "2026-09-07 10:00:00",
        "modified": "2026-09-07 10:00:00",
        "owner": SOMEONE.user,
        "attached_to_doctype": None,
        "attached_to_name": None,
    }

    READS: ClassVar[dict] = {"read": 1, "write": 1, "comment": 1, "share": 1, "upload": 1, "type": "admin"}
    READS_NOT: ClassVar[dict] = {
        "read": 0,
        "write": 0,
        "comment": 0,
        "share": 0,
        "upload": 0,
        "type": "guest",
    }

    def store(self, *, node=False, rows=None, access=None, guest=0, general=0, favourite=None):
        """Name what each store holds, and answer the legacy access rule."""
        from suite.drive import utils
        from suite.drive.api import permissions

        db = MagicMock()
        db.exists.return_value = node
        db.get_value.return_value = favourite
        self.enterContext(patch.object(shims.frappe, "db", db))
        self.enterContext(patch.object(shims.frappe, "get_all", return_value=list(rows or [])))

        reach = {"Guest": {**self.READS_NOT, "read": guest}}
        bits = MagicMock(side_effect=lambda entity, user: dict(reach.get(user, access or self.READS)))
        self.enterContext(patch.object(permissions, "get_user_access_for_user", bits))
        self.enterContext(patch.object(utils, "generate_upward_path", return_value=[{"read": general}]))
        self.enterContext(
            patch.object(utils, "get_valid_breadcrumbs", return_value=[{"name": "f1", "file_name": "Home"}])
        )
        return db, bits

    def test_an_id_a_node_holds_is_not_read_off_the_file_store(self):
        """The store is decided by which one holds the id. Reading `File`
        for an id that has a node would answer twice about one row."""
        db, _ = self.store(node=True, rows=[self.FILE_ROW])
        with patch.object(shims.frappe, "get_all") as read:
            self.assertIsNone(shims._legacy_entity_with_permissions("n1"))
        read.assert_not_called()
        db.exists.assert_called_once_with("Drive Node", "n1")

    def test_an_id_neither_store_holds_answers_nothing(self):
        self.store(rows=[])
        self.assertIsNone(shims._legacy_entity_with_permissions("n1"))

    def test_the_file_read_asks_for_the_active_row_under_the_old_columns(self):
        from suite.drive.utils import FILE_FIELDS

        self.store(rows=[self.FILE_ROW])
        with patch.object(shims.frappe, "get_all", return_value=[]) as read:
            shims._legacy_entity_with_permissions("n1")
        self.assertEqual(read.call_args.args[0], "File")
        self.assertEqual(read.call_args.kwargs["filters"], {"name": "n1", "status": "Active"})
        self.assertEqual(read.call_args.kwargs["fields"], FILE_FIELDS)
        self.assertEqual(read.call_args.kwargs["limit"], 1)

    def test_the_payload_is_the_one_the_old_body_published(self):
        self.store(rows=[self.FILE_ROW], favourite="n1")
        answer = shims._legacy_entity_with_permissions("n1")
        for key in (*self.FILE_ROW, "read", "write", "share", "comment", "upload", "type"):
            self.assertIn(key, answer)
        self.assertEqual(answer["content_docname"], "w1")
        self.assertEqual(answer["breadcrumbs"], [{"name": "f1", "file_name": "Home"}])
        self.assertEqual(answer["is_favourite"], "n1")
        self.assertEqual(answer["kind"], "native")
        self.assertIs(frappe.response["data"], answer)

    def test_a_managed_file_url_is_still_blanked(self):
        answer = self.store(rows=[self.FILE_ROW]) and shims._legacy_entity_with_permissions("n1")
        self.assertIsNone(answer["file_url"])

    def test_the_old_gate_refuses_a_caller_who_cannot_read_the_row(self):
        """The legacy rule answers, and it answers `PermissionError` - the
        class `ErrorPage.vue` sends a signed-out visitor to the login page on.
        Nothing here decides a refusal the old body did not decide."""
        self.store(rows=[self.FILE_ROW], access=self.READS_NOT)
        with self.assertRaises(frappe.PermissionError):
            shims._legacy_entity_with_permissions("n1")
        self.assertIsNone(frappe.response.get("data"))

    def test_the_general_marker_reads_published_then_site_then_restricted(self):
        """Legacy's `share_count`: -2 published, -1 site, 0 restricted, read
        off the same store as the row it decorates."""
        for guest, general, marker in ((1, 0, -2), (0, 1, -1), (0, 0, 0)):
            with self.subTest(marker=marker):
                self.store(rows=[self.FILE_ROW], guest=guest, general=general)
                self.assertEqual(shims._legacy_entity_with_permissions("n1")["share_count"], marker)

    def test_the_forwarder_answers_the_file_row_without_reading_a_node(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_file({"name": "n1", "file_name": "Legacy Document"})
        self.assertEqual(shims.get_entity_with_permissions("n1")["file_name"], "Legacy Document")
        nodes.get.assert_not_called()

    def test_a_refusal_from_the_workflow_is_never_retried_on_the_file_store(self):
        """§5.2 answers `DriveNotFound` for a node the caller may not read.
        Falling back on the exception would hand the legacy rules a question
        the workflow had already refused."""
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("not for you")
        legacy = self.stub_unadopted_file()
        with self.assertRaises(DriveNotFound):
            shims.get_entity_with_permissions("n1")
        legacy.assert_called_once_with("n1")


# --------------------------------------------------------------------------
# api/activity.py, api/notifications.py
# --------------------------------------------------------------------------


class TestRecordForwarders(ShimCase):
    def test_activity_log_keeps_the_old_column_names(self):
        activity = self.stub("activity_core")
        activity.history.return_value = {
            "rows": [
                {
                    "name": "a1",
                    "action": "rename",
                    "actor": "b@example.com",
                    "at": "2026-01-02 03:04:05",
                    "detail": {"from": "a", "to": "b"},
                }
            ],
            "next_cursor": None,
        }
        row = shims.get_entity_activity_log("n1")[0]
        self.assertEqual(row["action_type"], "rename")
        self.assertEqual(row["owner"], "b@example.com")
        self.assertEqual(row["creation"], "2026-01-02 03:04:05")
        self.assertEqual(row["detail"], {"from": "a", "to": "b"})

    def test_notifications_flatten_back_to_one_level(self):
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        activity.notifications.return_value = {
            "rows": [
                {
                    "name": "x1",
                    "read": 0,
                    "creation": "2026-01-02 03:04:05",
                    "activity": {
                        "action": "comment",
                        "actor": "b@example.com",
                        "node": "n1",
                        "detail": {"thread": "t1", "comment": "c1", "resolved": False},
                    },
                }
            ],
            "next_cursor": None,
        }
        with patch.object(
            shims.frappe,
            "get_all",
            return_value=[{"name": "n1", "kind": "file", "mime": "text/plain", "title": "Notes.txt"}],
        ):
            row = shims.get_notifications()[0]
        self.assertEqual(row["type"], "Mention")
        self.assertEqual(row["entity_type"], "File")
        self.assertEqual(row["from_user"], "b@example.com")
        self.assertEqual(row["notif_doctype_name"], "n1")
        self.assertEqual(row["read"], 0)

    def test_a_notification_carries_the_sentence_the_page_renders(self):
        """`Notifications.vue:51` renders `row.message` as the row's only text.

        §9.5 replaced the rendered message with an `action` and a structured
        `detail`, and no writer puts a `message` in either: `comments.py`
        writes `{thread, comment, resolved}` and `access.py` writes
        `{principal, old_role, new_role}`. Reading `detail["message"]` answered
        `None` on every row, so the page rendered a column of blank lines.
        """
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        cases = {
            "comment": "You were mentioned in a comment in: Notes.txt",
            "share_add": 'Bea shared a file with you: "Notes.txt"',
            "share_edit": 'Bea shared a file with you: "Notes.txt"',
        }
        for action, expected in cases.items():
            with self.subTest(action=action):
                activity.notifications.return_value = {
                    "rows": [
                        {
                            "name": "x1",
                            "read": 0,
                            "creation": "2026-01-02 03:04:05",
                            "activity": {
                                "action": action,
                                "actor": "b@example.com",
                                "node": "n1",
                                "detail": {"principal": "b@example.com"},
                            },
                        }
                    ],
                    "next_cursor": None,
                }
                with patch.object(
                    shims.frappe,
                    "get_all",
                    return_value=[{"name": "n1", "kind": "file", "mime": "text/plain", "title": "Notes.txt"}],
                ):
                    with patch.object(shims, "_user_info", return_value={"full_name": "Bea"}):
                        row = shims.get_notifications()[0]
                self.assertEqual(row["message"], expected)

    def test_a_notification_whose_node_is_gone_carries_no_sentence(self):
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        activity.notifications.return_value = {
            "rows": [
                {
                    "name": "x1",
                    "read": 0,
                    "creation": "2026-01-02",
                    "activity": {"action": "share_add", "actor": "b@example.com", "node": "n1"},
                }
            ],
            "next_cursor": None,
        }
        with patch.object(shims.frappe, "get_all", return_value=[]):
            row = shims.get_notifications()[0]
        self.assertIsNone(row["message"])

    def test_unread_count_is_still_a_scalar(self):
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        activity.unread_count.return_value = 7
        self.assertEqual(shims.get_unread_count(), 7)

    def test_mark_as_read_answers_nothing_and_marks_one(self):
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        self.assertIsNone(shims.mark_as_read(name="x1"))
        activity.mark_read.assert_called_once_with(SOMEONE, "x1")

    def test_mark_as_read_with_nothing_named_stays_a_no_op(self):
        activity = self.stub("activity_core")
        _read, _count, write = self.stub_legacy_inbox()
        self.assertIsNone(shims.mark_as_read())
        activity.mark_read.assert_not_called()
        write.assert_not_called()

    def test_mark_as_read_all_marks_all(self):
        activity = self.stub("activity_core")
        self.stub_legacy_inbox()
        shims.mark_as_read(all=True)
        activity.mark_read.assert_called_once_with(SOMEONE, None)


class TestLegacyInboxForwarders(ShimCase):
    """The rows §9.5's activity pointer cannot express, still answered.

    A `Drive Notification` written before Build, or by
    `api.notifications.create_notification`, carries no `activity`.
    `activity_core._visible_notifications` reads that pointer and drops the
    row, so forwarding alone emptied a legacy inbox: a blank page, a zero
    badge, and a `mark_as_read` that wrote nothing.
    """

    LEGACY_ROW: ClassVar[dict] = {
        "name": "old1",
        "to_user": "someone@example.com",
        "from_user": "b@example.com",
        "read": 0,
        "type": "Share",
        "message": 'Bea shared a file with you: "Notes.txt"',
        "entity_type": "File",
        "notif_doctype": "File",
        "notif_doctype_name": "f1",
        "creation": datetime(2026, 1, 2, 3, 4, 5),
    }

    def test_a_pointerless_row_reaches_the_page_as_it_was_written(self):
        activity = self.stub("activity_core")
        activity.notifications.return_value = {"rows": [], "next_cursor": None}
        self.stub_legacy_inbox([dict(self.LEGACY_ROW)])
        with patch.object(shims, "_user_info", return_value={"full_name": "Bea", "user_image": "/b.png"}):
            rows = shims.get_notifications()
        self.assertEqual(len(rows), 1)
        # The sentence, the type, and the entity type are the ones the old
        # writer stored. Nothing is rebuilt from §9.5's action vocabulary.
        self.assertEqual(rows[0]["message"], 'Bea shared a file with you: "Notes.txt"')
        self.assertEqual(rows[0]["type"], "Share")
        self.assertEqual(rows[0]["entity_type"], "File")
        self.assertEqual(rows[0]["notif_doctype"], "File")
        self.assertEqual(rows[0]["notif_doctype_name"], "f1")
        self.assertEqual(rows[0]["full_name"], "Bea")
        self.assertEqual(rows[0]["user_image"], "/b.png")

    def test_a_legacy_row_carries_the_twelve_columns_the_old_query_selected(self):
        activity = self.stub("activity_core")
        activity.notifications.return_value = {"rows": [], "next_cursor": None}
        self.stub_legacy_inbox([dict(self.LEGACY_ROW)])
        row = shims.get_notifications()[0]
        self.assertEqual(set(row), set(shims.LEGACY_NOTIFICATION_FIELDS) | {"full_name", "user_image"})

    def test_the_two_inboxes_arrive_newest_first_as_one_list(self):
        """The old query ordered the whole table by `creation desc`.

        Two lists concatenated would put every legacy row after every pointer
        row, whatever the dates on them say.
        """
        activity = self.stub("activity_core")
        activity.notifications.return_value = {
            "rows": [
                {
                    "name": "new1",
                    "read": 0,
                    "creation": datetime(2026, 1, 1),
                    "activity": {"action": "share_add", "actor": "b@example.com", "node": "n1"},
                }
            ],
            "next_cursor": None,
        }
        self.stub_legacy_inbox([{**self.LEGACY_ROW, "creation": datetime(2026, 2, 2)}])
        with patch.object(shims.frappe, "get_all", return_value=[]):
            rows = shims.get_notifications()
        self.assertEqual([row["name"] for row in rows], ["old1", "new1"])

    def test_the_badge_counts_both_inboxes(self):
        activity = self.stub("activity_core")
        activity.unread_count.return_value = 2
        _read, count, _write = self.stub_legacy_inbox([dict(self.LEGACY_ROW), dict(self.LEGACY_ROW)])
        self.assertEqual(shims.get_unread_count(), 4)
        count.assert_called_once_with(SOMEONE)

    def test_marking_one_row_reaches_a_pointerless_row_too(self):
        activity = self.stub("activity_core")
        _read, _count, write = self.stub_legacy_inbox()
        shims.mark_as_read(name="old1")
        activity.mark_read.assert_called_once_with(SOMEONE, "old1")
        write.assert_called_once_with(SOMEONE, "old1")

    def test_marking_everything_reaches_a_pointerless_row_too(self):
        activity = self.stub("activity_core")
        _read, _count, write = self.stub_legacy_inbox()
        shims.mark_as_read(all=True)
        activity.mark_read.assert_called_once_with(SOMEONE, None)
        write.assert_called_once_with(SOMEONE, None)

    def test_the_workflow_is_asked_first_so_a_guest_is_refused_before_a_row_is_read(self):
        """`_legacy_inbox` reads a table with no `Guest` rule of its own.

        `activity_core` refuses a Guest in `_require_person`. Reading the
        legacy rows first would answer an inbox to a caller the workflow was
        about to turn away.
        """
        for call, stub in (
            (lambda: shims.get_notifications(), "notifications"),
            (lambda: shims.get_unread_count(), "unread_count"),
            (lambda: shims.mark_as_read(all=True), "mark_read"),
        ):
            with self.subTest(stub=stub):
                activity = self.stub("activity_core")
                getattr(activity, stub).side_effect = DriveForbidden("no guests")
                read, count, write = self.stub_legacy_inbox([dict(self.LEGACY_ROW)])
                with self.assertRaises(DriveForbidden):
                    call()
                read.assert_not_called()
                count.assert_not_called()
                write.assert_not_called()


class TestLegacyInboxReads(ShimCase):
    """`_legacy_inbox` and `_mark_legacy_read` against a stubbed table."""

    def test_the_inbox_read_is_scoped_to_the_caller_and_to_pointerless_rows(self):
        with patch.object(shims.frappe, "get_all", return_value=[]) as read:
            shims._legacy_inbox(SOMEONE, only_unread=True, limit=50)
        self.assertEqual(
            read.call_args.kwargs["filters"],
            {"to_user": SOMEONE.user, "activity": ["is", "not set"], "read": 0},
        )
        self.assertEqual(read.call_args.kwargs["order_by"], "creation desc")
        self.assertEqual(read.call_args.kwargs["limit"], 50)
        self.assertEqual(read.call_args.kwargs["fields"], shims.LEGACY_NOTIFICATION_FIELDS)

    def test_reading_every_row_asks_for_no_limit_and_no_read_filter(self):
        with patch.object(shims.frappe, "get_all", return_value=[]) as read:
            shims._legacy_inbox(SOMEONE)
        self.assertEqual(
            read.call_args.kwargs["filters"],
            {"to_user": SOMEONE.user, "activity": ["is", "not set"]},
        )
        self.assertNotIn("limit", read.call_args.kwargs)

    def test_the_badge_counts_rather_than_reading_a_whole_inbox(self):
        """The old body was one `frappe.db.count`, and a badge polls.

        Reading the rows to take their length walks an inbox that has no cap
        on the mark path, on every sidebar render.
        """
        db = MagicMock()
        db.count.return_value = 3
        with patch.object(shims.frappe, "db", db):
            with patch.object(shims.frappe, "get_all") as read:
                self.assertEqual(shims._legacy_unread_count(SOMEONE), 3)
        read.assert_not_called()
        db.count.assert_called_once_with(
            "Drive Notification",
            {"to_user": SOMEONE.user, "activity": ["is", "not set"], "read": 0},
        )

    def test_marking_writes_the_recipient_into_the_update_it_runs(self):
        db = MagicMock()
        with patch.object(shims.frappe, "get_all", return_value=["old1", "old2"]):
            with patch.object(shims.frappe, "db", db):
                self.assertEqual(shims._mark_legacy_read(SOMEONE, None), 2)
        db.set_value.assert_called_once_with(
            "Drive Notification",
            {"name": ["in", ("old1", "old2")], "to_user": SOMEONE.user, "read": 0},
            "read",
            1,
            update_modified=False,
        )

    def test_marking_a_row_the_caller_does_not_hold_writes_nothing(self):
        db = MagicMock()
        with patch.object(shims.frappe, "get_all", return_value=[]) as read:
            with patch.object(shims.frappe, "db", db):
                self.assertEqual(shims._mark_legacy_read(SOMEONE, "someone-elses"), 0)
        self.assertEqual(
            read.call_args.kwargs["filters"],
            {
                "to_user": SOMEONE.user,
                "read": 0,
                "activity": ["is", "not set"],
                "name": "someone-elses",
            },
        )
        db.set_value.assert_not_called()


# --------------------------------------------------------------------------
# api/storage.py, api/embed.py
# --------------------------------------------------------------------------


class TestStorageAndEmbedForwarders(ShimCase):
    def test_the_storage_bar_still_folds_reservations_into_the_total(self):
        roots = self.stub("roots")
        roots.personal_root_for.return_value = "r1"
        roots.usage_for.return_value = frappe._dict(
            used_bytes=100, reserved_bytes=25, quota_bytes=0, effective_quota=1000
        )
        self.assertEqual(
            shims.storage_bar_data(),
            {"total_size": 125, "reserved_size": 25, "limit": 1000},
        )

    def test_a_caller_with_no_root_stores_nothing(self):
        roots = self.stub("roots")
        roots.personal_root_for.return_value = None
        self.assertEqual(shims.storage_bar_data(), {"total_size": 0, "reserved_size": 0, "limit": 0})
        self.assertEqual(shims.storage_breakdown(), {"limit": 0, "total": [], "entities": []})

    def test_the_breakdown_keeps_its_three_keys(self):
        roots = self.stub("roots")
        roots.personal_root_for.return_value = "r1"
        roots.usage_for.return_value = frappe._dict(effective_quota=100_000)
        rows = [
            frappe._dict(
                name="n1", title="a.pdf", owner="a@example.com", size=900, mime="application/pdf", kind="file"
            ),
            frappe._dict(
                name="n2", title="b.png", owner="a@example.com", size=100, mime="image/png", kind="file"
            ),
        ]
        with patch.object(shims.frappe, "get_all", return_value=rows):
            answer = shims.storage_breakdown()
        self.assertEqual(answer["limit"], 100_000)
        self.assertEqual(
            sorted(answer["total"], key=lambda row: row["file_type"]),
            [{"file_type": "Image", "file_size": 100}, {"file_type": "PDF", "file_size": 900}],
        )
        # The quota floor is limit/200 = 500, so the small file is not listed.
        self.assertEqual([row["name"] for row in answer["entities"]], ["n1"])
        self.assertEqual(answer["entities"][0]["file_name"], "a.pdf")

    def test_an_embed_redirects_to_its_own_signed_url(self):
        content = self.stub("content")
        content.list_media.return_value = [
            {"node": "m1", "url": "/f/one"},
            {"node": "m2", "url": "/f/two"},
        ]
        shims.embed_file_content("m2", "doc1")
        self.assertEqual(frappe.local.response["type"], "redirect")
        self.assertEqual(frappe.local.response["location"], "/f/two")
        content.list_media.assert_called_once_with(SOMEONE, "doc1")

    def test_an_embed_outside_its_document_is_not_found(self):
        content = self.stub("content")
        content.list_media.return_value = [{"node": "m1", "url": "/f/one"}]
        with self.assertRaises(DriveNotFound):
            shims.embed_file_content("m9", "doc1")


# --------------------------------------------------------------------------
# api/files.py
# --------------------------------------------------------------------------


class TestFileForwarders(ShimCase):
    def test_rename_forwards_a_title_and_answers_the_old_row(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_row()
        nodes.stored.return_value = node_row(title="New.pdf")
        answer = shims.rename("n1", "New.pdf")
        nodes.update.assert_called_once_with(SOMEONE, "n1", title="New.pdf")
        self.assertEqual(answer["file_name"], "New.pdf")

    def test_move_forwards_a_parent_for_every_named_node(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.stored.return_value = node_row()
        shims.move(["n1", "n2"], "f9")
        self.assertEqual(
            [call.args[1:] for call in nodes.update.call_args_list],
            [("n1",), ("n2",)],
        )
        for call in nodes.update.call_args_list:
            self.assertEqual(call.kwargs, {"parent": "f9"})

    def test_remove_or_restore_reads_the_state_before_it_flips_it(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_row()
        nodes.get.return_value = node_row(state="Active")
        shims.remove_or_restore(["n1"])
        nodes.update.assert_called_once_with(SOMEONE, "n1", state="Trashed")

        nodes.update.reset_mock()
        nodes.get.return_value = node_row(state="Trashed")
        shims.remove_or_restore('["n1"]')
        nodes.update.assert_called_once_with(SOMEONE, "n1", state="Active")

    def test_a_restore_never_names_a_destination(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_row()
        nodes.get.return_value = node_row(state="Trashed")
        shims.remove_or_restore(["n1"])
        self.assertNotIn("parent", nodes.update.call_args.kwargs)

    def test_delete_entities_purges_each_named_node(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        shims.delete_entities(["n1", "n2"])
        self.assertEqual(
            [call.args for call in nodes.purge.call_args_list], [(SOMEONE, "n1"), (SOMEONE, "n2")]
        )

    def test_delete_entities_refuses_an_empty_list(self):
        self.stub("node_core")
        with self.assertRaises(frappe.ValidationError):
            shims.delete_entities([])

    def test_does_entity_exist_asks_the_workflow_that_holds_the_upload_gate(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.title_taken.return_value = True
        self.assertTrue(shims.does_entity_exist("Report.pdf", "f1"))
        nodes.title_taken.assert_called_once_with(SOMEONE, "f1", "Report.pdf")

    def test_an_upload_renames_around_a_sibling_instead_of_refusing(self):
        """The old body deduplicated with `get_new_file_name` before it wrote.

        §8.6 refuses a collision so the UI can ask for another title, and this
        caller has no dialog: dropzone sends a filename and reads the row back.
        Without the rename the second copy of `Report.pdf` is a 409.
        """
        nodes = self.stub("node_core")
        uploads = self.stub("upload_core")
        nodes.available_title.return_value = "Report (2).pdf"
        nodes.stored.return_value = node_row(title="Report (2).pdf")
        uploads.create_upload.return_value = {"upload_id": "u1", "mode": "chunked"}
        uploads.finish_upload.return_value = "n1"

        upload = MagicMock()
        upload.filename = "Report.pdf"
        upload.mimetype = "application/pdf"
        upload.stream.read.return_value = b"x"
        self.enterContext(local_attribute("request", MagicMock(files={"file": upload})))
        self.enterContext(local_attribute("form_dict", frappe._dict()))
        self.stub_cache()
        self.stub_unadopted_row()

        with (
            patch.object(shims, "_legacy_list_rows", return_value=[{"name": "n1"}]) as listed,
            patch.object(shims.frappe, "publish_realtime") as published,
        ):
            answer = shims.upload_file(parent="f1", total_file_size=1)

        nodes.available_title.assert_called_once_with(SOMEONE, "f1", "Report.pdf")
        self.assertEqual(uploads.finish_upload.call_args.kwargs["title"], "Report (2).pdf")
        self.assertEqual(answer["file_name"], "Report (2).pdf")
        # `GenericPage.vue` appends the row live; without the event the upload
        # only shows up on a reload. It goes to the uploader, not to everyone.
        listed.assert_called_once()
        published.assert_called_once_with("list-add", {"file": {"name": "n1"}}, user=SOMEONE.user)

    def test_a_chunked_upload_that_names_no_session_is_refused(self):
        """The old body minted a session id only for a single-chunk upload.

        Minting one per chunk instead binds every chunk to its own
        `upload_id`, and the last chunk finishes a file with holes in it.
        """
        self.stub("node_core")
        uploads = self.stub("upload_core")
        upload = MagicMock()
        upload.filename = "Report.pdf"
        upload.stream.read.return_value = b"x"
        self.enterContext(local_attribute("request", MagicMock(files={"file": upload})))
        self.enterContext(
            local_attribute(
                "form_dict",
                frappe._dict(chunk_index="1", total_chunk_count="4", chunk_byte_offset="10"),
            )
        )
        self.stub_cache()
        self.stub_unadopted_row()

        with self.assertRaises(frappe.ValidationError) as caught:
            shims.upload_file(parent="f1", total_file_size=100)
        uploads.create_upload.assert_not_called()
        # The refusal carries its own words. A stubbed cache that swallowed
        # `frappe._` too made this a mock repr, and no client could read it.
        self.assertIn("Invalid upload session.", str(caught.exception))

    def posted_file(self, body=b"x" * 12, **form):
        """One multipart POST to `upload_file`, with nothing cached for it."""
        upload = MagicMock()
        upload.filename = "Report.pdf"
        upload.mimetype = "application/pdf"
        upload.stream.read.return_value = body
        self.enterContext(local_attribute("request", MagicMock(files={"file": upload})))
        self.enterContext(local_attribute("form_dict", frappe._dict(**form)))
        self.stub_cache()
        self.stub_unadopted_row()
        return upload

    def test_an_upload_that_declares_no_size_declares_the_bytes_it_was_sent(self):
        """`FileUploader.vue` sends `total_file_size` on a chunked upload only,
        so every file below Dropzone's twenty megabyte chunk size arrives
        declaring nothing. The old body sized the file off the disk instead. A
        session that declares zero refuses its own first chunk with "Upload
        exceeds the declared file size" and deletes itself.
        """
        nodes = self.stub("node_core")
        uploads = self.stub("upload_core")
        nodes.stored.return_value = node_row()
        uploads.create_upload.return_value = {"upload_id": "u1", "mode": "chunked"}
        uploads.finish_upload.return_value = "n1"
        self.posted_file(body=b"y" * 4096)

        with (
            patch.object(shims, "_legacy_list_rows", return_value=[{"name": "n1"}]),
            patch.object(shims.frappe, "publish_realtime"),
        ):
            shims.upload_file(parent="f1")

        self.assertEqual(uploads.create_upload.call_args.args[3], 4096)
        self.assertEqual(uploads.upload_chunk.call_args.args[3], b"y" * 4096)

    def test_an_upload_that_declares_a_size_keeps_it(self):
        """A chunked caller sends the whole file's size with every chunk, and
        only that number can size a session the first chunk opens."""
        nodes = self.stub("node_core")
        uploads = self.stub("upload_core")
        nodes.stored.return_value = node_row()
        uploads.create_upload.return_value = {"upload_id": "u1", "mode": "chunked"}
        self.posted_file(
            body=b"z" * 8, uuid="abc", chunk_index="0", total_chunk_count="4", chunk_byte_offset="0"
        )
        self.assertIsNone(shims.upload_file(parent="f1", total_file_size=900))
        self.assertEqual(uploads.create_upload.call_args.args[3], 900)

    def test_a_direct_upload_target_is_refused_where_the_reason_is(self):
        """A driver that offers a presigned target opens a session no chunk
        can be written to. This caller has already sent its bytes here, and
        §11.7 has no way to hand them on. The framework's own refusal is
        "expects a direct upload, not chunks", which names nothing a legacy
        client can act on."""
        self.stub("node_core")
        uploads = self.stub("upload_core")
        uploads.create_upload.return_value = {
            "upload_id": "u1",
            "mode": "direct",
            "url": "https://bucket.example/",
            "fields": {},
        }
        self.posted_file()
        with self.assertRaises(frappe.ValidationError) as caught:
            shims.upload_file(parent="f1")
        uploads.upload_chunk.assert_not_called()
        self.assertIn("This site stores Drive files directly.", str(caught.exception))

    def test_an_unreadable_id_answers_none_whichever_refusal_it_meets(self):
        """`translate_old_name` is guest-callable and answers `None` for
        anything it cannot read. A caller presenting a link meets
        `DriveLocked` (401) or `DriveLinkExpired` (410) on the same read, and
        naming `DriveNotFound` alone let those two travel."""
        nodes = self.stub("node_core")
        for error in (DriveNotFound, DriveForbidden, DriveLocked, DriveLinkExpired):
            with self.subTest(error=error.__name__):
                nodes.get.side_effect = error("no")
                self.assertIsNone(shims.translate_old_name("n1"))

    def test_get_entity_type_answers_folder_or_file(self):
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(kind="folder", mime=None)
        self.assertEqual(
            shims.get_entity_type("n1"),
            {"name": "n1", "file_type": "Folder", "type": "folder"},
        )
        nodes.get.return_value = node_row()
        self.assertEqual(shims.get_entity_type("n1")["type"], "file")

    def test_get_root_folder_answers_both_roots(self):
        roots = self.stub("roots")
        roots.active_root_for.return_value = "shared-root"
        roots.personal_root_for.return_value = "home-root"
        self.assertEqual(shims.get_root_folder(), {"root": "shared-root", "home": "home-root"})

    def test_translate_old_name_passes_a_readable_id_through(self):
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row()
        self.assertEqual(shims.translate_old_name("n1"), "n1")

    def test_translate_old_name_hides_an_unreadable_id(self):
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("gone")
        self.assertIsNone(shims.translate_old_name("n1"))

    def test_resolve_legacy_route_answers_none_for_everything_it_cannot_show(self):
        nodes = self.stub("node_core")
        db = MagicMock()
        db.get_value.return_value = None
        with patch.object(shims.frappe, "db", db):
            self.assertIsNone(shims.resolve_legacy_route("t1"))
        db.get_value.return_value = "n1"
        with patch.object(shims.frappe, "db", db):
            nodes.get.side_effect = DriveNotFound("gone")
            self.assertIsNone(shims.resolve_legacy_route("t1"))
            nodes.get.side_effect = None
            nodes.get.return_value = node_row(state="Trashed")
            self.assertIsNone(shims.resolve_legacy_route("t1"))
            nodes.get.return_value = node_row(kind="folder")
            self.assertEqual(shims.resolve_legacy_route("t1"), {"name": "n1", "is_folder": True})

    def test_get_file_content_redirects_to_a_signed_url(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row()
        nodes.signed_content_url.return_value = {"url": "/f/signed", "expires": 1}
        shims.get_file_content("n1")
        self.assertEqual(frappe.local.response["location"], "/f/signed")

    def test_get_file_content_sends_a_document_to_the_editor(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(kind="document", mime=None)
        shims.get_file_content("n1")
        self.assertEqual(frappe.local.response["location"], "/drive/w/n1")

    def test_streaming_is_the_same_redirect(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row()
        nodes.signed_content_url.return_value = {"url": "/f/signed", "expires": 1}
        shims.stream_file_content("n1")
        self.assertEqual(frappe.local.response["location"], "/f/signed")

    def test_a_thumbnail_without_a_preview_still_answers_an_empty_string(self):
        nodes = self.stub("node_core")
        previews = self.stub("previews")
        nodes.get.return_value = node_row()
        previews.preview_expansions.return_value = {}
        self.assertEqual(shims.get_thumbnail("n1"), "")

    def test_a_thumbnail_redirects_to_the_signed_preview(self):
        nodes = self.stub("node_core")
        previews = self.stub("previews")
        nodes.get.return_value = node_row()
        previews.preview_expansions.return_value = {"n1": {"url": "/f/preview", "expires": 1}}
        shims.get_thumbnail("n1")
        self.assertEqual(frappe.local.response["location"], "/f/preview")

    def test_remove_recents_clears_nothing_when_nothing_is_named(self):
        activity = self.stub("activity_core")
        shims.remove_recents()
        activity.clear_recents.assert_called_once_with(SOMEONE, [])

    def test_remove_recents_clears_everything_only_when_asked(self):
        activity = self.stub("activity_core")
        shims.remove_recents(clear_all=True)
        activity.clear_recents.assert_called_once_with(SOMEONE, None)

    def test_set_favourite_toggles_when_the_client_says_nothing(self):
        self.stub_unadopted_row()
        activity = self.stub("activity_core")
        activity.personal_marks.return_value = {"n1": {"favourite": "fav1", "opened_at": None}}
        shims.set_favourite([{"name": "n1"}])
        activity.set_favourite.assert_called_once_with(SOMEONE, "n1", False)

    def test_clearing_every_favourite_names_the_node_not_its_row(self):
        """`favourites()` answers personal rows whose `node` is the node row.

        `_visible_personal_rows` replaces `row.node` with the row it
        authorized, so passing `row["node"]` straight on filtered
        `Drive Favourite` on a dict. It matched nothing, and "clear all"
        cleared nothing.
        """
        self.stub_unadopted_row()
        self.enterContext(patch.object(shims, "_legacy_favourites_held", return_value=[]))
        activity = self.stub("activity_core")
        activity.favourites.return_value = {
            "rows": [
                {"name": "fav1", "node": node_row(name="n1")},
                {"name": "fav2", "node": node_row(name="n2")},
            ],
            "next_cursor": None,
        }
        shims.set_favourite(clear_all=True)
        self.assertEqual(
            [call.args[1] for call in activity.set_favourite.call_args_list],
            ["n1", "n2"],
        )

    def test_set_favourite_reads_a_string_flag(self):
        self.stub_unadopted_row()
        activity = self.stub("activity_core")
        activity.personal_marks.return_value = {}
        shims.set_favourite([{"name": "n1", "is_favourite": "true"}])
        activity.set_favourite.assert_called_once_with(SOMEONE, "n1", True)

    def test_search_keeps_the_old_search_columns(self):
        nodes = self.stub("node_core")
        nodes.views.return_value = {"rows": [node_row()], "next_cursor": None}
        row = shims.search("report")[0]
        for key in ("name", "file_name", "file_type", "is_folder", "owner", "user_name", "full_name"):
            self.assertIn(key, row)
        self.assertEqual(row["file_name"], "Report.pdf")

    def test_search_answers_nothing_for_an_empty_query(self):
        nodes = self.stub("node_core")
        self.assertEqual(shims.search("   "), [])
        nodes.views.assert_not_called()

    def test_search_walks_windows_until_the_page_is_full(self):
        """The view permission-filters after its SQL window, so one window makes
        the reply depend on how many rows the caller cannot read sort first.
        The old body walked ten windows for this reason and said so."""
        nodes = self.stub("node_core")
        nodes.MAX_PAGE_SIZE = 200
        windows = [
            {"rows": [node_row(name=f"a{i}") for i in range(2)], "next_cursor": "c200"},
            {"rows": [node_row(name=f"b{i}") for i in range(60)], "next_cursor": "c400"},
        ]
        nodes.views.side_effect = lambda *a, **k: windows[min(nodes.views.call_count - 1, 1)]

        rows = shims.search("report")

        self.assertEqual(nodes.views.call_count, 2)
        self.assertEqual(len(rows), 50)
        self.assertEqual(nodes.views.call_args.kwargs["cursor"], "c200")

    def test_search_stops_walking_when_the_view_is_exhausted(self):
        nodes = self.stub("node_core")
        nodes.MAX_PAGE_SIZE = 200
        nodes.views.return_value = {"rows": [node_row(name="a1")], "next_cursor": None}
        self.assertEqual(len(shims.search("report")), 1)
        self.assertEqual(nodes.views.call_count, 1)

    def test_search_never_walks_past_its_scan_bound(self):
        nodes = self.stub("node_core")
        nodes.MAX_PAGE_SIZE = 200
        nodes.views.return_value = {"rows": [], "next_cursor": "c200"}
        self.assertEqual(shims.search("report"), [])
        self.assertEqual(nodes.views.call_count, shims.MAX_SEARCH_WINDOWS)

    def test_track_visit_records_the_visit(self):
        activity = self.stub("activity_core")
        self.stub_unadopted_visit()
        activity.notifications.return_value = {"rows": [], "next_cursor": None}
        shims.track_visit("n1")
        activity.visit.assert_called_once_with(SOMEONE, "n1")

    def test_track_visit_needs_something_to_visit(self):
        self.stub("activity_core")
        with self.assertRaises(frappe.ValidationError):
            shims.track_visit()

    def test_redirect_to_original_refuses_a_row_that_is_not_an_attachment(self):
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(content_doctype=None)
        with self.assertRaises(frappe.ValidationError):
            shims.redirect_to_original("n1")


class TestAccessForwarder(ShimCase):
    def setUp(self):
        super().setUp()
        # Every case here is about the node path. `_legacy_update_access` has
        # cases of its own in `TestUnadoptedShare`.
        self.stub_unadopted_row()

    def test_the_bits_name_the_rung_they_all_reach(self):
        """A rung carries every verb below it, so every bit below it is required.

        The dialog's four levels are contiguous sets, so each one still lands
        where it did.
        """
        access = self.stub("access")
        levels = {
            "reader": ({"read": 1, "comment": 1, "upload": 0, "share": 0, "write": 0}, COMMENT),
            "upload": ({"read": 1, "comment": 1, "upload": 1, "share": 0, "write": 0}, UPLOAD),
            "editor": ({"read": 1, "comment": 1, "upload": 1, "share": 1, "write": 1}, MANAGE),
            "view only": ({"read": 1, "comment": 0, "upload": 0, "share": 0, "write": 0}, READ),
        }
        for label, (bits, rung) in levels.items():
            with self.subTest(level=label):
                access.grant.reset_mock()
                shims.update_access("n1", "share", user="b@example.com", **bits)
                access.grant.assert_called_once_with("n1", "b@example.com", rung, SOMEONE, expires_on=None)

    def test_a_share_bit_without_a_write_bit_does_not_reach_manage(self):
        """`ShareDialog.updateGeneralAccess` sends `share: 1` for every level.

        Read off as the highest bit alone that is MANAGE, so "anyone in the
        organization can view" would hand every signed-in user edit, move, and
        purge on the node and its subtree.
        """
        access = self.stub("access")
        shims.update_access(
            "n1", "share", user="$GENERAL", read=1, comment=1, share=1, write=False, upload=False
        )
        access.grant.assert_called_once_with("n1", "$GENERAL", COMMENT, SOMEONE, expires_on=None)

    def test_a_publish_is_held_at_the_public_ceiling(self):
        """§6.5: a published node is the one row `(node, $PUBLIC, READ)`.

        The dialog publishes with `read, comment, share`, which is above the
        ceiling, and `access.grant` refuses anything above it - so an unclamped
        forwarder turns "Anyone with the link" into a 403.
        """
        access = self.stub("access")
        shims.update_access("n1", "share", user="", read=1, comment=1, share=1)
        access.grant.assert_called_once_with("n1", "$PUBLIC", READ, SOMEONE, expires_on=None)

    def test_an_omitted_user_is_still_the_public_principal(self):
        access = self.stub("access")
        shims.update_access("n1", "share", read=1)
        access.grant.assert_called_once_with("n1", "$PUBLIC", READ, SOMEONE, expires_on=None)

    def test_an_explicit_deny_is_the_caller_asking_for_role_zero(self):
        access = self.stub("access")
        shims.update_access("n1", "share", user="b@example.com", read=1, deny=1)
        access.grant.assert_called_once_with("n1", "b@example.com", 0, SOMEONE, expires_on=None)

    def test_an_unshare_removes_the_row_and_writes_nothing(self):
        access = self.stub("access")
        shims.update_access("n1", "unshare", user="b@example.com")
        access.revoke.assert_called_once_with("n1", "b@example.com", SOMEONE)
        access.grant.assert_not_called()

    def test_restricting_site_wide_access_also_unpublishes(self):
        """`File.unshare` cleared both site-wide rows through `_clear_general`.

        The dialog's "Restricted" still names only `$GENERAL`, so revoking that
        row alone leaves a published file published.
        """
        for named in ("$GENERAL", "$PUBLIC", ""):
            with self.subTest(named=named):
                access = self.stub("access")
                shims.update_access("n1", "unshare", user=named)
                self.assertEqual(
                    [call.args[1] for call in access.revoke.call_args_list],
                    ["$PUBLIC", "$GENERAL"],
                )
                access.grant.assert_not_called()

    def test_a_share_that_reaches_no_rung_is_refused_not_written_as_a_deny(self):
        """Role 0 is §5.10's deny, and `File.share` never wrote one.

        An unnamed bit kept its old value there and `deny` was set to 0
        regardless, so an all-zero row meant "no access", not "denied".
        Granting 0 here would turn a partial share into a deny that cuts
        inheritance from the folder above.
        """
        for kwargs in ({}, {"write": 1}, {"share": 1}, {"comment": 1, "upload": 1}):
            with self.subTest(kwargs=kwargs):
                access = self.stub("access")
                with self.assertRaises(frappe.ValidationError):
                    shims.update_access("n1", "share", user="b@example.com", **kwargs)
                access.grant.assert_not_called()

    def test_a_deny_the_caller_asked_for_is_still_written(self):
        access = self.stub("access")
        shims.update_access("n1", "share", user="b@example.com", deny=1)
        access.grant.assert_called_once_with("n1", "b@example.com", 0, SOMEONE, expires_on=None)

    def test_an_unknown_method_is_refused(self):
        self.stub("access")
        with self.assertRaises(frappe.ValidationError):
            shims.update_access("n1", "publish")

    def test_a_legacy_share_cannot_mint_a_share_link(self):
        """`access.grant("$LINK", ...)` mints a token and answers its
        `/drive/l/` URL. `File.share` had no branch for it: an unknown
        principal went to `create_invites`, which refuses a non-address. §11.7
        gives no legacy name a link-issuing contract."""
        access = self.stub("access")
        for principal in ("$LINK", "$LINK:abcdefghijklmnopqrstuv"):
            with self.subTest(principal=principal):
                with self.assertRaises(frappe.ValidationError):
                    shims.update_access("n1", "share", user=principal, read=1)
        access.grant.assert_not_called()

    def test_a_non_string_principal_is_a_refusal_not_a_traceback(self):
        """`**kwargs` is the request body. `access._principal_kind` refuses a
        non-string cleanly; reaching `startswith` first answers a 500."""
        access = self.stub("access")
        for principal in ([{"user": "a"}], {"a": 1}, 7):
            with self.subTest(principal=principal):
                with self.assertRaises(frappe.ValidationError):
                    shims.update_access("n1", "share", user=principal, read=1)
        access.grant.assert_not_called()

    def test_a_re_share_keeps_an_expiry_it_has_no_field_for(self):
        """`access.grant` replaces the whole row: §11.2 spells it `PUT`. This
        caller has no field for an expiry, so re-sharing through it turned a
        time-limited share into a permanent one."""
        access = self.stub("access")
        access.grants_for.return_value = {
            "grants": [
                {"principal": "c@example.com", "expires_on": "2030-01-01 00:00:00"},
                {"principal": "b@example.com", "expires_on": "2026-12-31 00:00:00"},
            ]
        }
        shims.update_access("n1", "share", user="b@example.com", read=1, comment=1)
        self.assertEqual(access.grant.call_args.kwargs["expires_on"], "2026-12-31 00:00:00")

    def test_a_first_share_carries_no_expiry(self):
        access = self.stub("access")
        access.grants_for.return_value = {"grants": []}
        shims.update_access("n1", "share", user="b@example.com", read=1)
        self.assertIsNone(access.grant.call_args.kwargs["expires_on"])

    def test_an_unshare_of_a_link_is_refused_too(self):
        access = self.stub("access")
        with self.assertRaises(frappe.ValidationError):
            shims.update_access("n1", "unshare", user="$LINK:abcdefghijklmnopqrstuv")
        access.revoke.assert_not_called()


# --------------------------------------------------------------------------
# api/list.py
# --------------------------------------------------------------------------


class ListCase(ShimCase):
    def setUp(self):
        super().setUp()
        self.nodes = self.stub("node_core")
        self.access = self.stub("access")
        self.activity = self.stub("activity_core")
        self.roots = self.stub("roots")
        self.nodes.encode_cursor.side_effect = lambda offset: f"c{offset}"
        self.nodes.decode_cursor.side_effect = lambda cursor: int(str(cursor)[1:]) if cursor else 0
        self.access.effective_role.return_value = EDIT
        self.activity.personal_marks.return_value = {"n1": {"favourite": "fav1", "opened_at": "2026-01-03"}}
        self.roots.personal_root_for.return_value = "home-root"
        self.nodes.readable_child_counts.return_value = {"n1": 3}
        shares = patch.object(shims, "_share_counts", return_value={"n1": -1})
        shares.start()
        self.addCleanup(shares.stop)
        self.stub_unadopted_children()

    def one_page(self, rows):
        self.nodes.children.return_value = {"rows": rows, "next_cursor": None}
        self.nodes.views.return_value = {"rows": rows, "next_cursor": None}


class TestListForwarders(ListCase):
    def test_a_list_row_carries_every_column_the_old_page_reads(self):
        self.one_page([node_row()])
        row = shims.files()[0]
        for key in (
            "name",
            "file_name",
            "folder",
            "file_size",
            "file_type",
            "is_folder",
            "owner",
            "owner_full_name",
            "owner_image",
            "is_favourite",
            "accessed",
            "child_count",
            "share_count",
            "kind",
            "read",
            "write",
            "share",
            "comment",
            "upload",
            "type",
        ):
            self.assertIn(key, row)
        self.assertEqual(row["kind"], "native")
        self.assertEqual(row["child_count"], 3)
        self.nodes.readable_child_counts.assert_called_once_with(SOMEONE, ["n1"])
        self.assertEqual(row["share_count"], -1)
        self.assertEqual(row["is_favourite"], "fav1")
        self.assertEqual(row["accessed"], "2026-01-03")
        self.assertEqual(row["write"], 1)

    def test_an_unknown_sort_column_falls_back_instead_of_refusing(self):
        self.one_page([])
        shims.files(order_by="file_type")
        # Legacy `modified` is `COALESCE(file_modified, modified)`, which is
        # §11.4's `content_modified` order. `ORDER_COLUMN` says why.
        self.assertEqual(self.nodes.children.call_args.kwargs["order_by"], "content_modified")
        shims.files(order_by="file_name")
        self.assertEqual(self.nodes.children.call_args.kwargs["order_by"], "title")
        shims.files(order_by="file_size")
        self.assertEqual(self.nodes.children.call_args.kwargs["order_by"], "size")

    def test_no_folder_named_means_the_callers_own_root(self):
        self.one_page([])
        shims.files()
        self.assertEqual(self.nodes.children.call_args.args[1], "home-root")

    def test_a_search_goes_to_the_search_view_not_the_folder(self):
        self.one_page([])
        shims.files(entity_name="f1", search="report")
        self.nodes.children.assert_not_called()
        self.assertEqual(self.nodes.views.call_args.args[1], "search")
        self.assertEqual(self.nodes.views.call_args.kwargs["term"], "report")

    def test_the_family_filter_still_selects_by_the_old_vocabulary(self):
        self.one_page([node_row(), node_row(name="n2", kind="folder", mime=None)])
        rows = shims.files(file_kinds='["Folder"]')
        self.assertEqual([row["name"] for row in rows], ["n2"])

    def test_a_family_that_shares_a_mime_with_another_still_selects(self):
        """`get_file_type` answers the first table key holding the mime, so a
        `frappe_doc` row is `Document` and never `Frappe Document`, and that
        family selected nothing. The old filter was `mime_type IN (...)` over
        the union of the named families and matched both."""
        self.one_page([node_row(name="n1", mime="frappe_doc"), node_row(name="n2", mime="text/plain")])
        for kind in ("Document", "Frappe Document"):
            with self.subTest(kind=kind):
                self.assertEqual([row["name"] for row in shims.files(file_kinds=[kind])], ["n1"])

    def test_a_family_filter_still_excludes_what_it_does_not_name(self):
        self.one_page([node_row(name="n1", mime="frappe_doc"), node_row(name="n2", mime="text/plain")])
        self.assertEqual([row["name"] for row in shims.files(file_kinds=["Text"])], ["n2"])

    def test_a_paginated_call_answers_the_old_envelope(self):
        self.nodes.children.return_value = {"rows": [node_row()], "next_cursor": "c50"}
        answer = shims.files(paginated=True, limit=1)
        self.assertEqual(set(answer), {"rows", "has_next", "next_start"})
        self.assertTrue(answer["has_next"])
        self.assertEqual(answer["next_start"], 50)

    def test_a_bare_call_still_answers_a_bare_list(self):
        self.one_page([node_row()])
        self.assertIsInstance(shims.files(), list)

    def test_the_last_page_reports_no_next(self):
        self.one_page([node_row()])
        answer = shims.files(paginated=True)
        self.assertFalse(answer["has_next"])

    def test_the_views_are_addressed_by_their_frozen_names(self):
        self.one_page([])
        shims.favourites()
        self.assertEqual(self.nodes.views.call_args.args[1], "favourites")
        shims.recents()
        self.assertEqual(self.nodes.views.call_args.args[1], "recents")
        shims.shared()
        self.assertEqual(self.nodes.views.call_args.args[1], "shared")

    def test_trash_names_the_callers_own_root(self):
        self.one_page([])
        shims.trash()
        self.assertEqual(self.nodes.views.call_args.args[1], "trash")
        self.assertEqual(self.nodes.views.call_args.kwargs["root"], "home-root")

    def test_a_second_shared_list_is_refused_rather_than_answered_with_the_first(self):
        self.one_page([])
        with self.assertRaises(frappe.ValidationError):
            shims.shared(shared_type="public")

    def test_a_page_never_resumes_past_a_row_it_did_not_show(self):
        """The walk asks for what the page still needs, not the whole window.

        The old surface did (`list.py`, `need = window - len(rows)`), and the
        difference is rows the client never sees: a first window thinned by the
        permission filter, a second one full, and the surplus is cut to fit the
        page while `next_cursor` has already moved past it.
        """
        windows = [
            {"rows": [node_row(name=f"a{i}", title=f"a{i}") for i in range(6)], "next_cursor": "c10"},
            {"rows": [node_row(name=f"b{i}", title=f"b{i}") for i in range(4)], "next_cursor": "c14"},
        ]
        asked: list[int] = []

        def page(principals, parent, **kwargs):
            asked.append(kwargs["limit"])
            return windows[len(asked) - 1]

        self.nodes.children.side_effect = page
        self.activity.personal_marks.return_value = {}
        answer = shims.files(paginated=True, limit=10)

        self.assertEqual(asked, [10, 4])
        self.assertEqual(len(answer["rows"]), 10)
        self.assertEqual(answer["rows"][-1]["name"], "b3")
        self.assertEqual(answer["next_start"], 14)

    def test_a_search_inside_a_view_still_filters_the_view(self):
        """The old query answered `file_name LIKE '%term%'` on all five lists.

        §11.2 gives the term to one view only, so the toolbar's search box would
        otherwise return the whole list unfiltered on the other four.
        """
        for call in (shims.shared, shims.favourites, shims.recents, shims.trash):
            with self.subTest(view=call.__name__):
                self.one_page(
                    [node_row(name="n1", title="Budget.pdf"), node_row(name="n2", title="Notes.md")]
                )
                self.activity.personal_marks.return_value = {}
                rows = call(search="budget")
                self.assertEqual([row["file_name"] for row in rows], ["Budget.pdf"])

    def test_a_search_term_that_matches_nothing_answers_nothing(self):
        self.one_page([node_row(name="n1", title="Budget.pdf")])
        self.activity.personal_marks.return_value = {}
        self.assertEqual(shims.favourites(search="invoice"), [])

    def test_an_empty_search_leaves_the_view_alone(self):
        self.one_page([node_row(name="n1", title="Budget.pdf")])
        self.activity.personal_marks.return_value = {}
        self.assertEqual(len(shims.favourites(search="   ")), 1)

    def test_the_search_view_is_not_filtered_twice(self):
        """`files(search=...)` goes to the view that already applied the term.

        Re-applying it here would drop every match the view found on something
        other than the title.
        """
        self.one_page([node_row(name="n1", title="Untitled")])
        self.activity.personal_marks.return_value = {}
        rows = shims.files(search="report")
        self.assertEqual([row["name"] for row in rows], ["n1"])

    def test_a_caller_that_names_no_limit_and_does_not_page_gets_everything(self):
        """`folderTree.js` and `MoveDialog.vue` call `files` exactly this way.

        The old non-paginated branch ran the query with no `LIMIT`. Defaulting
        to a hundred here hid every child past the hundredth from the sidebar
        tree and from the move target list.
        """
        windows = [
            {"rows": [node_row(name=f"a{i}") for i in range(200)], "next_cursor": "c200"},
            {"rows": [node_row(name=f"b{i}") for i in range(50)], "next_cursor": None},
        ]
        asked: list[int] = []

        def page(principals, parent, **kwargs):
            asked.append(kwargs["limit"])
            return windows[len(asked) - 1]

        self.nodes.children.side_effect = page
        self.nodes.MAX_PAGE_SIZE = 200
        self.activity.personal_marks.return_value = {}
        rows = shims.files()

        self.assertEqual(asked, [200, 200])
        self.assertEqual(len(rows), 250)

    def test_a_paged_caller_that_names_no_limit_still_gets_one_page(self):
        self.nodes.children.return_value = {
            "rows": [node_row(name=f"a{i}") for i in range(100)],
            "next_cursor": None,
        }
        self.activity.personal_marks.return_value = {}
        self.assertEqual(len(shims.files(paginated=True)["rows"]), 100)

    def test_a_presentation_row_carries_its_slide_count_and_no_other_row_does(self):
        """`DriveListRow.sizeLabel` reads `slide_count != null` to pick its label.

        Dropping it turned "12 slides" into a byte size; setting it everywhere
        would relabel every ordinary file on the page.
        """
        self.one_page(
            [
                node_row(name="n1", content_doctype="Presentation", content_docname="p1"),
                node_row(name="n2"),
            ]
        )
        self.activity.personal_marks.return_value = {}
        with patch("suite.drive.api.list._get_slide_counts", return_value={"p1": 12}) as counts:
            rows = shims.files()
        self.assertEqual([row["name"] for row in counts.call_args.args[0]], ["n1", "n2"])
        self.assertEqual(rows[0]["slide_count"], 12)
        self.assertNotIn("slide_count", rows[1])

    def test_no_presentation_on_the_page_asks_the_slides_app_nothing(self):
        self.one_page([node_row(name="n1")])
        self.activity.personal_marks.return_value = {}
        with patch("suite.drive.api.list._get_slide_counts", return_value={}) as counts:
            self.assertNotIn("slide_count", shims.files()[0])
        counts.assert_called_once()


class TestSignedOutVisitor(ShimCase):
    """`ErrorPage.vue` sends a signed-out visitor to `/login` on one condition:
    `exc_type == "PermissionError"`. The old bodies threw exactly that, so a
    share link opened while signed out reached the login screen. The workflow's
    `DriveNotFound` left it on "Uh oh!" with no way forward.
    """

    def as_guest(self):
        self.caller.stop()
        guest = patch.object(shims, "_principals", return_value=GUEST)
        guest.start()
        self.addCleanup(guest.stop)

    def test_a_page_read_tells_a_signed_out_visitor_to_sign_in(self):
        self.as_guest()
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("gone")
        with self.assertRaises(frappe.PermissionError):
            shims.get_entity_with_permissions("n1")

    def test_a_listing_tells_a_signed_out_visitor_the_same_thing(self):
        self.as_guest()
        self.stub_unadopted_children()
        nodes = self.stub("node_core")
        nodes.decode_cursor.return_value = 0
        nodes.children.side_effect = DriveNotFound("gone")
        with self.assertRaises(frappe.PermissionError):
            shims.files("n1")

    def test_a_signed_in_caller_keeps_the_workflow_refusal(self):
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("gone")
        with self.assertRaises(DriveNotFound):
            shims.get_entity_with_permissions("n1")

    def test_the_substitution_says_nothing_a_missing_id_did_not(self):
        """Uniform for a Guest: an id that exists and one that does not answer
        the same refusal, so it is no more an oracle than the 404 was."""
        self.as_guest()
        self.stub_unadopted_file()
        nodes = self.stub("node_core")
        raised = []
        for reason in ("no such node", "not for you"):
            nodes.get.side_effect = DriveNotFound(reason)
            with self.assertRaises(frappe.PermissionError) as caught:
                shims.get_entity_with_permissions("n1")
            raised.append(str(caught.exception))
        self.assertEqual(raised[0], raised[1])


class TestCallerHomeFolder(ShimCase):
    def test_a_caller_with_no_personal_root_is_refused_not_handed_none(self):
        """`provision_personal_root` refuses `Administrator`. A `None` travelled:
        `get_root_folder` published `home: None` and the next call failed
        somewhere else, about a missing node or an invalid root."""
        roots = self.stub("roots")
        roots.personal_root_for.return_value = None
        roots.provision_personal_root.return_value = None
        with self.assertRaises(frappe.ValidationError):
            shims.get_root_folder()

    def test_a_site_with_no_shared_root_is_refused_not_handed_none(self):
        """Legacy answered `drive_root().name`, which made the row when it was
        missing. §7 makes the Shared root part of Build, not of a read, so a
        `None` travelled: the client stored it and asked for its children."""
        roots = self.stub("roots")
        roots.active_root_for.return_value = None
        roots.personal_root_for.return_value = "home-root"
        with self.assertRaises(frappe.ValidationError):
            shims.get_root_folder()

    def test_a_guest_is_refused_before_a_root_is_read(self):
        self.caller.stop()
        guest = patch.object(shims, "_principals", return_value=GUEST)
        guest.start()
        self.addCleanup(guest.stop)
        roots = self.stub("roots")
        with self.assertRaises(frappe.ValidationError):
            shims._home(GUEST)
        roots.personal_root_for.assert_not_called()


class TestListingScanBound(ListCase):
    """A listing walk is bounded, and `list.files` is `allow_guest`.

    `file_kinds` and `search` were SQL predicates on the old surface, so a
    filter matching nothing came back exhausted on the first window. §11.2 can
    spell neither, so they are applied to the page here, and a window of
    non-matching rows does not advance the page at all. The permission filter
    runs after the SQL window on both surfaces, so even an unfiltered page can
    come back short and ask again.

    The counts below are numbers, not the module's own constants: a bound
    asserted against itself moves whenever the bound is changed.
    """

    # Deeper than any bound under test, and finite: an unbounded walk has to
    # come back and fail the count, not hang the suite.
    DEEPER_THAN_ANY_BOUND = 500

    def deep(self, stub, kind="folder"):
        """A view the workflow answers one row at a time, five hundred times."""
        self.nodes.MAX_PAGE_SIZE = 200

        def one_row(*args, **kwargs):
            reached = stub.call_count
            return {
                "rows": [node_row(name=f"n{reached}", mime="application/pdf")],
                "next_cursor": "c1" if reached < self.DEEPER_THAN_ANY_BOUND else None,
            }

        stub.side_effect = one_row

    def test_a_filter_that_matches_nothing_stops_at_the_scan_bound(self):
        self.deep(self.nodes.children)
        answer = shims.files(limit=1, paginated=True, file_kinds=["Folder"])
        self.assertEqual(answer["rows"], [])
        self.assertEqual(self.nodes.children.call_count, 10)

    def test_a_filtered_page_that_stopped_at_the_bound_still_says_there_is_more(self):
        """The walk stopped reading, so the rows it kept are not the whole
        match set and their number cannot say the listing is finished."""
        self.deep(self.nodes.children)
        answer = shims.files(limit=1, paginated=True, file_kinds=["Folder"])
        self.assertTrue(answer["has_next"])

    def test_a_search_that_matches_nothing_stops_at_the_same_bound(self):
        """`recents` is the one view that keeps its own order, so a search on
        it reaches `_listing` rather than the ordered walk."""
        self.deep(self.nodes.views)
        answer = shims.recents(limit=1, paginated=True, search="no such title")
        self.assertEqual(answer["rows"], [])
        self.assertEqual(self.nodes.views.call_count, 10)

    def test_an_unfiltered_walk_has_a_ceiling_of_its_own(self):
        """A caller who can read almost nothing walks a large folder a page at
        a time. `decode_cursor` refuses only at offset ten million, which is
        not a bound."""
        self.nodes.MAX_PAGE_SIZE = 200
        self.nodes.children.side_effect = lambda *a, **k: {
            "rows": [],
            "next_cursor": "c1" if self.nodes.children.call_count < self.DEEPER_THAN_ANY_BOUND else None,
        }
        answer = shims.files(limit=1, paginated=True)
        self.assertEqual(answer["rows"], [])
        self.assertEqual(self.nodes.children.call_count, 200)

    def test_an_unfiltered_page_still_asks_for_exactly_what_it_needs(self):
        """Every row the workflow returns is a row the page keeps, so asking
        for the whole window would overshoot: the surplus is cut to fit while
        `next_cursor` has already moved past it."""
        self.deep(self.nodes.children)
        answer = shims.files(limit=3, paginated=True)
        self.assertEqual(len(answer["rows"]), 3)
        self.assertEqual(self.nodes.children.call_count, 3)
        self.assertEqual([call.kwargs["limit"] for call in self.nodes.children.call_args_list], [3, 2, 1])

    def test_a_filtered_page_reads_full_windows_and_counts_the_matches(self):
        """`start` and `limit` counted matching rows on the old surface: page
        two of a PDF-only folder began at the twenty-first PDF, not at the
        twenty-first child. The page is cut to `limit` after the filter."""
        self.nodes.MAX_PAGE_SIZE = 200
        self.nodes.children.return_value = {
            "rows": [node_row(name=f"n{i}", mime="application/pdf") for i in range(4)]
            + [node_row(name="d1", kind="folder", mime=None)],
            "next_cursor": None,
        }
        answer = shims.files(start=1, limit=2, paginated=True, file_kinds=["PDF"])
        self.assertEqual(self.nodes.children.call_args.kwargs["limit"], 200)
        self.assertEqual([row["name"] for row in answer["rows"]], ["n1", "n2"])
        self.assertEqual(answer["next_start"], 3)
        self.assertTrue(answer["has_next"])

    def test_a_filtered_page_walks_from_the_top_whatever_offset_it_is_given(self):
        """A cursor built from `start` would index unfiltered rows, so the
        filter would be applied to the wrong window entirely."""
        self.nodes.MAX_PAGE_SIZE = 200
        self.nodes.children.return_value = {
            "rows": [node_row(name=f"n{i}", mime="application/pdf") for i in range(3)],
            "next_cursor": None,
        }
        shims.files(start=40, limit=2, paginated=True, file_kinds=["PDF"])
        self.assertIsNone(self.nodes.children.call_args.kwargs["cursor"])

    def test_a_whole_view_walk_stops_reading_at_its_own_bound(self):
        """Ten windows to try to sort the view, then the over-bound fallback
        walks the filtered listing, which is bounded the same way."""
        self.deep(self.nodes.views)
        shims.shared(file_kinds=["Folder"])
        self.assertEqual(self.nodes.views.call_count, 10 + 10)


class TestListOrdering(ListCase):
    """`order_by` and `ascending` reach the three views that used to sort.

    `GenericPage.queryParams` puts both on every list request it makes, and
    `get_query_data` ordered `shared`, `favourites`, and `trash` by them. The
    frozen views carry one order each, so clicking a column header on those
    three pages changed nothing at all.
    """

    def unsorted_view(self, titles):
        rows = [node_row(name=f"n{i}", title=title) for i, title in enumerate(titles)]
        self.nodes.views.return_value = {"rows": rows, "next_cursor": None}
        self.activity.personal_marks.return_value = {}
        return rows

    def test_a_view_is_sorted_by_the_column_the_toolbar_names(self):
        for call in (shims.shared, shims.favourites, shims.trash):
            with self.subTest(view=call.__name__):
                self.unsorted_view(["Report.pdf", "Agenda.md", "Notes.txt"])
                rows = call(order_by="file_name")
                self.assertEqual(
                    [row["file_name"] for row in rows],
                    ["Agenda.md", "Notes.txt", "Report.pdf"],
                )

    def test_a_descending_sort_turns_the_whole_list_around(self):
        self.unsorted_view(["Agenda.md", "Report.pdf", "Notes.txt"])
        rows = shims.favourites(order_by="file_name", ascending=False)
        self.assertEqual(
            [row["file_name"] for row in rows],
            ["Report.pdf", "Notes.txt", "Agenda.md"],
        )

    def test_a_size_sort_reads_the_size_and_not_its_digits(self):
        rows = [
            node_row(name="n1", title="a", size=9),
            node_row(name="n2", title="b", size=1024),
            node_row(name="n3", title="c", size=100),
        ]
        self.nodes.views.return_value = {"rows": rows, "next_cursor": None}
        self.activity.personal_marks.return_value = {}
        self.assertEqual(
            [row["file_size"] for row in shims.shared(order_by="file_size")],
            [9, 100, 1024],
        )

    def test_an_unknown_column_falls_back_to_modified_on_a_view_too(self):
        rows = [
            node_row(name="n1", title="a", modified="2026-03-01"),
            node_row(name="n2", title="b", modified="2026-01-01"),
        ]
        self.nodes.views.return_value = {"rows": rows, "next_cursor": None}
        self.activity.personal_marks.return_value = {}
        self.assertEqual([row["name"] for row in shims.trash(order_by="owner")], ["n2", "n1"])

    def test_recents_keeps_the_view_order_the_old_body_kept(self):
        """`get_query_data`'s `recents_only` branch ordered by `last_interaction`
        whatever the caller named, and `Recents.vue` hides the sort control."""
        self.unsorted_view(["Report.pdf", "Agenda.md"])
        rows = shims.recents(order_by="file_name")
        self.assertEqual([row["file_name"] for row in rows], ["Report.pdf", "Agenda.md"])

    def test_a_search_is_sorted_because_the_search_view_has_its_own_order(self):
        rows = [node_row(name="n1", title="Report.pdf"), node_row(name="n2", title="Agenda.md")]
        self.nodes.views.return_value = {"rows": rows, "next_cursor": None}
        self.activity.personal_marks.return_value = {}
        answer = shims.files(search="a", order_by="file_name")
        self.assertEqual([row["file_name"] for row in answer], ["Agenda.md", "Report.pdf"])

    def test_a_second_page_continues_the_sorted_order(self):
        """A page sorted on its own restarts the order on the next scroll."""
        self.unsorted_view(["d", "b", "a", "c"])
        first = shims.shared(order_by="file_name", paginated=True, limit=2)
        self.assertEqual([row["file_name"] for row in first["rows"]], ["a", "b"])
        self.assertTrue(first["has_next"])

        self.unsorted_view(["d", "b", "a", "c"])
        second = shims.shared(order_by="file_name", paginated=True, limit=2, start=first["next_start"])
        self.assertEqual([row["file_name"] for row in second["rows"]], ["c", "d"])
        self.assertFalse(second["has_next"])

    def test_a_folder_page_is_still_sorted_by_the_workflow(self):
        """`children` sorts in SQL on the index [004] measured. Sorting the page
        again here would page a folder through memory for no gain."""
        self.one_page([node_row(name="n1", title="b"), node_row(name="n2", title="a")])
        self.activity.personal_marks.return_value = {}
        rows = shims.files(order_by="file_name")
        self.assertEqual([row["file_name"] for row in rows], ["b", "a"])
        self.assertEqual(self.nodes.children.call_args.kwargs["order_by"], "title")

    def test_a_view_past_the_bound_keeps_its_own_order_and_loses_no_row(self):
        """Sorting needs the whole list. Past the bound the view's order stands,
        because a wrong order is recoverable and a dropped file is not."""
        windows = [
            {
                "rows": [node_row(name=f"a{i}", title=f"{9999 - i}") for i in range(200)],
                "next_cursor": f"c{200 * (n + 1)}",
            }
            for n in range(11)
        ]
        windows.append({"rows": [node_row(name="last", title="0")], "next_cursor": None})
        asked: list = []

        def page(principals, name, **kwargs):
            asked.append(kwargs["limit"])
            return windows[min(len(asked) - 1, len(windows) - 1)]

        self.nodes.views.side_effect = page
        self.nodes.MAX_PAGE_SIZE = 200
        self.activity.personal_marks.return_value = {}
        rows = shims.shared(order_by="file_name", paginated=True, limit=3)

        self.assertEqual([row["file_name"] for row in rows["rows"]], ["9999", "9998", "9997"])
        self.assertTrue(rows["has_next"])


class TestMoveAnswersTheDestination(ShimCase):
    def test_move_answers_the_folder_it_moved_into(self):
        """`File.move` returned the new parent's row, and both frontend `move`
        resources read it: the toast names it, "Go" opens it as a folder, and
        `updateMoved` refreshes it. Answering the moved node sent the user into
        a file and refreshed the wrong listing.
        """
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        nodes.stored.return_value = frappe._dict(name="dest", title="Archive", parent="root")

        answer = shims.move(["n1", "n2"], new_parent="dest")

        self.assertEqual(answer, {"file_name": "Archive", "name": "dest", "folder": "root"})
        nodes.stored.assert_called_once_with("dest")
        self.assertEqual(
            [call.args[1] for call in nodes.update.call_args_list],
            ["n1", "n2"],
        )

    def test_move_with_no_destination_answers_the_caller_home_folder(self):
        self.stub_unadopted_row()
        nodes = self.stub("node_core")
        roots = self.stub("roots")
        roots.personal_root_for.return_value = "home"
        nodes.stored.return_value = frappe._dict(name="home", title="Home", parent=None)

        self.assertEqual(
            shims.move(["n1"]),
            {"file_name": "Home", "name": "home", "folder": None},
        )


class TestNotificationRouting(ShimCase):
    def notification(self, node: str):
        activity = self.stub("activity_core")
        activity.notifications.return_value = {
            "rows": [
                {
                    "name": "notif1",
                    "read": 0,
                    "creation": "2026-01-01",
                    "activity": {"actor": "a@example.com", "action": "share_add", "node": node},
                }
            ],
            "next_cursor": None,
        }

    def test_a_notification_carries_the_entity_type_the_page_routes_on(self):
        """`Notifications.vue` pushes `drive-` + `row.entity_type`. A null makes
        every row on that page unclickable, which is what `entity_type: None`
        did. Legacy stored "Document", "Folder", or "File".
        """
        cases = {
            "folder": ("Folder", "application/pdf"),
            "root": ("Folder", "application/pdf"),
            "document": ("Document", "frappe_doc"),
            "file": ("File", "application/pdf"),
        }
        for kind, (expected, mime) in cases.items():
            with self.subTest(kind=kind):
                self.notification("n1")
                with patch.object(
                    shims.frappe,
                    "get_all",
                    return_value=[{"name": "n1", "kind": kind, "mime": mime, "title": "Notes"}],
                ):
                    rows = shims.get_notifications()
                self.assertEqual(rows[0]["entity_type"], expected)

    def test_a_notification_whose_node_is_gone_stays_unroutable(self):
        self.notification("n1")
        with patch.object(shims.frappe, "get_all", return_value=[]):
            rows = shims.get_notifications()
        self.assertIsNone(rows[0]["entity_type"])


# --------------------------------------------------------------------------
# What must not move
# --------------------------------------------------------------------------


class TestPermanentSurface(ShimCase):
    def test_the_stored_s3_url_entry_point_still_resolves_a_stored_url(self):
        source = source_of("api.s3.fetch")
        self.assertIn("get_s3_url(path)", source)
        self.assertIn("get_file_content(name)", source)
        self.assertEqual(whitelisted_names()["api.s3.fetch"], True)

    def test_the_s3_entry_point_answers_one_refusal_for_missing_and_denied(self):
        """It is guest-callable and its argument is a guessable path.

        The old body caught `PermissionError` and answered `DoesNotExistError`,
        so a denied object and an absent one read the same. `get_file_content`
        is a §11.7 forwarder now and refuses with the `_core` classes, which
        that clause did not name: a denied read answered 403 and confirmed the
        object exists.

        The base class is named, not the two leaves. A locked link is 401 and
        an expired one is 410, and either one on this guessable path is the
        same disclosure the 403 was.
        """
        from suite.drive.api import s3

        caught = next(
            node.type
            for node in ast.walk(ast.parse(source_of("api.s3.fetch")))
            if isinstance(node, ast.ExceptHandler)
        )
        named = {getattr(element, "attr", getattr(element, "id", "")) for element in caught.elts}
        self.assertEqual(named, {"PermissionError", "DoesNotExistError", "DriveError"})
        for error in (frappe.PermissionError, DriveForbidden, DriveNotFound, DriveLocked, DriveLinkExpired):
            with (
                self.subTest(error=error.__name__),
                patch.object(s3, "get_file_content", side_effect=error("no")),
                patch.object(s3, "get_s3_url", return_value="u"),
                local_attribute("db", MagicMock(get_value=lambda *a, **k: "n1")),
                self.assertRaises(frappe.DoesNotExistError),
            ):
                s3.fetch("some/key")

    def test_get_file_for_doc_still_answers_the_entity_payload(self):
        source = source_of("overrides.file.get_file_for_doc")
        self.assertIn("get_entity_with_permissions(file)", source)
        self.assertEqual(whitelisted_names()["overrides.file.get_file_for_doc"], False)

    def test_every_permanent_name_is_byte_for_byte_the_body_it_always_was(self):
        """ "Permanent" is checked against the tree, not against a phrase.

        A substring assertion passes on a body that kept the line it greps for
        and changed everything around it. Each of the twenty-one is compared
        with its own structure at `BASE_REVISION`: decorators, signature, and
        every statement. Comments and docstrings are excluded, so prose may be
        corrected and code may not.
        """
        permanent = shims.names_of("permanent")
        self.assertEqual(len(permanent), 21)
        # One deliberate exception, asserted on its own above: `api.s3.fetch`
        # widened its `except` clause so a denied stored URL still answers 404.
        for name in sorted(set(permanent) - {"api.s3.fetch"}):
            with self.subTest(name=name):
                self.assertEqual(current_shape(name), original_shape(name))

    def test_the_guest_flag_of_every_legacy_name_is_the_one_it_had(self):
        """Guest reach is the one property no reclassification may move."""
        now = whitelisted_names()
        import subprocess

        before: dict[str, bool] = {}
        for relative, prefix in LEGACY_MODULES.items():
            text = subprocess.run(
                ["git", "-C", str(APP.parent), "show", f"{BASE_REVISION}:suite/{relative}"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            before |= _guest_flags(text, prefix)
        self.assertEqual(before, now)

    def test_the_dav_contract_is_still_mounted(self):
        from suite import hooks

        self.assertIn("/dav", hooks.ALLOWED_PATHS)
        self.assertIn("/dav/", hooks.ALLOWED_WILDCARD_PATHS)
        self.assertIn("/dav/", hooks.streaming_request_paths)
        self.assertIn("suite.drive.webdav.dispatch.handle_before_request", hooks.before_request)

    def test_the_route_namespace_was_added_without_removing_the_method_prefix(self):
        from suite import hooks

        self.assertIn("/api/suite/drive/", hooks.ALLOWED_WILDCARD_PATHS)
        self.assertIn("/api/method/suite.drive.api.", hooks.ALLOWED_WILDCARD_PATHS)
        self.assertEqual(hooks.DENIED_WILDCARD_PATHS, ["/api/"])

    def test_activation_removed_none_of_the_legacy_surface(self):
        """Ticket 29 filled `drive_content_types`; §11.7 still answers.

        Registering the three content types is not the removal §14.10 does.
        Cleanup deletes this module and the legacy method prefix together, one
        release later, so the whole shim surface has to survive activation.
        """
        from suite import hooks

        self.assertEqual(
            hooks.drive_content_types,
            ["suite.writer.drive.SPEC", "suite.slides.drive.SPEC", "suite.sheets.drive.SPEC"],
        )
        self.assertIn("/api/method/suite.drive.api.", hooks.ALLOWED_WILDCARD_PATHS)
        self.assertEqual(len(shims.CLASSIFICATION), 69)


if __name__ == "__main__":
    unittest.main()


class TestLegacyRefusalMessages(ShimCase):
    """A legacy client reads the message, not the exception class.

    `report_error` copies a message into the response only when `msgprint`
    stamped one on, which `frappe.throw` does and a bare `raise` does not. The
    workflows raise, so without a boundary here a legacy caller reads a status
    code and nothing else: `FileUploader.vue` reads `_server_messages` alone
    and prints "Please contact support." for anything it finds nothing in.
    """

    def test_every_shim_a_legacy_module_reaches_speaks_through_the_boundary(self):
        silent = sorted(
            name
            for name in shim_entry_points()
            if not getattr(getattr(shims, name), "legacy_boundary", False)
        )
        self.assertEqual(silent, [])

    def test_a_workflow_refusal_reaches_the_client_with_its_message(self):
        nodes = self.stub("node_core")
        self.stub_unadopted_row()
        nodes.update.side_effect = DriveForbidden("Ask the folder owner for upload access")
        frappe.clear_messages()
        with self.assertRaises(DriveForbidden):
            shims.rename("n1", "Report.pdf")
        self.assertIn("Ask the folder owner for upload access", str(frappe.local.message_log))

    def test_the_boundary_keeps_the_class_its_status_code_comes_from(self):
        """§11.6 reads the code off the class. Remapping every refusal to one
        of them would answer 400 for a missing node and for a full disk."""
        nodes = self.stub("node_core")
        self.stub_unadopted_row()
        for error in (DriveNotFound, DriveForbidden, DriveConflict):
            with self.subTest(error=error.__name__):
                nodes.update.side_effect = error("no")
                with self.assertRaises(error):
                    shims.rename("n1", "Report.pdf")


class TestShareMarkers(ShimCase):
    """`share_count` is three different answers in one integer field.

    Legacy read local rows only - `DrivePermission.entity.isin(names)` - so a
    child of a published folder counted zero, and this reads the same way.
    """

    def counts(self, rows):
        with patch.object(shims.frappe, "get_all", return_value=rows) as read:
            answer = shims._share_counts(["n1", "n2"])
        return answer, read

    def test_a_person_counts_and_a_link_does_not(self):
        """A share link is not a person, and the old count excluded the two
        site-wide rows by name (`user.notin(["", GENERAL_USER])`)."""
        answer, _ = self.counts(
            [
                {"node": "n1", "principal": "b@example.com"},
                {"node": "n1", "principal": "c@example.com"},
                {"node": "n1", "principal": "$LINK:tokentokentoken"},
            ]
        )
        self.assertEqual(answer, {"n1": 2, "n2": 0})

    def test_published_beats_site_wide_and_both_beat_a_count(self):
        """-2 published, -1 every signed-in user. A node carrying both is
        published, which is the wider of the two."""
        answer, _ = self.counts(
            [
                {"node": "n1", "principal": "$PUBLIC"},
                {"node": "n1", "principal": "$GENERAL"},
                {"node": "n1", "principal": "b@example.com"},
                {"node": "n2", "principal": "$GENERAL"},
            ]
        )
        self.assertEqual(answer, {"n1": -2, "n2": -1})

    def test_a_denied_row_is_not_a_share(self):
        """Role 0 is §5.10's deny. Counting it would report a share to the one
        person the node is closed to."""
        with patch.object(shims.frappe, "get_all", return_value=[]) as read:
            shims._share_counts(["n1"])
        self.assertEqual(read.call_args.kwargs["filters"]["role"], [">", 0])

    def test_no_names_asks_nothing(self):
        with patch.object(shims.frappe, "get_all") as read:
            self.assertEqual(shims._share_counts([]), {})
        read.assert_not_called()


class TestDirectoryUploadGate(ShimCase):
    """`fullpath` makes a browser's directory upload create folders.

    `_child_named` reads an id out of the table directly, so the question it
    answers has to be gated first. `title_taken` is that gate and it requires
    UPLOAD, for the reason `does_entity_exist` did: an answer about a folder
    the caller cannot write to is an enumeration oracle.
    """

    def database(self):
        """`frappe.db` is a bound proxy, and this suite runs with no site."""
        return self.enterContext(local_attribute("db", MagicMock()))

    def test_a_caller_who_cannot_upload_reads_no_id(self):
        nodes = self.stub("node_core")
        nodes.title_taken.return_value = False
        db = self.database()
        self.assertIsNone(shims._child_named(SOMEONE, "f1", "Photos"))
        db.get_value.assert_not_called()

    def test_a_taken_title_answers_the_active_child(self):
        nodes = self.stub("node_core")
        nodes.title_taken.return_value = True
        db = self.database()
        db.get_value.return_value = "n9"
        self.assertEqual(shims._child_named(SOMEONE, "f1", "Photos"), "n9")
        self.assertEqual(
            db.get_value.call_args.args[1],
            {"parent": "f1", "title": "Photos", "state": "Active"},
        )

    def test_a_path_reuses_a_folder_it_finds_and_makes_the_rest(self):
        nodes = self.stub("node_core")
        nodes.create_folder.return_value = "n-new"
        with patch.object(shims, "_child_named", side_effect=["n-photos", None]):
            leaf = shims._ensure_path(SOMEONE, "Photos/2026/beach.jpg", "f1")
        self.assertEqual(leaf, "n-new")
        nodes.create_folder.assert_called_once_with(SOMEONE, "n-photos", "2026")


class TestLocalStoreIsPutBack(UnitTestCase):
    """The store these suites borrow is the one `bench run-tests` cleans up with.

    `frappe.local` is a contextvar store with `__slots__ = ()`. `mock` reads a
    patched name out of the target's `__dict__` to decide whether to restore
    it; there is none here, so with `create=True` it deletes the name on exit
    and never puts the old value back. A suite that borrowed `db` that way left
    `frappe.db` unbound, and `_cleanup_after_tests` raised "object is not
    bound" after all 263 tests had passed - `bench` exited 1 under `OK`.
    """

    def test_a_borrowed_name_is_the_value_it_was(self):
        frappe.local.borrowed = "real"
        try:
            with local_attribute("borrowed", "stub") as lent:
                self.assertEqual(lent, "stub")
                self.assertEqual(frappe.local.borrowed, "stub")
            self.assertEqual(frappe.local.borrowed, "real")
        finally:
            delattr(frappe.local, "borrowed")

    def test_a_name_the_store_never_held_is_gone_again(self):
        self.assertFalse(hasattr(frappe.local, "never_held"))
        with local_attribute("never_held", "stub"):
            self.assertEqual(frappe.local.never_held, "stub")
        self.assertFalse(hasattr(frappe.local, "never_held"))

    def test_a_refusal_inside_the_loan_still_puts_the_name_back(self):
        frappe.local.borrowed = "real"
        try:
            with self.assertRaises(ValueError), local_attribute("borrowed", "stub"):
                raise ValueError("no")
            self.assertEqual(frappe.local.borrowed, "real")
        finally:
            delattr(frappe.local, "borrowed")

    def test_no_suite_in_this_package_patches_the_store_through_mock(self):
        """The ban, not the symptom: `mock` cannot restore a name here at all.

        `db` was the fatal one, because cleanup commits through it. `request`
        and `form_dict` are deleted just as silently, and the next module in a
        multi-module run starts without them.
        """
        offenders = []
        for path in sorted(pathlib.Path(__file__).parent.glob("*.py")):
            for node in ast.walk(ast.parse(path.read_text())):
                if not isinstance(node, ast.Call):
                    continue
                if getattr(node.func, "attr", None) != "object" or not node.args:
                    continue
                target = node.args[0]
                if getattr(target, "attr", None) == "local":
                    offenders.append(f"{path.name}:{node.lineno}")
        self.assertEqual(offenders, [], "use `local_attribute` instead of `patch.object`")
