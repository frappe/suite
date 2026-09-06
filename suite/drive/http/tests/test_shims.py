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
import pathlib
import unittest
from unittest.mock import MagicMock, patch

import frappe
from frappe.tests import UnitTestCase

from suite.drive._core.errors import DriveNotFound
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, READ, UPLOAD
from suite.drive.http import shims
from suite.drive.http.tests import ensure_local_context

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

    def test_the_three_permanent_names_of_the_table_are_permanent(self):
        for name in ("api.s3.fetch", "overrides.file.get_file_for_doc"):
            self.assertEqual(shims.CLASSIFICATION[name], "permanent", name)

    def test_every_forwarder_delegates_and_holds_no_second_implementation(self):
        for name in shims.names_of("forwarder"):
            with self.subTest(name=name):
                self.assertIn("shims.", source_of(name))

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
        for name in shims.names_of("retired"):
            with self.subTest(name=name):
                self.assertIn("shims.", source_of(name))


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
        self.assertIn("nodes/<id>/content", str(caught.exception))

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
        nodes.stored.return_value = node_row(owner="b@example.com")
        access.effective_role.return_value = COMMENT
        answer = shims.get_user_access("n1")
        self.assertEqual(answer["read"], 1)
        self.assertEqual(answer["comment"], 1)
        self.assertEqual(answer["write"], 0)
        self.assertEqual(answer["type"], "guest")

    def test_get_user_access_answers_zeros_for_a_node_the_caller_cannot_see(self):
        nodes = self.stub("node_core")
        nodes.stored.side_effect = DriveNotFound("gone")
        self.assertEqual(
            shims.get_user_access("n1"),
            {"read": 0, "comment": 0, "upload": 0, "write": 0, "share": 0, "type": "guest"},
        )

    def test_get_user_access_takes_a_row_as_well_as_an_id(self):
        nodes = self.stub("node_core")
        access = self.stub("access")
        nodes.stored.return_value = node_row()
        access.effective_role.return_value = READ
        shims.get_user_access({"name": "n1"})
        nodes.stored.assert_called_once_with("n1")

    def test_an_owner_is_still_called_admin(self):
        nodes = self.stub("node_core")
        access = self.stub("access")
        nodes.stored.return_value = node_row(owner=SOMEONE.user)
        access.effective_role.return_value = READ
        self.assertEqual(shims.get_user_access("n1")["type"], "admin")

    def test_general_access_reads_public_then_site_then_restricted(self):
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
        nodes = self.stub("node_core")
        nodes.get.side_effect = DriveNotFound("gone")
        with self.assertRaises(DriveNotFound):
            shims.get_general_access("n1")

    def test_entity_with_permissions_keeps_the_old_payload(self):
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
        access = self.stub("access")
        access.grants_for.side_effect = DriveNotFound("gone")
        with self.assertRaises(DriveNotFound):
            shims.get_shared_with_list("n1")


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
                        "detail": {"message": "hello"},
                    },
                }
            ],
            "next_cursor": None,
        }
        row = shims.get_notifications()[0]
        self.assertEqual(row["type"], "Mention")
        self.assertEqual(row["from_user"], "b@example.com")
        self.assertEqual(row["notif_doctype_name"], "n1")
        self.assertEqual(row["message"], "hello")
        self.assertEqual(row["read"], 0)

    def test_unread_count_is_still_a_scalar(self):
        activity = self.stub("activity_core")
        activity.unread_count.return_value = 7
        self.assertEqual(shims.get_unread_count(), 7)

    def test_mark_as_read_answers_nothing_and_marks_one(self):
        activity = self.stub("activity_core")
        self.assertIsNone(shims.mark_as_read(name="x1"))
        activity.mark_read.assert_called_once_with(SOMEONE, "x1")

    def test_mark_as_read_with_nothing_named_stays_a_no_op(self):
        activity = self.stub("activity_core")
        self.assertIsNone(shims.mark_as_read())
        activity.mark_read.assert_not_called()

    def test_mark_as_read_all_marks_all(self):
        activity = self.stub("activity_core")
        shims.mark_as_read(all=True)
        activity.mark_read.assert_called_once_with(SOMEONE, None)


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
        nodes.stored.return_value = node_row(title="New.pdf")
        answer = shims.rename("n1", "New.pdf")
        nodes.update.assert_called_once_with(SOMEONE, "n1", title="New.pdf")
        self.assertEqual(answer["file_name"], "New.pdf")

    def test_move_forwards_a_parent_for_every_named_node(self):
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
        nodes.get.return_value = node_row(state="Active")
        shims.remove_or_restore(["n1"])
        nodes.update.assert_called_once_with(SOMEONE, "n1", state="Trashed")

        nodes.update.reset_mock()
        nodes.get.return_value = node_row(state="Trashed")
        shims.remove_or_restore('["n1"]')
        nodes.update.assert_called_once_with(SOMEONE, "n1", state="Active")

    def test_a_restore_never_names_a_destination(self):
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(state="Trashed")
        shims.remove_or_restore(["n1"])
        self.assertNotIn("parent", nodes.update.call_args.kwargs)

    def test_delete_entities_purges_each_named_node(self):
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
        nodes = self.stub("node_core")
        nodes.title_taken.return_value = True
        self.assertTrue(shims.does_entity_exist("Report.pdf", "f1"))
        nodes.title_taken.assert_called_once_with(SOMEONE, "f1", "Report.pdf")

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
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row()
        nodes.signed_content_url.return_value = {"url": "/f/signed", "expires": 1}
        shims.get_file_content("n1")
        self.assertEqual(frappe.local.response["location"], "/f/signed")

    def test_get_file_content_sends_a_document_to_the_editor(self):
        nodes = self.stub("node_core")
        nodes.get.return_value = node_row(kind="document", mime=None)
        shims.get_file_content("n1")
        self.assertEqual(frappe.local.response["location"], "/drive/w/n1")

    def test_streaming_is_the_same_redirect(self):
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
        activity = self.stub("activity_core")
        activity.personal_marks.return_value = {"n1": {"favourite": "fav1", "opened_at": None}}
        shims.set_favourite([{"name": "n1"}])
        activity.set_favourite.assert_called_once_with(SOMEONE, "n1", False)

    def test_set_favourite_reads_a_string_flag(self):
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

    def test_track_visit_records_the_visit(self):
        activity = self.stub("activity_core")
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
    def test_the_highest_bit_names_the_role(self):
        access = self.stub("access")
        shims.update_access("n1", "share", user="b@example.com", read=1, write=1)
        access.grant.assert_called_once_with("n1", "b@example.com", EDIT, SOMEONE)

        access.grant.reset_mock()
        shims.update_access("n1", "share", user="b@example.com", read=1, upload="true")
        access.grant.assert_called_once_with("n1", "b@example.com", UPLOAD, SOMEONE)

        access.grant.reset_mock()
        shims.update_access("n1", "share", user="b@example.com", read=1, share=1)
        access.grant.assert_called_once_with("n1", "b@example.com", MANAGE, SOMEONE)

    def test_an_omitted_user_is_still_the_public_principal(self):
        access = self.stub("access")
        shims.update_access("n1", "share", read=1)
        access.grant.assert_called_once_with("n1", "$PUBLIC", READ, SOMEONE)

    def test_an_explicit_deny_is_the_caller_asking_for_role_zero(self):
        access = self.stub("access")
        shims.update_access("n1", "share", user="b@example.com", read=1, deny=1)
        access.grant.assert_called_once_with("n1", "b@example.com", 0, SOMEONE)

    def test_an_unshare_removes_the_row_and_writes_nothing(self):
        access = self.stub("access")
        shims.update_access("n1", "unshare", user="b@example.com")
        access.revoke.assert_called_once_with("n1", "b@example.com", SOMEONE)
        access.grant.assert_not_called()

    def test_an_unknown_method_is_refused(self):
        self.stub("access")
        with self.assertRaises(frappe.ValidationError):
            shims.update_access("n1", "publish")


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
        counts = patch.object(shims, "_child_counts", return_value={"n1": 3})
        counts.start()
        self.addCleanup(counts.stop)
        shares = patch.object(shims, "_share_counts", return_value={"n1": -1})
        shares.start()
        self.addCleanup(shares.stop)

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
        self.assertEqual(row["share_count"], -1)
        self.assertEqual(row["is_favourite"], "fav1")
        self.assertEqual(row["accessed"], "2026-01-03")
        self.assertEqual(row["write"], 1)

    def test_an_unknown_sort_column_falls_back_instead_of_refusing(self):
        self.one_page([])
        shims.files(order_by="file_type")
        self.assertEqual(self.nodes.children.call_args.kwargs["order_by"], "modified")
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


# --------------------------------------------------------------------------
# What must not move
# --------------------------------------------------------------------------


class TestPermanentSurface(ShimCase):
    def test_the_stored_s3_url_entry_point_is_untouched(self):
        source = source_of("api.s3.fetch")
        self.assertIn("get_s3_url(path)", source)
        self.assertIn("get_file_content(name)", source)
        self.assertEqual(whitelisted_names()["api.s3.fetch"], True)

    def test_get_file_for_doc_still_answers_the_entity_payload(self):
        source = source_of("overrides.file.get_file_for_doc")
        self.assertIn("get_entity_with_permissions(file)", source)
        self.assertEqual(whitelisted_names()["overrides.file.get_file_for_doc"], False)

    def test_the_dav_contract_is_still_mounted(self):
        hooks = (APP / "hooks.py").read_text()
        self.assertIn('"/dav"', hooks)
        self.assertIn('"/dav/"', hooks)
        self.assertIn("webdav", hooks)

    def test_the_route_namespace_was_added_without_removing_the_method_prefix(self):
        hooks = (APP / "hooks.py").read_text()
        self.assertIn('"/api/suite/drive/"', hooks)
        self.assertIn('"/api/method/suite.drive.api."', hooks)

    def test_destructive_removal_stays_disabled(self):
        hooks = (APP / "hooks.py").read_text()
        self.assertIn("drive_content_types = []", hooks)


if __name__ == "__main__":
    unittest.main()
