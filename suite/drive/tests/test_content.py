import inspect
import io
import json
import typing
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock, patch

import frappe
import frappe.share
from frappe.model.base_document import get_controller
from frappe.model.document import Document
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import now_datetime

from suite.drive import framework
from suite.drive._core import content
from suite.drive._core.access import grant
from suite.drive._core.content import (
    MEDIA_REFRESH_SECONDS,
    MEDIA_TTL_SECONDS,
    UNUSED_MEDIA_GRACE_DAYS,
    ContentTypeSpec,
    DriveContent,
    Satellite,
    list_media,
    registry,
    satellite_for,
    spec_for,
    sweep_unused_media,
    touch,
    validate_registry,
)
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import _link_document, copy, create_file, create_folder, purge
from suite.drive._core.nodes import create_document as create_document_node
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, READ, UPLOAD
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version, take_version
from suite.hooks import doc_events, scheduler_events
from suite.tests.utils import ensure_user, stub_db

USER = "drive-content-user@example.com"
OTHER = "drive-content-other@example.com"

CONTENT_DOCTYPE = "Drive Test Content"
SATELLITE_DOCTYPE = "Drive Test Satellite"
TITLED_DOCTYPE = "Drive Test Titled"

DAILY_DRIVE_JOBS = (
    "suite.drive.jobs.recompute_root_usage",
    "suite.drive.jobs.purge_trashed_nodes",
    "suite.drive.jobs.thin_versions",
    "suite.drive.jobs.sweep_missing_previews",
    "suite.drive.jobs.sweep_unused_document_media",
)


# The fixture content app. Its body is a JSON list of the media node ids the
# document names, which is exactly what `used_nodes` and `remap_media` have to
# read and rewrite for a real app.


class DriveTestContent(DriveContent, Document):
    pass


def create_empty(node: str) -> str:
    return _insert_content(node, [])


def duplicate(source_docname: str, node: str) -> str:
    return _insert_content(node, _body(source_docname))


def on_purge(docname: str) -> None:
    frappe.db.delete(SATELLITE_DOCTYPE, {"content": docname})
    frappe.db.delete(CONTENT_DOCTYPE, {"name": docname})


def used_nodes(docname: str) -> set[str]:
    return set(_body(docname))


def remap_media(docname: str, mapping: dict[str, str]) -> None:
    body = [mapping.get(node, node) for node in _body(docname)]
    frappe.db.set_value(CONTENT_DOCTYPE, docname, "body", json.dumps(body), update_modified=False)


def version_bytes(docname: str) -> tuple[io.BytesIO, str]:
    return io.BytesIO(json.dumps(_body(docname)).encode()), "application/json"


def restore_body(docname: str, stream) -> None:
    frappe.db.set_value(CONTENT_DOCTYPE, docname, "body", stream.read().decode(), update_modified=False)


def _insert_content(node: str, body: list[str]) -> str:
    return (
        frappe.get_doc({"doctype": CONTENT_DOCTYPE, "node": node, "body": json.dumps(body)})
        .insert(ignore_permissions=True)
        .name
    )


def _body(docname: str) -> list[str]:
    return json.loads(frappe.db.get_value(CONTENT_DOCTYPE, docname, "body") or "[]")


def spec(**overrides) -> ContentTypeSpec:
    """Build one complete fixture declaration, with overrides."""
    values = {
        "doctype": CONTENT_DOCTYPE,
        "mime": "frappe/test",
        "node_field": "node",
        "create_empty": create_empty,
        "duplicate": duplicate,
        "on_purge": on_purge,
        "used_nodes": used_nodes,
        "remap_media": remap_media,
        "version_bytes": version_bytes,
        "restore_version": restore_body,
    }
    values.update(overrides)
    return ContentTypeSpec(**values)


@contextmanager
def registered(*specs: ContentTypeSpec):
    """Register `specs` as the whole content registry for the block."""
    paths = tuple(f"drive.test.spec{index}" for index in range(len(specs)))
    lookup = dict(zip(paths, specs, strict=True))
    real_get_hooks = frappe.get_hooks

    def hooks(key, *args, **kwargs):
        if key == "drive_content_types":
            return paths
        if key in ("permission_query_conditions", "has_permission"):
            # Without this the fixture doctype has no hook entry, so a list
            # call or a row check would never reach the adapter under test.
            # §10.4 wires both entries together, so the fixture does too.
            targets = {
                "permission_query_conditions": ("doc_query_conditions", "satellite_query_conditions"),
                "has_permission": ("doc_has_permission", "satellite_has_permission"),
            }[key]
            wired = dict(real_get_hooks(key, *args, **kwargs) or {})
            for declared in specs:
                wired[declared.doctype] = [f"suite.drive.framework.{targets[0]}"]
                for satellite in declared.satellites:
                    wired[satellite.doctype] = [f"suite.drive.framework.{targets[1]}"]
            return wired
        return real_get_hooks(key, *args, **kwargs)

    with (
        patch("suite.drive._core.content.frappe.get_hooks", side_effect=hooks),
        patch("suite.drive._core.content.get_attr", side_effect=lookup.__getitem__),
    ):
        content.clear_registry_cache()
        try:
            yield
        finally:
            content.clear_registry_cache()


class TestContentContract(UnitTestCase):
    """The registry, the mixin guard, the predicates, and the job wiring."""

    def tearDown(self):
        content.clear_registry_cache()
        super().tearDown()

    def test_the_registry_is_keyed_by_doctype_and_cached_for_the_request(self):
        declared = spec()
        with registered(declared):
            self.assertEqual(registry(), {CONTENT_DOCTYPE: declared})
            self.assertIs(registry(), registry())
            self.assertIs(spec_for(CONTENT_DOCTYPE), declared)
        with registered():
            self.assertEqual(registry(), {})
            with self.assertRaises(DriveConflict):
                spec_for(CONTENT_DOCTYPE)

    def test_a_declaration_that_is_not_a_content_type_spec_is_refused(self):
        loose = type("Spec", (), {"doctype": CONTENT_DOCTYPE, "on_purge": lambda name: None})()
        with registered(loose), self.assertRaises(DriveConflict):
            registry()

    def test_each_required_callback_is_refused_when_it_is_missing(self):
        for missing in ("create_empty", "duplicate", "on_purge"):
            with self.subTest(callback=missing):
                with registered(spec(**{missing: None})), self.assertRaises(DriveConflict) as raised:
                    registry()
                self.assertIn(missing, str(raised.exception))

    def test_an_optional_callback_may_be_absent_but_never_uncallable(self):
        with registered(spec(used_nodes=None, remap_media=None, export=None)):
            self.assertIsNone(spec_for(CONTENT_DOCTYPE).used_nodes)
        with registered(spec(used_nodes="not-callable")), self.assertRaises(DriveConflict):
            registry()

    def test_one_doctype_is_declared_once_and_never_twice(self):
        with registered(spec(), spec()), self.assertRaises(DriveConflict) as raised:
            registry()
        self.assertIn("more than once", str(raised.exception))

    def test_a_satellite_is_declared_by_one_content_type_only(self):
        satellite = Satellite(doctype=SATELLITE_DOCTYPE, link_field="content")
        second = spec(doctype="Drive Test Other", satellites=(satellite,))
        with (
            registered(spec(satellites=(satellite,)), second),
            self.assertRaises(DriveConflict) as raised,
        ):
            registry()
        self.assertIn("more than once", str(raised.exception))

    def test_satellite_for_answers_its_owning_content_type(self):
        satellite = Satellite(doctype=SATELLITE_DOCTYPE, link_field="content")
        declared = spec(satellites=(satellite,))
        with registered(declared):
            self.assertEqual(satellite_for(SATELLITE_DOCTYPE), (declared, satellite))
            with self.assertRaises(DriveConflict):
                satellite_for("Drive Test Unknown")

    def test_a_default_export_must_be_one_of_the_offered_formats(self):
        with registered(spec(default_export="pdf")), self.assertRaises(DriveConflict):
            registry()
        with registered(spec(default_export="pdf", export_formats=("pdf",))):
            self.assertEqual(spec_for(CONTENT_DOCTYPE).default_export, "pdf")

    def test_the_mixin_guard_runs_even_when_the_controller_declares_its_own(self):
        calls = []

        class Own(DriveContent):
            doctype = CONTENT_DOCTYPE
            name = "one"
            fields: typing.ClassVar[dict] = {}

            def get(self, field):
                return self.fields.get(field)

            def before_insert(self):
                calls.append("own")

        doc = Own()
        with registered(spec()), stub_db(MagicMock()) as db:
            db.get_value.return_value = None
            with self.assertRaises(DriveConflict):
                doc.before_insert()
            self.assertEqual(calls, [], "the node guard runs before the app's own hook")

            doc.fields = {"node": "node-a"}
            db.get_value.return_value = frappe._dict(kind="document", content_docname="one")
            doc.before_insert()
        self.assertEqual(calls, ["own"], "and the app's own hook still runs")

    def test_the_node_accessor_takes_the_link_write_back_frappe_always_does(self):
        # `_validate_links` assigns every Link field the name it just read
        # (`frappe/model/base_document.py:1159`). While `node` was read-only,
        # every insert of a content doctype whose node field is called `node`,
        # which is what §10.7 declares for every app, died there.
        class Own(DriveContent):
            doctype = CONTENT_DOCTYPE

            def __init__(self):
                self.fields = {}

            def get(self, field):
                return self.fields.get(field)

            def set(self, field, value):
                self.fields[field] = value

        doc = Own()
        with registered(spec()):
            doc.node = "node-a"
            self.assertEqual(doc.fields, {"node": "node-a"})
            self.assertEqual(doc.node, "node-a")
        with registered(spec(node_field="body")):
            doc.fields = {}
            doc.node = "node-b"
            self.assertEqual(doc.fields, {"body": "node-b"}, "the declared field, not the accessor name")

    def test_a_document_that_names_another_node_is_refused(self):
        doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="one", node="node-a")
        with registered(spec()), stub_db(MagicMock()) as db:
            db.get_value.return_value = frappe._dict(kind="document", content_docname="two")
            with self.assertRaises(DriveConflict):
                content.require_node(doc)
            db.get_value.return_value = frappe._dict(kind="folder", content_docname=None)
            with self.assertRaises(DriveConflict):
                content.require_node(doc)
            db.get_value.return_value = frappe._dict(kind="document", content_docname="one")
            content.require_node(doc)

    def test_a_used_nodes_answer_must_be_a_set_of_node_ids(self):
        for answer in ("node-a", {1}, None, {""}):
            with self.subTest(answer=answer), self.assertRaises(DriveConflict):
                content._validated_used_nodes(answer)
        self.assertEqual(content._validated_used_nodes(["a", "b"]), {"a", "b"})

    def test_a_content_type_without_used_nodes_is_skipped_by_the_sweep(self):
        with registered(spec(used_nodes=None)), stub_db(MagicMock()) as db:
            self.assertEqual(
                sweep_unused_media(),
                {"documents": 0, "trashed": 0, "skipped": 0, "failed": 0, "cursor": None},
            )
            db.sql.assert_not_called()

    def test_the_media_ttl_is_fifteen_minutes_and_the_page_refreshes_at_ten(self):
        self.assertEqual(MEDIA_TTL_SECONDS, 15 * 60)
        self.assertEqual(MEDIA_REFRESH_SECONDS, 10 * 60)
        self.assertEqual(UNUSED_MEDIA_GRACE_DAYS, 7)

    def test_the_hook_targets_keep_the_framework_keyword_signatures(self):
        for name in ("doc_has_permission", "satellite_has_permission"):
            with self.subTest(hook=name):
                signature = inspect.signature(getattr(framework, name))
                self.assertEqual(list(signature.parameters), ["doc", "ptype", "user", "debug"])
        for name in ("doc_query_conditions", "satellite_query_conditions"):
            with self.subTest(hook=name):
                signature = inspect.signature(getattr(framework, name))
                self.assertEqual(list(signature.parameters), ["user", "doctype"])
                self.assertEqual(signature.parameters["doctype"].default, None)

    def test_the_list_predicate_disappears_for_an_admin_and_refuses_a_stranger(self):
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        nobody = Principals("Guest", (), ())
        with patch("suite.drive.framework.principals_for", return_value=admin):
            self.assertEqual(framework._list_predicate("`tabX`.`node`", None), "")
        with patch("suite.drive.framework.principals_for", return_value=nobody):
            self.assertEqual(framework._list_predicate("`tabX`.`node`", None), "1=0")

    def test_the_list_predicate_reads_the_whole_ancestor_chain_and_denies_nearest(self):
        person = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))
        with (
            patch("suite.drive.framework.principals_for", return_value=person),
            patch("suite.drive.framework.now", return_value="2026-09-06 00:00:00"),
        ):
            predicate = framework._list_predicate("`tabWriter Document`.`node`", None)
        # the node itself, its root, and every ancestor in the path decide
        self.assertIn("`drive_own`.`node` = `drive_node`.`name`", predicate)
        self.assertIn("`drive_own`.`node` = `drive_node`.`root`", predicate)
        self.assertIn("LOCATE(CONCAT('/', `drive_own`.`node`, '/'), `drive_node`.`path`)", predicate)
        # nearest wins, and a deny at that depth beats an allow beside it
        self.assertIn("MAX((CASE WHEN `drive_own_deep`.`node`", predicate)
        self.assertIn("CASE WHEN MIN(`drive_own`.`role`) = 0 THEN 0", predicate)
        self.assertIn("COALESCE((SELECT CASE WHEN MIN(`drive_own`.`role`) = 0", predicate)
        self.assertIn(", -1) <> 0", predicate)
        self.assertIn(f">= {READ}", predicate)
        # the two passes stay separate and only the open pass skips locked links
        self.assertIn("`drive_open`.`principal` IN ('$PUBLIC')", predicate)
        self.assertIn("`drive_open`.`password_hash` IS NULL", predicate)
        self.assertNotIn("`drive_own`.`password_hash`", predicate)
        self.assertIn("`drive_node`.`name` = `tabWriter Document`.`node`", predicate)
        self.assertIn("`drive_node`.`state` = 'Active'", predicate)
        self.assertIn("expires_on` > '2026-09-06 00:00:00'", predicate)

    def test_the_query_hooks_answer_nothing_without_a_doctype(self):
        self.assertEqual(framework.doc_query_conditions(user=USER), "")
        self.assertEqual(framework.satellite_query_conditions(user=USER), "")

    def test_the_satellite_predicate_resolves_through_its_content_document(self):
        person = Principals(USER, (USER,), ())
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with (
            registered(declared),
            patch("suite.drive.framework.principals_for", return_value=person),
            # the list guard below reads the share table; there is none here
            patch("suite.drive.framework.is_drive_admin", return_value=False),
            patch("frappe.share.get_shared", return_value=[]),
        ):
            predicate = framework.satellite_query_conditions(user=USER, doctype=SATELLITE_DOCTYPE)
        self.assertTrue(predicate.startswith(f"`tab{SATELLITE_DOCTYPE}`.`content` IN ("))
        self.assertIn(f"FROM `tab{CONTENT_DOCTYPE}` `drive_content_owner`", predicate)
        self.assertIn("`drive_node`.`name` = `drive_content_owner`.`node`", predicate)

    def test_boot_validation_resolves_the_controller_the_framework_way(self):
        # `Meta` carries no `get_controller`, so reading it through the meta
        # made every declaration die with an AttributeError before it could be
        # judged, and boot validation refused nothing at all.
        self.assertIs(content.get_controller, get_controller)
        with patch("suite.drive._core.content.get_controller", return_value=DriveTestContent):
            content._validate_mixin(CONTENT_DOCTYPE)
        with (
            patch("suite.drive._core.content.get_controller", return_value=Document),
            self.assertRaises(DriveConflict),
        ):
            content._validate_mixin(CONTENT_DOCTYPE)

    def test_the_mixin_guard_runs_when_another_base_owns_the_hook(self):
        calls = []

        class Legacy:
            def before_insert(self):
                calls.append("legacy")

        class Inherited(Legacy, DriveContent):
            doctype = CONTENT_DOCTYPE
            name = "one"
            fields: typing.ClassVar[dict] = {}

            def get(self, field):
                return self.fields.get(field)

        doc = Inherited()
        with registered(spec()), stub_db(MagicMock()) as db:
            db.get_value.return_value = None
            with self.assertRaises(DriveConflict):
                doc.before_insert()
            self.assertEqual(calls, [], "an inherited hook cannot displace the node guard")

            doc.fields = {"node": "node-a"}
            db.get_value.return_value = frappe._dict(kind="document", content_docname="one")
            doc.before_insert()
        self.assertEqual(calls, ["legacy"])

    def test_a_saved_document_cannot_repoint_itself_at_another_node(self):
        doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="one", node="node-b")
        with registered(spec()), stub_db(MagicMock()) as db:
            db.get_value.return_value = "node-a"
            with self.assertRaises(DriveConflict):
                content.refuse_node_change(doc)
            db.get_value.return_value = "node-b"
            content.refuse_node_change(doc)
            db.get_value.return_value = None
            content.refuse_node_change(doc)
            content.refuse_node_change(frappe._dict(doctype=CONTENT_DOCTYPE, name=None, node="node-b"))

    def test_an_app_callback_cannot_end_the_drive_transaction(self):
        class Handle:
            _disable_transaction_control = 0

        with stub_db(Handle()):
            with content.app_callback():
                self.assertEqual(frappe.db._disable_transaction_control, 1)
                with content.app_callback():
                    self.assertEqual(frappe.db._disable_transaction_control, 2)
                self.assertEqual(frappe.db._disable_transaction_control, 1)
            self.assertEqual(frappe.db._disable_transaction_control, 0)

            with self.assertRaises(ValueError), content.app_callback():
                raise ValueError("the app factory failed")
            self.assertEqual(frappe.db._disable_transaction_control, 0, "restored on the failing path")

    def test_a_missing_ptype_asks_for_read_and_never_for_edit(self):
        # `get_doc_permissions` calls the row hook with no ptype at all, so a
        # fallback to Edit hides a document from every Read-only viewer.
        self.assertEqual(framework._role_for_ptype(None), READ)
        self.assertEqual(framework._role_for_ptype("read"), READ)
        self.assertEqual(framework._role_for_ptype("write"), EDIT)

        seen = []
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        doc = frappe._dict(doctype=SATELLITE_DOCTYPE, content="one")
        with (
            registered(declared),
            stub_db(MagicMock()) as db,
            patch("suite.drive.framework._node_allows") as allows,
        ):
            db.get_value.return_value = "node-a"
            allows.side_effect = lambda node, role, user: seen.append(role) or True
            framework.satellite_has_permission(doc=doc, ptype=None, user=USER)
            framework.satellite_has_permission(doc=doc, ptype="write", user=USER)
        self.assertEqual(seen, [READ, EDIT])

    def test_a_child_table_satellite_is_filtered_by_its_parent_doctype(self):
        person = Principals(USER, (USER,), ())
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="parent"),))
        with (
            registered(declared),
            patch("suite.drive.framework.principals_for", return_value=person),
            # the list guard below reads the share table; there is none here
            patch("suite.drive.framework.is_drive_admin", return_value=False),
            patch("frappe.share.get_shared", return_value=[]),
        ):
            # The predicate escapes through the real connection. A stub there
            # breaks `now()`, which reads System Settings through `frappe.db`.
            predicate = framework.satellite_query_conditions(user=USER, doctype=SATELLITE_DOCTYPE)
        self.assertTrue(
            predicate.startswith(f"`tab{SATELLITE_DOCTYPE}`.`parenttype` = '{CONTENT_DOCTYPE}' AND "),
            "a name is unique per doctype, not across doctypes",
        )
        self.assertIn(f"`tab{SATELLITE_DOCTYPE}`.`parent` IN (", predicate)

    def test_a_child_table_satellite_must_belong_to_its_content_doctype(self):
        satellite = Satellite(doctype=SATELLITE_DOCTYPE, link_field="parent")
        child = frappe._dict(istable=1, fields=[])
        owns = frappe._dict(istable=0, fields=[frappe._dict(fieldtype="Table", options=SATELLITE_DOCTYPE)])
        with patch("suite.drive._core.content._meta_or_refuse", side_effect=[child, owns]):
            content._validate_satellite(satellite, CONTENT_DOCTYPE)
        with (
            patch(
                "suite.drive._core.content._meta_or_refuse",
                side_effect=[child, frappe._dict(istable=0, fields=[])],
            ),
            self.assertRaises(DriveConflict),
        ):
            content._validate_satellite(satellite, CONTENT_DOCTYPE)

    def test_a_registry_name_that_cannot_be_one_sql_identifier_is_refused(self):
        for override in ({"doctype": "Drive`Test"}, {"node_field": "node`"}, {"node_field": "1node"}):
            with (
                self.subTest(override=override),
                registered(spec(**override)),
                self.assertRaises(DriveConflict),
            ):
                registry()
        loose = Satellite(doctype=SATELLITE_DOCTYPE, link_field="par`ent")
        with registered(spec(satellites=(loose,))), self.assertRaises(DriveConflict):
            registry()

    def test_one_sweep_pass_drains_every_batch_it_can_reach(self):
        # A daily job that stops after one batch never catches up on a site
        # that changes more documents than that in a day.
        batches = [
            [
                frappe._dict(
                    name=f"node-{index}",
                    content_doctype=CONTENT_DOCTYPE,
                    content_docname=f"doc-{index}",
                    content_modified="2026-09-06 00:00:00",
                )
                for index in range(content.MEDIA_SWEEP_BATCH)
            ],
            [
                frappe._dict(
                    name="node-last",
                    content_doctype=CONTENT_DOCTYPE,
                    content_docname="doc-last",
                    content_modified="2026-09-06 00:01:00",
                )
            ],
        ]

        def sql(query, values=None, **kwargs):
            return batches.pop(0) if "kind = 'document'" in query and batches else []

        with (
            registered(spec(used_nodes=lambda docname: set())),
            stub_db(MagicMock()) as db,
            patch("suite.drive._core.content.frappe.cache") as cache,
        ):
            cache.return_value.get_value.return_value = None
            db.sql.side_effect = sql
            result = sweep_unused_media()

        self.assertEqual(result["documents"], content.MEDIA_SWEEP_BATCH + 1)
        self.assertEqual(result["cursor"], "node-last")
        self.assertEqual(batches, [])

    def test_five_daily_drive_jobs_are_registered_and_there_is_no_sixth(self):
        daily = [entry for entry in scheduler_events["daily"] if entry.startswith("suite.drive.jobs.")]
        self.assertEqual(tuple(daily), DAILY_DRIVE_JOBS)
        every = [
            method
            for event, entries in scheduler_events.items()
            for method in ([m for cron in entries.values() for m in cron] if event == "cron" else entries)
        ]
        self.assertEqual(
            [method for method in every if "grant" in method.lower()],
            [],
            "expired grants are kept for ever, so no job may sweep them",
        )
        for method in DAILY_DRIVE_JOBS:
            with self.subTest(method=method):
                self.assertTrue(callable(frappe.get_attr(method)))

    # a DocShare must not widen what the four adapters answered

    def test_a_docshare_cannot_grant_a_document_row_the_grants_refuse(self):
        # `frappe.permissions.has_permission` runs the row hook, then ORs
        # `false_if_not_shared()` over its answer. Returning False here would
        # hand the document straight back, so the adapter refuses instead.
        doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="deck-1", node="node-1")
        with (
            registered(spec()),
            patch("suite.drive.framework._node_allows", return_value=False),
            patch("frappe.share.get_shared", return_value=["deck-1"]) as shared,
            self.assertRaises(DriveForbidden),
        ):
            framework.doc_has_permission(doc=doc, ptype="read", user=OTHER)
        self.assertEqual(
            shared.call_args.kwargs,
            {"rights": ["read"], "filters": [["share_name", "=", "deck-1"]], "limit": 1},
            "the guard asks the share table exactly what the framework would ask it",
        )
        self.assertEqual(shared.call_args.args, (CONTENT_DOCTYPE, OTHER))

    def test_a_docshare_cannot_grant_a_satellite_row_the_grants_refuse(self):
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        doc = frappe._dict(doctype=SATELLITE_DOCTYPE, name="op-1", content="deck-1")
        with (
            registered(declared),
            stub_db(MagicMock()) as db,
            patch("suite.drive.framework._node_allows", return_value=False),
            patch("frappe.share.get_shared", return_value=["op-1"]),
            self.assertRaises(DriveForbidden),
        ):
            db.get_value.return_value = "node-1"
            framework.satellite_has_permission(doc=doc, ptype="write", user=OTHER)

    def test_a_row_the_grants_allow_never_reads_the_share_table(self):
        doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="deck-1", node="node-1")
        with (
            registered(spec()),
            patch("suite.drive.framework._node_allows", return_value=True),
            patch("frappe.share.get_shared") as shared,
        ):
            self.assertTrue(framework.doc_has_permission(doc=doc, ptype="read", user=OTHER))
        shared.assert_not_called()

    def test_a_ptype_the_framework_cannot_share_stays_a_plain_refusal(self):
        # Only the six shareable rights are ever widened, so a denied delete
        # is still answered with False and costs no extra read.
        doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="deck-1", node="node-1")
        with (
            registered(spec()),
            patch("suite.drive.framework._node_allows", return_value=False),
            patch("suite.drive.framework.get_doctype_ptype_map", return_value={}),
            patch("frappe.share.get_shared") as shared,
        ):
            self.assertFalse(framework.doc_has_permission(doc=doc, ptype="delete", user=OTHER))
        shared.assert_not_called()

    def test_the_share_right_the_guard_asks_for_matches_the_framework(self):
        # `false_if_not_shared` reads a `read` share for email and print, the
        # column itself for the other four, and nothing for anything else.
        with patch(
            "suite.drive.framework.get_doctype_ptype_map", return_value={CONTENT_DOCTYPE: ["approve"]}
        ):
            for ptype, right in (
                (None, "read"),
                ("read", "read"),
                ("write", "write"),
                ("share", "share"),
                ("submit", "submit"),
                ("email", "read"),
                ("print", "read"),
                ("approve", "approve"),
                ("select", None),
                ("delete", None),
                ("create", None),
            ):
                with self.subTest(ptype=ptype):
                    self.assertEqual(framework._shared_right(CONTENT_DOCTYPE, ptype), right)

    def test_a_docshare_refuses_the_list_it_would_widen(self):
        # `get_permission_conditions` ORs the shared names around whatever the
        # predicate says, and drops the predicate altogether when the doctype
        # carries no role read. Neither is answerable from inside the hook.
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with (
            registered(declared),
            patch("suite.drive.framework.is_drive_admin", return_value=False),
            patch("frappe.share.get_shared", return_value=["deck-1"]) as shared,
        ):
            with self.assertRaises(DriveForbidden):
                framework.doc_query_conditions(user=OTHER, doctype=CONTENT_DOCTYPE)
            with self.assertRaises(DriveForbidden):
                framework.satellite_query_conditions(user=OTHER, doctype=SATELLITE_DOCTYPE)
        self.assertEqual(shared.call_args.args, (SATELLITE_DOCTYPE, OTHER))
        self.assertEqual(
            shared.call_args.kwargs,
            {"limit": 1},
            "the default right is `read`, which is what the list engine asks for",
        )

    def test_an_admin_lists_beside_a_share_instead_of_being_locked_out(self):
        # The predicate disappears for an admin, so the engine adds no
        # condition and has nothing to OR the share around.
        admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        with (
            registered(spec()),
            patch("suite.drive.framework.is_drive_admin", return_value=True),
            patch("suite.drive.framework.principals_for", return_value=admin),
            patch("frappe.share.get_shared", return_value=["deck-1"]) as shared,
        ):
            self.assertEqual(framework.doc_query_conditions(user=USER, doctype=CONTENT_DOCTYPE), "")
        shared.assert_not_called()

    def test_a_list_with_no_share_answers_with_the_predicate(self):
        person = Principals(USER, (USER,), ())
        with (
            registered(spec()),
            patch("suite.drive.framework.principals_for", return_value=person),
            patch("suite.drive.framework.is_drive_admin", return_value=False),
            patch("frappe.share.get_shared", return_value=[]),
        ):
            predicate = framework.doc_query_conditions(user=USER, doctype=CONTENT_DOCTYPE)
        self.assertIn(f"`tab{CONTENT_DOCTYPE}`.`node`", predicate)

    def test_an_everyone_share_is_one_the_guard_finds(self):
        # `get_shared` ORs `everyone = 1` in for every signed-in user
        # (`frappe/share.py:188-190`), so calling it is what makes an existing
        # everyone row refuse the list instead of opening it.
        seen = {}

        def get_all(doctype, **kwargs):
            seen.update(kwargs, doctype=doctype)
            return [frappe._dict(share_name="deck-1")]

        with (
            registered(spec()),
            patch("suite.drive.framework.is_drive_admin", return_value=False),
            patch("suite.drive.framework.frappe.get_all", side_effect=get_all),
            self.assertRaises(DriveForbidden),
        ):
            framework.doc_query_conditions(user=OTHER, doctype=CONTENT_DOCTYPE)
        self.assertEqual(seen["doctype"], "DocShare")
        self.assertIn(["everyone", "=", 1], seen["or_filters"])
        self.assertIn(["share_doctype", "=", CONTENT_DOCTYPE], seen["filters"])

    def test_a_share_of_a_governed_doctype_is_refused_and_one_elsewhere_is_not(self):
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with registered(declared):
            for doctype in (CONTENT_DOCTYPE, SATELLITE_DOCTYPE):
                with self.subTest(doctype=doctype), self.assertRaises(DriveForbidden):
                    framework.refuse_governed_share(frappe._dict(doctype="DocShare", share_doctype=doctype))
            framework.refuse_governed_share(frappe._dict(doctype="DocShare", share_doctype="ToDo"))
        with registered():
            # staged activation: nothing is governed yet, so nothing is refused
            framework.refuse_governed_share(frappe._dict(doctype="DocShare", share_doctype=CONTENT_DOCTYPE))

    def test_the_share_guard_is_wired_on_validate_alone(self):
        # Deleting a row runs `on_trash`, so the guard must not sit there:
        # a legacy share has to stay removable.
        self.assertEqual(
            doc_events["DocShare"], {"validate": ["suite.drive.framework.refuse_governed_share"]}
        )
        self.assertTrue(callable(frappe.get_attr(doc_events["DocShare"]["validate"][0])))

    def test_boot_validation_refuses_a_content_type_that_still_carries_shares(self):
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with registered(declared):
            self.assertEqual(content.governed_doctypes(), (CONTENT_DOCTYPE, SATELLITE_DOCTYPE))
        with (
            registered(declared),
            patch("suite.drive._core.content.validate_registry"),
            stub_db(MagicMock()) as db,
        ):
            db.exists.return_value = True
            with self.assertRaises(DriveConflict) as raised:
                framework.validate_content_registry()
            self.assertIn(CONTENT_DOCTYPE, str(raised.exception))
            db.exists.return_value = False
            framework.validate_content_registry()


class TestContentWorkflows(IntegrationTestCase):
    """The creation, linkage, copy, media, and sweep behaviour, on real rows."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        _create_fixture_doctypes()
        controllers = frappe.controllers.setdefault(frappe.local.site, {})
        controllers[CONTENT_DOCTYPE] = DriveTestContent
        # The titled fixture carries the mixin too, so `_validate_mixin` passes
        # and `_validate_forbidden_fields` is the check that refuses it.
        controllers[TITLED_DOCTYPE] = DriveTestContent
        # A run killed between `setUp` and the cleanup leaves the two fixture
        # roots behind, and `create_root` then refuses every later run.
        _purge_fixture_roots()
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        controllers = frappe.controllers.get(frappe.local.site, {})
        controllers.pop(CONTENT_DOCTYPE, None)
        controllers.pop(TITLED_DOCTYPE, None)
        _drop_fixture_doctypes()
        frappe.db.commit()
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        # Registered before the first row exists, so a `setUp` that dies half
        # way still hands its roots back. `tearDown` never runs in that case.
        self.addCleanup(self._remove_fixture_rows)
        self.root = create_root(kind="Personal", title="Content Root", user=USER)
        self.other_root = create_root(kind="Personal", title="Content Other", user=OTHER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.person = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))
        self.stranger = Principals(OTHER, (OTHER, "$GENERAL"), ("$PUBLIC",))
        frappe.cache().delete_value(content._sweep_cursor_key())

    def _remove_fixture_rows(self):
        """Hand back everything this test owns, whatever it managed to create."""
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.cache().delete_value(content._sweep_cursor_key())
        frappe.db.commit()

    # helpers

    def _document(self, title="Deck", parent=None, **kwargs) -> str:
        return create_document_node(
            self.admin,
            parent or self.root.name,
            title,
            content_doctype=CONTENT_DOCTYPE,
            **kwargs,
        )

    def _media(self, document: str, title: str, payload: bytes) -> str:
        blob = put_blob(io.BytesIO(payload), is_private=True, filename=title)
        with patch("suite.drive._core.previews.enqueue_render"):
            return create_file(
                self.admin,
                document,
                title,
                blob=blob.name,
                size=blob.file_size,
                mime=blob.mime_type,
            )

    def _name_media(self, document: str, nodes: list[str]) -> None:
        docname = frappe.db.get_value("Drive Node", document, "content_docname")
        frappe.db.set_value(CONTENT_DOCTYPE, docname, "body", json.dumps(nodes), update_modified=False)

    def _used_bytes(self) -> int:
        return frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

    # creation and linkage

    def test_the_node_and_the_document_are_created_and_linked_in_one_transaction(self):
        with registered(spec()):
            node = self._document("Deck")
        row = frappe.db.get_value(
            "Drive Node",
            node,
            ["kind", "mime", "title", "content_doctype", "content_docname", "content_modified"],
            as_dict=True,
        )
        self.assertEqual(row.kind, "document")
        self.assertEqual(row.mime, "frappe/test")
        self.assertEqual(row.content_doctype, CONTENT_DOCTYPE)
        self.assertIsNotNone(row.content_modified)
        self.assertEqual(frappe.db.get_value(CONTENT_DOCTYPE, row.content_docname, "node"), node)
        self.assertEqual(self._used_bytes(), 0, "a document body is free")
        activity = frappe.db.get_value(
            "Drive Activity", {"node": node, "action": "create"}, "detail", as_dict=False
        )
        self.assertIn(CONTENT_DOCTYPE, activity)

    def test_a_factory_failure_leaves_no_node_and_no_document(self):
        def explode(node):
            frappe.get_doc({"doctype": CONTENT_DOCTYPE, "node": node, "body": "[]"}).insert(
                ignore_permissions=True
            )
            raise ValueError("the app could not build a body")

        before = frappe.db.count("Drive Node", {"root": self.root.name})
        with registered(spec(create_empty=explode)), self.assertRaises(ValueError):
            self._document("Doomed")
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), before)
        self.assertFalse(frappe.db.exists("Drive Node", {"title": "Doomed"}))
        self.assertEqual(frappe.db.count(CONTENT_DOCTYPE), 0)

    def test_a_factory_that_returns_no_document_is_refused(self):
        with registered(spec(create_empty=lambda node: "")), self.assertRaises(DriveConflict):
            self._document("Empty")
        with registered(spec(create_empty=lambda node: "no-such-row")), self.assertRaises(DriveConflict):
            self._document("Missing")
        self.assertEqual(frappe.db.count("Drive Node", {"title": ["in", ("Empty", "Missing")]}), 0)

    def test_a_document_without_a_node_is_refused_by_the_mixin_guard(self):
        with registered(spec()), self.assertRaises(DriveConflict):
            frappe.get_doc({"doctype": CONTENT_DOCTYPE, "body": "[]"}).insert(ignore_permissions=True)

    def test_both_sides_of_the_link_are_set_once_and_never_change(self):
        with registered(spec()):
            node = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
            # `require_node` refuses a second row on the same node, so the
            # rival document the link has to reject needs a node of its own.
            other = frappe.db.get_value("Drive Node", self._document("Rival"), "content_docname")
            with self.assertRaises(DriveConflict):
                _link_document(node, spec_for(CONTENT_DOCTYPE), other)
        self.assertEqual(frappe.db.get_value("Drive Node", node, "content_docname"), docname)

        stored = frappe.get_doc("Drive Node", node)
        stored.content_docname = other
        with self.assertRaises(frappe.ValidationError):
            stored.save(ignore_permissions=True)

    def test_a_document_cannot_be_created_below_another_document(self):
        with registered(spec()):
            node = self._document("Deck")
            with self.assertRaises(DriveConflict):
                self._document("Nested", parent=node)

    def test_an_unregistered_content_type_cannot_create_a_document(self):
        with registered(), self.assertRaises(DriveConflict):
            self._document("Orphan")

    def test_new_from_template_copies_the_body_and_drops_the_template_flag(self):
        with registered(spec()):
            template = self._document("Template", is_template=True)
            self._name_media(template, ["kept"])
            copied = self._document("From template", from_node=template)
        self.assertEqual(frappe.db.get_value("Drive Node", template, "is_template"), 1)
        self.assertEqual(frappe.db.get_value("Drive Node", copied, "is_template"), 0)
        self.assertEqual(
            _body(frappe.db.get_value("Drive Node", copied, "content_docname")),
            ["kept"],
        )

    def test_a_template_of_another_content_type_is_refused(self):
        with registered(spec()):
            template = self._document("Template")
        with registered(spec(doctype="Drive Test Other")), self.assertRaises(DriveConflict):
            create_document_node(
                self.admin,
                self.root.name,
                "Wrong type",
                content_doctype="Drive Test Other",
                from_node=template,
            )

    # copy, media reuse, and reference rewriting

    def test_a_copy_remaps_references_and_keeps_one_media_node_per_blob(self):
        with registered(spec()):
            document = self._document("Deck")
            logo_a = self._media(document, "logo-a.png", b"logo-bytes")
            logo_b = self._media(document, "logo-b.png", b"logo-bytes")
            picture = self._media(document, "picture.png", b"picture-bytes")
            self._name_media(document, [logo_a, picture, logo_b])
            charged_before = self._used_bytes()
            folder = create_folder(self.admin, self.root.name, "Copies")
            copied = copy(self.admin, document, folder)

        media = frappe.get_all(
            "Drive Node",
            filters={"parent": copied, "state": "Active"},
            fields=["name", "blob", "size"],
        )
        self.assertEqual(len(media), 2, "one media node per blob inside one document")
        blobs = {row.blob for row in media}
        self.assertEqual(len(blobs), 2)

        body = _body(frappe.db.get_value("Drive Node", copied, "content_docname"))
        self.assertEqual(len(body), 3)
        self.assertEqual(set(body) & {logo_a, logo_b, picture}, set(), "no old node id survives")
        self.assertEqual(set(body), {row.name for row in media})
        self.assertEqual(body[0], body[2], "both references to one blob reuse one node")

        reused = sum(int(row.size or 0) for row in media)
        self.assertEqual(self._used_bytes(), charged_before + reused)
        self.assertNotEqual(
            frappe.db.get_value("Drive Node", copied, "content_docname"),
            frappe.db.get_value("Drive Node", document, "content_docname"),
        )

    def test_a_folder_copy_carries_the_documents_inside_it(self):
        with registered(spec()):
            folder = create_folder(self.admin, self.root.name, "Decks")
            document = self._document("Deck", parent=folder)
            self._media(document, "logo.png", b"logo-bytes")
            destination = create_folder(self.admin, self.root.name, "Archive")
            copied_folder = copy(self.admin, folder, destination)

        copied_document = frappe.get_all(
            "Drive Node",
            filters={"parent": copied_folder, "kind": "document"},
            fields=["name", "content_docname"],
        )
        self.assertEqual(len(copied_document), 1)
        self.assertTrue(copied_document[0].content_docname)
        self.assertEqual(
            frappe.db.get_value(CONTENT_DOCTYPE, copied_document[0].content_docname, "node"),
            copied_document[0].name,
        )
        self.assertEqual(
            frappe.db.count("Drive Node", {"parent": copied_document[0].name, "state": "Active"}),
            1,
        )

    def test_a_content_type_without_remap_media_copies_no_media(self):
        with registered(spec(remap_media=None)):
            document = self._document("Deck")
            self._media(document, "logo.png", b"logo-bytes")
            charged_before = self._used_bytes()
            folder = create_folder(self.admin, self.root.name, "Copies")
            copied = copy(self.admin, document, folder)
        self.assertEqual(frappe.db.count("Drive Node", {"parent": copied}), 0)
        self.assertEqual(self._used_bytes(), charged_before)

    def test_media_below_a_document_is_never_copied_or_moved_on_its_own(self):
        from suite.drive._core.nodes import update

        with registered(spec()):
            document = self._document("Deck")
            media = self._media(document, "logo.png", b"logo-bytes")
            folder = create_folder(self.admin, self.root.name, "Loose")
            with self.assertRaises(DriveConflict):
                copy(self.admin, media, folder)
            with self.assertRaises(DriveConflict):
                update(self.admin, media, parent=folder)

    def test_a_copy_is_refused_whole_when_the_app_factory_fails(self):
        def explode(source_docname, node):
            raise ValueError("the app could not duplicate")

        with registered(spec()):
            document = self._document("Deck")
            self._media(document, "logo.png", b"logo-bytes")
            folder = create_folder(self.admin, self.root.name, "Copies")
            charged_before = self._used_bytes()
            nodes_before = frappe.db.count("Drive Node", {"root": self.root.name})
        with registered(spec(duplicate=explode)), self.assertRaises(ValueError):
            copy(self.admin, document, folder)
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), nodes_before)
        self.assertEqual(self._used_bytes(), charged_before)
        self.assertEqual(frappe.db.count(CONTENT_DOCTYPE), 1)

    def test_a_copy_gives_the_creator_one_grant_and_not_one_per_picture(self):
        with registered(spec()):
            document = self._document("Deck")
            logo = self._media(document, "logo.png", b"logo-bytes")
            picture = self._media(document, "picture.png", b"picture-bytes")
            self._name_media(document, [logo, picture])
            folder = create_folder(self.admin, self.root.name, "Copies")
            grant(folder, USER, UPLOAD, self.admin)
            copied = copy(self.person, document, folder)

        media = frappe.get_all("Drive Node", filters={"parent": copied}, pluck="name")
        self.assertEqual(len(media), 2)
        self.assertEqual(frappe.db.count("Drive Grant", {"node": copied, "principal": USER}), 1)
        self.assertEqual(
            frappe.db.count("Drive Grant", {"node": ["in", media]}),
            0,
            "a copied picture inherits the document's creator grant instead of carrying its own",
        )

    def test_a_factory_that_commits_still_leaves_no_node_and_no_document(self):
        def commits_then_fails(node):
            create_empty(node)
            frappe.db.commit()
            raise ValueError("the app committed and then failed")

        with registered(spec()):
            nodes_before = frappe.db.count("Drive Node", {"root": self.root.name})
            documents_before = frappe.db.count(CONTENT_DOCTYPE)
        with registered(spec(create_empty=commits_then_fails)), self.assertRaises(ValueError):
            self._document("Deck")
        self.assertEqual(frappe.db.count("Drive Node", {"root": self.root.name}), nodes_before)
        self.assertEqual(frappe.db.count(CONTENT_DOCTYPE), documents_before)

    # purge and versions still reach the app through the one registry

    def test_purge_calls_the_registered_on_purge_and_removes_the_media(self):
        with registered(spec()):
            document = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", document, "content_docname")
            self._media(document, "logo.png", b"logo-bytes")
            purge(self.admin, document)
        self.assertFalse(frappe.db.exists(CONTENT_DOCTYPE, docname))
        self.assertEqual(frappe.db.count("Drive Node", {"parent": document}), 0)
        self.assertEqual(self._used_bytes(), 0)

    def test_versions_read_the_body_through_the_same_registry(self):
        with registered(spec()):
            document = self._document("Deck")
            self._name_media(document, ["one"])
            seq = take_version(self.admin, document, kind="milestone", label="One")
            self._name_media(document, ["two"])
            restore_version(self.admin, document, seq)
            docname = frappe.db.get_value("Drive Node", document, "content_docname")
            self.assertEqual(_body(docname), ["one"])
        with registered(spec(version_bytes=None)), self.assertRaises(DriveConflict):
            take_version(self.admin, document)

    # media URLs

    def test_media_urls_are_signed_for_fifteen_minutes_after_one_read_check(self):
        with registered(spec()):
            document = self._document("Deck")
            first = self._media(document, "a.png", b"a-bytes")
            second = self._media(document, "b.png", b"bb-bytes")
            with patch(
                "suite.drive._core.content.signed_url_for_blob", return_value="/f/blob/a.png?s=sig"
            ) as signed:
                media = list_media(self.admin, document)
        self.assertEqual([row["node"] for row in media], [first, second])
        self.assertEqual({row["url"] for row in media}, {"/f/blob/a.png?s=sig"})
        self.assertEqual({call.args[2] for call in signed.call_args_list}, {MEDIA_TTL_SECONDS})
        self.assertEqual(media[1]["size"], len(b"bb-bytes"))

    def test_media_is_refused_to_a_caller_who_cannot_read_the_document(self):
        with registered(spec()):
            document = self._document("Deck")
            self._media(document, "a.png", b"a-bytes")
            with self.assertRaises(DriveNotFound):
                list_media(self.stranger, document)
            with self.assertRaises(DriveConflict):
                list_media(self.admin, self.root.name)

    # the daily unused-media sweep

    def test_the_sweep_trashes_only_unnamed_media_older_than_seven_days(self):
        with registered(spec()):
            document = self._document("Deck")
            named = self._media(document, "named.png", b"named")
            stale = self._media(document, "stale.png", b"stale")
            fresh = self._media(document, "fresh.png", b"fresh")
            self._name_media(document, [named])
            old = now_datetime() - timedelta(days=UNUSED_MEDIA_GRACE_DAYS + 1)
            for node in (named, stale):
                frappe.db.set_value("Drive Node", node, "creation", old, update_modified=False)
            result = sweep_unused_media()

        self.assertEqual(result["documents"], 1)
        self.assertEqual(result["trashed"], 1)
        self.assertEqual(frappe.db.get_value("Drive Node", named, "state"), "Active")
        self.assertEqual(frappe.db.get_value("Drive Node", fresh, "state"), "Active")
        trashed = frappe.db.get_value(
            "Drive Node", stale, ["state", "trash_root", "trashed_at"], as_dict=True
        )
        self.assertEqual(trashed.state, "Trashed")
        self.assertEqual(trashed.trash_root, stale, "it lands in the bin on its own 30-day clock")
        self.assertIsNotNone(trashed.trashed_at)
        self.assertTrue(frappe.db.exists("Drive Node", stale), "trashed, never purged")

    def test_the_sweep_skips_a_content_type_that_declares_no_used_nodes(self):
        with registered(spec()):
            document = self._document("Deck")
            stale = self._media(document, "stale.png", b"stale")
            frappe.db.set_value(
                "Drive Node",
                stale,
                "creation",
                now_datetime() - timedelta(days=UNUSED_MEDIA_GRACE_DAYS + 1),
                update_modified=False,
            )
        with registered(spec(used_nodes=None)):
            self.assertEqual(sweep_unused_media()["documents"], 0)
        self.assertEqual(frappe.db.get_value("Drive Node", stale, "state"), "Active")

    def test_one_failing_document_does_not_stop_the_sweep(self):
        def explode(docname):
            raise ValueError("the app could not read its body")

        with registered(spec()):
            document = self._document("Deck")
            stale = self._media(document, "stale.png", b"stale")
            frappe.db.set_value(
                "Drive Node",
                stale,
                "creation",
                now_datetime() - timedelta(days=UNUSED_MEDIA_GRACE_DAYS + 1),
                update_modified=False,
            )
            frappe.db.commit()
        with registered(spec(used_nodes=explode)), patch("frappe.log_error"):
            result = sweep_unused_media()
        self.assertEqual((result["documents"], result["failed"]), (0, 1))
        self.assertEqual(frappe.db.get_value("Drive Node", stale, "state"), "Active")

    def test_media_the_sweep_trashed_can_be_restored_to_its_document(self):
        from suite.drive._core.nodes import update

        with registered(spec()):
            document = self._document("Deck")
            stale = self._media(document, "stale.png", b"stale")
            self._name_media(document, [])
            frappe.db.set_value(
                "Drive Node",
                stale,
                "creation",
                now_datetime() - timedelta(days=UNUSED_MEDIA_GRACE_DAYS + 1),
                update_modified=False,
            )
            self.assertEqual(sweep_unused_media()["trashed"], 1)
            self.assertEqual(frappe.db.get_value("Drive Node", stale, "state"), "Trashed")
            restored = update(self.admin, stale, state="Active")
        self.assertEqual(
            (restored.state, restored.parent),
            ("Active", document),
            "a bin the owner cannot restore from is not a bin",
        )

    def test_the_sweep_cursor_only_revisits_documents_that_changed(self):
        with registered(spec()):
            document = self._document("Deck")
            self._name_media(document, [])
            self.assertEqual(sweep_unused_media()["documents"], 1)
            self.assertEqual(sweep_unused_media()["documents"], 0)
            touch(self.admin, CONTENT_DOCTYPE, frappe.db.get_value("Drive Node", document, "content_docname"))
            self.assertEqual(sweep_unused_media()["documents"], 1)

    # touch

    def test_touch_stamps_content_time_under_an_edit_check(self):
        with registered(spec()):
            document = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", document, "content_docname")
            before = frappe.db.get_value("Drive Node", document, "content_modified")
            frappe.db.set_value(
                "Drive Node",
                document,
                "content_modified",
                now_datetime() - timedelta(hours=1),
                update_modified=False,
            )
            touch(self.admin, CONTENT_DOCTYPE, docname)
            after = frappe.db.get_value("Drive Node", document, "content_modified")
            self.assertGreaterEqual(after, before - timedelta(seconds=1))
            # Below Read the document is not there at all; Read alone still
            # cannot write, which is what makes this an edit check.
            with self.assertRaises(DriveNotFound):
                touch(self.stranger, CONTENT_DOCTYPE, docname)
            grant(document, OTHER, READ, self.admin)
            with self.assertRaises(DriveForbidden):
                touch(self.stranger, CONTENT_DOCTYPE, docname)

    # Frappe permission adapters

    def test_a_document_row_check_reads_an_inherited_folder_grant(self):
        with registered(spec()):
            folder = create_folder(self.admin, self.root.name, "Shared")
            node = self._document("Deck", parent=folder)
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
            doc = frappe.get_doc(CONTENT_DOCTYPE, docname)
            self.assertFalse(framework.doc_has_permission(doc=doc, ptype="read", user=OTHER))
            grant(folder, OTHER, READ, self.admin)
            self.assertTrue(framework.doc_has_permission(doc=doc, ptype="read", user=OTHER))
            self.assertFalse(framework.doc_has_permission(doc=doc, ptype="write", user=OTHER))
            grant(folder, OTHER, EDIT, self.admin)
            self.assertTrue(framework.doc_has_permission(doc=doc, ptype="write", user=OTHER))

    def test_a_document_with_no_node_is_an_error_not_a_fallback(self):
        with registered(spec()):
            doc = frappe._dict(doctype=CONTENT_DOCTYPE, name="loose", node=None)
            with self.assertRaises(DriveConflict):
                framework.doc_has_permission(doc=doc, ptype="read", user=OTHER)

    def test_a_satellite_takes_read_and_edit_from_the_document_node(self):
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with registered(declared):
            folder = create_folder(self.admin, self.root.name, "Shared")
            node = self._document("Deck", parent=folder)
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
            satellite = frappe.get_doc(
                {"doctype": SATELLITE_DOCTYPE, "content": docname, "payload": "op"}
            ).insert(ignore_permissions=True)

            self.assertFalse(framework.satellite_has_permission(doc=satellite, ptype="read", user=OTHER))
            grant(folder, OTHER, READ, self.admin)
            self.assertTrue(framework.satellite_has_permission(doc=satellite, ptype="read", user=OTHER))
            self.assertFalse(framework.satellite_has_permission(doc=satellite, ptype="write", user=OTHER))
            grant(folder, OTHER, COMMENT, self.admin)
            self.assertFalse(
                framework.satellite_has_permission(doc=satellite, ptype="write", user=OTHER),
                "Comment is not Edit",
            )
            grant(folder, OTHER, EDIT, self.admin)
            self.assertTrue(framework.satellite_has_permission(doc=satellite, ptype="write", user=OTHER))

    def test_the_list_predicate_matches_the_engine_on_real_rows(self):
        with registered(spec()):
            folder = create_folder(self.admin, self.root.name, "Shared")
            inherited = self._document("Inherited", parent=folder)
            hidden = self._document("Hidden")
            denied = self._document("Denied", parent=folder)
            grant(folder, OTHER, READ, self.admin)
            grant(denied, OTHER, 0, self.admin)
            frappe.db.commit()

            frappe.set_user(OTHER)
            try:
                # `get_list`, never `get_all`: `get_all` sets
                # `ignore_permissions=True` and skips the predicate entirely.
                visible = frappe.get_list(CONTENT_DOCTYPE, pluck="node")
            finally:
                frappe.set_user("Administrator")

        self.assertIn(inherited, visible)
        self.assertNotIn(hidden, visible, "no grant anywhere on its chain")
        self.assertNotIn(denied, visible, "the nearer deny wins")

    def test_a_trashed_document_leaves_the_list_but_stays_readable(self):
        from suite.drive._core.nodes import update

        with registered(spec()):
            node = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
            grant(node, OTHER, READ, self.admin)
            update(self.admin, node, state="Trashed")
            frappe.db.commit()

            frappe.set_user(OTHER)
            try:
                self.assertEqual(frappe.get_list(CONTENT_DOCTYPE, pluck="name"), [])
            finally:
                frappe.set_user("Administrator")
            doc = frappe.get_doc(CONTENT_DOCTYPE, docname)
            self.assertTrue(framework.doc_has_permission(doc=doc, ptype="read", user=OTHER))

    # a DocShare must not widen what the four adapters answered

    def _legacy_share(self, docname: str, **rights) -> str:
        """Write one DocShare the way a site did before Drive governed it.

        Written outside `registered`, so the guard on `DocShare.validate` is
        a no-op, which is exactly the row an adoption ticket inherits.
        """
        share = frappe.get_doc(
            {
                "doctype": "DocShare",
                "share_doctype": CONTENT_DOCTYPE,
                "share_name": docname,
                "read": 1,
                **rights,
            }
        ).insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()
        return share.name

    def test_an_everyone_share_that_predates_adoption_opens_no_document(self):
        with registered(spec()):
            node = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
        self._legacy_share(docname, everyone=1)

        with registered(spec()):
            doc = frappe.get_doc(CONTENT_DOCTYPE, docname)
            # the adapter alone
            with self.assertRaises(DriveForbidden):
                framework.doc_has_permission(doc=doc, ptype="read", user=OTHER)
            # and the whole framework composition around it, which is what
            # would otherwise OR the share back in
            with self.assertRaises(DriveForbidden):
                frappe.has_permission(CONTENT_DOCTYPE, "read", doc=doc, user=OTHER)
            frappe.set_user(OTHER)
            try:
                with self.assertRaises(DriveForbidden):
                    frappe.get_list(CONTENT_DOCTYPE, pluck="name")
            finally:
                frappe.set_user("Administrator")

    def test_a_grant_still_answers_beside_a_share_of_another_document(self):
        # The guard is per document on the row path, so an unrelated share
        # must not disturb a document Drive does allow.
        with registered(spec()):
            readable = self._document("Readable")
            other = self._document("Other")
            grant(readable, OTHER, READ, self.admin)
            names = [frappe.db.get_value("Drive Node", node, "content_docname") for node in (readable, other)]
        self._legacy_share(names[1], user=OTHER)

        with registered(spec()):
            doc = frappe.get_doc(CONTENT_DOCTYPE, names[0])
            self.assertTrue(framework.doc_has_permission(doc=doc, ptype="read", user=OTHER))
            self.assertTrue(frappe.has_permission(CONTENT_DOCTYPE, "read", doc=doc, user=OTHER))

    def test_a_share_of_a_registered_content_doctype_is_refused_but_stays_removable(self):
        with registered(spec()):
            node = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
        name = self._legacy_share(docname, user=OTHER)

        with registered(spec()):
            with self.assertRaises(DriveForbidden):
                frappe.share.add(CONTENT_DOCTYPE, docname, USER, flags={"ignore_share_permission": True})
            # the guard sits on validate alone, so the legacy row can go
            frappe.delete_doc("DocShare", name, force=1, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("DocShare", name))

    def test_boot_validation_refuses_a_type_that_still_carries_a_share(self):
        with registered(spec()):
            node = self._document("Deck")
            docname = frappe.db.get_value("Drive Node", node, "content_docname")
        self._legacy_share(docname, everyone=1)

        with registered(spec()), self.assertRaises(DriveConflict) as raised:
            framework.validate_content_registry()
        self.assertIn(CONTENT_DOCTYPE, str(raised.exception))

    # boot validation against the real doctypes

    def test_boot_validation_accepts_a_complete_declaration(self):
        declared = spec(satellites=(Satellite(doctype=SATELLITE_DOCTYPE, link_field="content"),))
        with registered(declared):
            validate_registry()

    def test_boot_validation_refuses_a_missing_or_wrong_node_field(self):
        for node_field in ("body", "missing"):
            with (
                self.subTest(node_field=node_field),
                registered(spec(node_field=node_field)),
                self.assertRaises(DriveConflict),
            ):
                validate_registry()

    def test_boot_validation_refuses_a_doctype_that_owns_a_title_or_trash_field(self):
        with registered(spec(doctype=TITLED_DOCTYPE)), self.assertRaises(DriveConflict) as raised:
            validate_registry()
        self.assertIn("must not", str(raised.exception))

    def test_boot_validation_refuses_a_doctype_without_the_mixin(self):
        controllers = frappe.controllers.get(frappe.local.site, {})
        with registered(spec(doctype=TITLED_DOCTYPE, node_field="node")):
            controllers.pop(TITLED_DOCTYPE, None)
            try:
                with self.assertRaises(DriveConflict) as raised:
                    validate_registry()
            finally:
                controllers[TITLED_DOCTYPE] = DriveTestContent
        self.assertIn("mixin", str(raised.exception))

    def test_boot_validation_refuses_a_satellite_that_links_elsewhere(self):
        wrong = Satellite(doctype=SATELLITE_DOCTYPE, link_field="payload")
        with registered(spec(satellites=(wrong,))), self.assertRaises(DriveConflict):
            validate_registry()

    def test_only_an_adopted_app_is_registered_and_every_declaration_is_valid(self):
        """Staged activation: an app appears here in its own adoption ticket.

        Writer is registered by ticket 17. Slides and Sheets join at tickets 18
        and 19, so the set is exact rather than a lower bound: a doctype that
        arrives without its adoption ticket fails here.
        """
        content.clear_registry_cache()
        self.assertEqual(sorted(registry()), ["Writer Document"])
        validate_registry()


def _purge_fixture_roots() -> None:
    """Remove every Drive root the two fixture users own, through Drive's own purge.

    `USER` and `OTHER` belong to this module alone, so the filter can never
    reach a live account or another test. `purge_root` is the one path that
    clears every reference table and calls `on_purge` for the app rows behind
    a document, so the fixture registry has to be live while it runs.
    """
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    roots = frappe.get_all("Drive Root", filters={"user": ["in", (USER, OTHER)]}, pluck="name")
    if not roots:
        return
    with registered(spec()):
        for root in roots:
            if frappe.db.get_value("Drive Root", root, "state") == "Active":
                update_root(root, admin, state="Archived")
            purge_root(root, admin)


def _create_fixture_doctypes() -> None:
    _create_doctype(
        CONTENT_DOCTYPE,
        [
            {"fieldname": "node", "fieldtype": "Link", "options": "Drive Node", "label": "Node"},
            {"fieldname": "body", "fieldtype": "Long Text", "label": "Body"},
        ],
    )
    _create_doctype(
        SATELLITE_DOCTYPE,
        [
            {
                "fieldname": "content",
                "fieldtype": "Link",
                "options": CONTENT_DOCTYPE,
                "label": "Content",
            },
            {"fieldname": "payload", "fieldtype": "Data", "label": "Payload"},
        ],
    )
    _create_doctype(
        TITLED_DOCTYPE,
        [
            {"fieldname": "node", "fieldtype": "Link", "options": "Drive Node", "label": "Node"},
            {"fieldname": "title", "fieldtype": "Data", "label": "Title"},
        ],
    )


def _create_doctype(name: str, fields: list[dict]) -> None:
    if frappe.db.exists("DocType", name):
        return
    frappe.get_doc(
        {
            "doctype": "DocType",
            "name": name,
            "module": "Drive",
            "custom": 1,
            "naming_rule": "Random",
            "fields": fields,
            "permissions": [{"role": "All", "read": 1, "write": 1, "create": 1, "delete": 1, "share": 1}],
        }
    ).insert(ignore_permissions=True)


def _drop_fixture_doctypes() -> None:
    for name in (SATELLITE_DOCTYPE, CONTENT_DOCTYPE, TITLED_DOCTYPE):
        if frappe.db.exists("DocType", name):
            frappe.delete_doc("DocType", name, force=1, ignore_permissions=True, ignore_missing=True)
