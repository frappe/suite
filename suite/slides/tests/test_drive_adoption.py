"""Slides' adoption of the Drive content contract (ticket 18, §6.6, §10.7, §14.7).

Adoption is an expand phase, not a switch. Slides declares its `ContentTypeSpec`
and `Presentation` gains the `node` Link, but `suite/hooks.py` leaves
`drive_content_types` empty and keeps both `Presentation` permission entries on
`suite.slides.doctype.presentation.presentation`. Ticket 28 links every row and
ticket 29 makes the registry and the four hook changes together.

So the three classes here split along that seam:

`TestSlidesDeclaration`   the declaration, the version envelope, and the body
                          readers, on no rows. It also proves the hooks are
                          dormant and that activation registers exactly what
                          ticket 29 will install.
`TestSlidesBeforeActivation`
                          what a site running this commit does: legacy decks,
                          the legacy create path, a `DocShare` that must not
                          fail `migrate`, and the one check that still refuses
                          activation.
`TestSlidesInDrive`       the Drive-native lifecycle, history, media, previews,
                          composites, satellites, and failure rollback, under
                          `activated()`.

`activated()` injects the registry and the four hook targets rather than
shipping them, so nothing here depends on the site being activated and nothing
here activates it.

The integration classes reach `suite.drive._core` for the workflows the package
root does not expose yet: roots, trash, media upload, and version restore. Those
imports are recorded as owned debt in `suite/tests/test_architecture.py` and go
when tickets 21 and 22 put those workflows behind HTTP.
"""

import base64
import dataclasses
import io
import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import frappe
import frappe.share
from frappe.storage.blob import put_blob
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.utils import get_datetime
from PIL import Image

from suite import drive
from suite.drive._core.access import grant
from suite.drive._core.content import (
    _validate_forbidden_fields,
    clear_registry_cache,
    governs,
    spec_for,
)
from suite.drive._core.errors import DriveConflict, DriveForbidden, DriveNotFound
from suite.drive._core.nodes import create_file, create_folder, purge, update
from suite.drive._core.principals import Principals
from suite.drive._core.roots import create_root, purge_root, update_root
from suite.drive._core.versions import restore_version
from suite.drive.framework import (
    refuse_governed_share,
    satellite_has_permission,
    satellite_query_conditions,
    validate_content_registry,
)
from suite.slides import drive as slides
from suite.slides.doctype.presentation import presentation as api
from suite.slides.doctype.presentation.presentation import Presentation
from suite.slides.tests.utils import make_presentation
from suite.tests.utils import ensure_user

USER = "slides-adoption-user@example.com"
OTHER = "slides-adoption-other@example.com"

DOCTYPE = "Presentation"
SATELLITE = "Slide"

# The five entries ticket 29 installs together, once Build has linked every
# `Presentation` row. `suite/hooks.py` carries none of them yet.
ACTIVATION = {
    "drive_content_types": ["suite.slides.drive.SPEC"],
    "has_permission": {
        DOCTYPE: ["suite.drive.framework.doc_has_permission"],
        SATELLITE: ["suite.drive.framework.satellite_has_permission"],
    },
    "permission_query_conditions": {
        DOCTYPE: ["suite.drive.framework.doc_query_conditions"],
        SATELLITE: ["suite.drive.framework.satellite_query_conditions"],
    },
}


@contextmanager
def activated():
    """Register Slides for the block, exactly the way ticket 29 will register it.

    The registry is built from `drive_content_types` and the framework reads
    both permission hooks from the same hook map, so injecting the map is the
    whole activation. Nothing is written and nothing survives the block: the
    per-request registry cache is dropped on the way in and on the way out.
    """
    real_get_hooks = frappe.get_hooks

    # `hook`, not `key`: frappe's own signature is `get_hooks(hook=None, ...)`
    # and three framework call sites pass it by keyword. A different parameter
    # name here makes those raise `TypeError` inside the block.
    def hooks(hook=None, *args, **kwargs):
        if hook == "drive_content_types":
            return list(ACTIVATION[hook])
        if hook in ("has_permission", "permission_query_conditions"):
            wired = dict(real_get_hooks(hook, *args, **kwargs) or {})
            wired.update({name: list(paths) for name, paths in ACTIVATION[hook].items()})
            return wired
        return real_get_hooks(hook, *args, **kwargs)

    clear_registry_cache()
    try:
        with patch("frappe.get_hooks", hooks):
            yield
    finally:
        clear_registry_cache()


def png(color: str = "red") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


def webp_capture(color: str = "blue") -> str:
    """One browser capture, in the only shape `save_presentation_thumbnail` takes."""
    output = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="WEBP")
    return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def elements_naming(*ids: str) -> str:
    """One `elements` column naming `ids`, one picture each."""
    return json.dumps([{"id": f"e{index}", "type": "image", "src": found} for index, found in enumerate(ids)])


def video_with(src: str, poster) -> str:
    """One `elements` column whose single video names a src and a poster.

    `poster` may be a string or the dict shape §14.7 says a legacy row carries.
    """
    return json.dumps([{"id": "e0", "type": "video", "src": src, "poster": poster}])


class TestSlidesDeclaration(UnitTestCase):
    """The declaration, the version envelope, and the body readers."""

    # the declaration

    def test_slides_declares_the_identity_section_ten_seven_fixes(self):
        self.assertEqual(slides.SPEC.doctype, DOCTYPE)
        self.assertEqual(slides.SPEC.mime, "frappe/slides")
        self.assertEqual(slides.SPEC.node_field, "node")
        self.assertTrue(slides.SPEC.pushes_preview, "the browser captures the deck, Drive never renders it")

    def test_the_slide_child_table_is_declared_as_the_satellite(self):
        self.assertEqual(len(slides.SPEC.satellites), 1)
        satellite = slides.SPEC.satellites[0]
        self.assertEqual((satellite.doctype, satellite.link_field), (SATELLITE, "parent"))

    def test_slides_stays_hidden_over_dav_and_offers_no_export(self):
        self.assertIsNone(slides.SPEC.default_export, "no default export means invisible over DAV")
        self.assertEqual(slides.SPEC.export_formats, ())
        self.assertIsNone(slides.SPEC.export)

    def test_every_callback_the_ticket_names_is_declared(self):
        for name in (
            "create_empty",
            "duplicate",
            "version_bytes",
            "restore_version",
            "on_purge",
            "used_nodes",
            "remap_media",
        ):
            with self.subTest(callback=name):
                self.assertTrue(callable(getattr(slides.SPEC, name)), name)

    def test_the_controller_carries_the_drive_mixin(self):
        self.assertTrue(issubclass(Presentation, drive.DriveContent))

    def test_slides_declares_the_one_legacy_column_it_keeps_past_activation(self):
        """`title` only. §10.2 forbids neither `is_template` nor `thumbnail`,
        so neither needs the exemption and neither gets it."""
        self.assertEqual(slides.SPEC.legacy_fields, ("title",))

    def test_a_legacy_declaration_only_covers_a_field_drive_owns(self):
        """The hatch is not a way to keep any column out of any later check.
        A name §10.2 does not forbid is refused by the shape check itself, with
        no database and no registry."""
        from suite.drive._core.content import _validate_shape

        with self.assertRaises(DriveConflict):
            _validate_shape(dataclasses.replace(slides.SPEC, legacy_fields=("slug",)))
        _validate_shape(dataclasses.replace(slides.SPEC, legacy_fields=("title", "trashed_on")))

    # staged activation

    def test_the_declaration_ships_dormant_and_the_hooks_stay_where_they_were(self):
        """README execution rules: stage the registry and the permission hooks
        after the required node links exist. Build writes them at ticket 28 and
        ticket 29 activates. Registering now would refuse every legacy deck on
        its next permission check."""
        from suite import hooks

        self.assertEqual(hooks.drive_content_types, [], "activation waits for ticket 29")
        self.assertEqual(
            hooks.has_permission[DOCTYPE],
            "suite.slides.doctype.presentation.presentation.has_permission",
        )
        self.assertEqual(
            hooks.permission_query_conditions[DOCTYPE],
            "suite.slides.doctype.presentation.presentation.get_permission_query_conditions",
        )
        self.assertNotIn(SATELLITE, hooks.has_permission)
        self.assertNotIn(SATELLITE, hooks.permission_query_conditions)
        clear_registry_cache()
        self.assertFalse(governs(DOCTYPE), "Drive governs nothing while the registry is empty")
        self.assertFalse(governs(SATELLITE))

    def test_a_dormant_registry_leaves_a_docshare_alone(self):
        """The one thing that would fail `migrate` on a site with real decks.
        Desk assignment writes a `DocShare` (`frappe.share.add`), and no tool
        rewrites those rows as grants before Build."""
        share = frappe._dict(share_doctype=DOCTYPE, share_name="anything")
        refuse_governed_share(share)

        with activated(), self.assertRaises(DriveForbidden):
            refuse_governed_share(share)

    def test_activation_registers_the_declaration_and_moves_all_four_hooks(self):
        with activated():
            self.assertTrue(governs(DOCTYPE))
            self.assertTrue(governs(SATELLITE), "a satellite is governed too")
            self.assertIs(spec_for(DOCTYPE), slides.SPEC)
            for key in ("has_permission", "permission_query_conditions"):
                wired = frappe.get_hooks(key)
                for doctype, paths in ACTIVATION[key].items():
                    with self.subTest(hook=key, doctype=doctype):
                        self.assertEqual(wired[doctype], paths)
        self.assertFalse(governs(DOCTYPE), "the injection leaves nothing behind")

    # the version envelope

    def test_a_version_envelope_round_trips_the_deck(self):
        payload = {
            "schema": slides.VERSION_SCHEMA,
            "theme": "dark",
            "is_composite": 1,
            "slides": [{"elements": "[]", "background": "n1"}],
            "references": ["a", "b"],
        }
        read = slides._version_payload(json.dumps(payload).encode("utf-8"))
        self.assertEqual(read["theme"], "dark")
        self.assertEqual(read["is_composite"], 1)
        self.assertEqual(read["slides"], payload["slides"])
        self.assertEqual(read["references"], ["a", "b"])

    def test_an_envelope_of_another_schema_or_shape_is_refused(self):
        # §14.7 migrates no deck history, so nothing written before Drive can
        # half-restore a deck.
        for raw in (
            b"<not json at all>",
            b"{}",
            json.dumps({"schema": "presentation/2", "slides": [], "references": []}).encode(),
            json.dumps({"schema": slides.VERSION_SCHEMA, "slides": {}, "references": []}).encode(),
            json.dumps({"schema": slides.VERSION_SCHEMA, "slides": ["x"], "references": []}).encode(),
            json.dumps({"schema": slides.VERSION_SCHEMA, "slides": [], "references": [1]}).encode(),
        ):
            with self.subTest(raw=raw), self.assertRaises(frappe.ValidationError):
                slides._version_payload(raw)

    # reading a media id out of a body

    def test_a_media_id_is_read_from_a_src_a_poster_and_a_background(self):
        row = {"background": "bg-node", "elements": video_with("src-node", "poster-node")}
        found = slides._value_ids(row["background"]) | slides._slide_element_ids(row)
        self.assertTrue({"bg-node", "src-node", "poster-node"} <= found)

    def test_a_dictionary_poster_is_walked_rather_than_skipped(self):
        # §14.7: a legacy poster may be a dict. Losing it would let the daily
        # sweep trash a picture the deck still shows.
        row = {"elements": video_with("src-node", {"url": "poster-node", "width": 640})}
        self.assertTrue({"src-node", "poster-node"} <= slides._slide_element_ids(row))

    def test_a_poster_is_walked_to_the_bottom_however_deep_it_nests(self):
        """§14.7 fixes no depth for a legacy dict poster, and a list is the
        other shape a body carries. A walk that stops one level down reports
        "this slide names nothing" and the §10.6 sweep trashes the picture."""
        for poster, expected in (
            ({"image": {"url": "deep-node"}}, "deep-node"),
            ({"sources": [{"url": "listed-node"}]}, "listed-node"),
            (["bare-node"], "bare-node"),
        ):
            with self.subTest(poster=poster):
                row = {"elements": video_with("src-node", poster)}
                self.assertTrue({"src-node", expected} <= slides._slide_element_ids(row))

    def test_the_sweep_answer_over_reports_and_the_adoption_answer_does_not(self):
        """The two readers are deliberately different. The sweep decides what to
        trash, so it reads the whole body and may name a word that is not a
        node. The adoption reader decides what to copy and rewrite, so it reads
        only `src` and `poster`."""
        raw = video_with("src-node", "poster-node")
        element = json.loads(raw)[0]

        self.assertEqual(slides._element_ids(element), {"src-node", "poster-node"})
        self.assertIn("video", slides._slide_element_ids({"elements": raw}), "over-reports by design")

    def test_a_deep_poster_is_rewritten_at_the_same_depth_it_is_read(self):
        element = {"type": "video", "src": "one", "poster": {"image": {"url": "two"}}}
        self.assertTrue(slides._remap_element(element, {"one": "ONE", "two": "TWO"}))
        self.assertEqual(element["src"], "ONE")
        self.assertEqual(element["poster"], {"image": {"url": "TWO"}})

    def test_a_hex_or_functional_colour_and_a_legacy_url_are_never_read_as_a_node(self):
        """A value carrying a character an id cannot hold is never an id. A
        bare id-shaped word still is: `red` is reported as used, which only
        keeps media alive and rewrites nothing (`used_nodes` over-reports by
        design). This pins which half is a guarantee."""
        for value in ("#00ff00ff", "/private/files/logo.png", "rgba(0, 0, 0, 0.5)", "", None, 7):
            with self.subTest(value=value):
                self.assertEqual(slides._value_ids(value), set())
        for value in ("red", "transparent", "currentColor", "auto"):
            with self.subTest(value=value):
                self.assertEqual(slides._value_ids(value), {value}, "over-reported, never lost")

    def test_the_sweep_reads_a_body_shape_slides_never_wrote(self):
        """Under-reporting is what trashes a live picture (§10.6), so the sweep
        walks the whole parsed body rather than only `src` and `poster`. A key
        Slides does not know, or a list of elements inside a list, must still
        keep its picture alive."""
        for raw in (
            json.dumps([{"type": "image", "backgroundImage": "surprise-node"}]),
            json.dumps([[{"type": "image", "src": "surprise-node"}]]),
            json.dumps([{"type": "group", "children": [{"src": "surprise-node"}]}]),
        ):
            with self.subTest(raw=raw):
                self.assertIn("surprise-node", slides._slide_element_ids({"elements": raw}))

    def test_a_rewrite_stays_narrow_where_the_sweep_is_wide(self):
        """The asymmetry is deliberate: over-reporting only keeps media alive,
        while rewriting a value that is not a reference corrupts a body."""
        element = {"type": "image", "backgroundImage": "one"}
        self.assertFalse(slides._remap_element(element, {"one": "ONE"}))
        self.assertEqual(element["backgroundImage"], "one")

    def test_a_rewrite_never_grows_a_media_key_the_element_did_not_have(self):
        element = {"type": "image", "src": "one"}
        slides._remap_element(element, {"one": "ONE"})
        self.assertNotIn("poster", element)

    def test_an_unreadable_elements_column_over_reports_instead_of_losing_a_picture(self):
        row = {"elements": "{not json survivor-node"}
        with patch("frappe.log_error"):
            found = slides._slide_element_ids(row)
        self.assertIn("survivor-node", found)

    def test_an_unreadable_elements_column_refuses_a_rewrite(self):
        # A copy whose pictures still point at the source's nodes is worse than
        # a refused copy.
        with self.assertRaises(slides.UnreadableBody):
            slides._elements_or_refuse({"elements": "{not json"})

    def test_an_empty_column_names_nothing(self):
        for raw in (None, "", "[]"):
            with self.subTest(raw=raw):
                self.assertEqual(slides._slide_element_ids({"elements": raw}), set())

    def test_a_rewrite_touches_only_the_ids_it_was_given(self):
        element = {"src": "one", "poster": {"url": "two"}, "type": "video"}
        changed = slides._remap_element(element, {"one": "ONE"})
        self.assertTrue(changed)
        self.assertEqual(element["src"], "ONE")
        self.assertEqual(element["poster"], {"url": "two"}, "an unmapped id is left alone")

    def test_a_rewrite_reports_no_change_when_it_maps_nothing(self):
        element = {"src": "one"}
        self.assertFalse(slides._remap_element(element, {"other": "x"}))

    # the refusal contract the staged guards depend on

    def test_the_drive_refusal_is_not_a_frappe_permission_error(self):
        """Both staged guards refuse through `DriveForbidden`, and a caller
        that expects `frappe.PermissionError` never sees it.

        `frappe.ValidationError` and `frappe.PermissionError` are unrelated
        classes (`frappe/exceptions.py:23,40`). This is pinned because a test
        written against the wrong one passes silently only while the guard is
        broken: it fails the moment the guard starts refusing.
        """
        self.assertTrue(issubclass(DriveForbidden, frappe.ValidationError))
        self.assertFalse(issubclass(DriveForbidden, frappe.PermissionError))
        self.assertEqual(DriveForbidden.http_status_code, 403)

    def test_both_staged_guards_refuse_a_share_with_the_same_error(self):
        """The row guard and the list guard have to agree. Frappe reads a
        `False` row answer as "no role permission" and then asks
        `false_if_not_shared` (`frappe/permissions.py:214-216`), and
        `frappe.db.query` ORs the shared names around the list predicate
        (`frappe/database/query.py:1739-1742`). Only a raise closes either.
        """
        from suite.drive import framework

        with self._fake_db(get_value="deck-1"), patch("frappe.share.get_shared", return_value=["deck-1"]):
            with self.assertRaises(DriveForbidden):
                framework.refuse_shared_row(DOCTYPE, "deck-1", "read", OTHER)
            with self.assertRaises(DriveForbidden):
                framework.refuse_shared_linked_rows(DOCTYPE, "node", OTHER)

    def test_the_staged_list_guard_refuses_only_a_row_that_carries_a_node(self):
        """A legacy row is still the app's to share. Before Build no row carries
        a node, so a site with Desk assignments lists what it always listed."""
        from suite.drive import framework

        with self._fake_db(get_value=None) as db, patch("frappe.share.get_shared", return_value=["deck-1"]):
            framework.refuse_shared_linked_rows(DOCTYPE, "node", OTHER)
            self.assertEqual(
                db.get_value.call_args.args[1], {"name": ("in", ["deck-1"]), "node": ("is", "set")}
            )

    def test_the_staged_list_guard_never_refuses_an_administrator(self):
        """The predicate disappears for an admin, so there is nothing for the
        engine to OR a share around. Refusing would lock out the only person
        who can remove the row."""
        from suite.drive import framework

        with self._fake_db(get_value="deck-1"), patch("frappe.share.get_shared", return_value=["deck-1"]):
            framework.refuse_shared_linked_rows(DOCTYPE, "node", "Administrator")

    @contextmanager
    def _fake_db(self, *, get_value):
        """Answer `frappe.db` without a connection, so a guard runs for real."""
        db = MagicMock()
        db.get_value.return_value = get_value
        previous = getattr(frappe.local, "db", None)
        frappe.local.db = db
        try:
            yield db
        finally:
            frappe.local.db = previous


class TestSlidesBeforeActivation(IntegrationTestCase):
    """What a site running this commit actually does: nothing Drive-native.

    `drive_content_types` is empty here, as it is on a site. These are the
    outcomes the staged activation buys: a legacy deck stays reachable and
    editable, and a `DocShare` no longer fails `migrate`.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        clear_registry_cache()
        self.addCleanup(clear_registry_cache)

    def _legacy_deck(self, title="Legacy deck") -> str:
        deck = make_presentation(f"{title} {frappe.generate_hash(6)}")
        self.addCleanup(
            frappe.delete_doc, DOCTYPE, deck.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        return deck.name

    def test_a_legacy_deck_keeps_its_title_its_slug_and_its_backing_file(self):
        """The whole point of not activating. A node-less deck is untouched:
        the mirrored title, the slug, and the `File` every legacy read path
        still asks about."""
        from suite.drive.overrides.file import File as DriveFile

        name = self._legacy_deck("Untouched")
        deck = frappe.get_doc(DOCTYPE, name)

        self.assertIsNone(deck.get("node"), "no node before Build")
        self.assertTrue(deck.title)
        self.assertEqual(deck.slug, api.slug(deck.title))
        self.assertTrue(DriveFile.get_for_doc(DOCTYPE, name), "the legacy identity is still the File")
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", name))
        self.assertIn(name, frappe.get_list(DOCTYPE, pluck="name"))

    def test_a_legacy_deck_still_renames_and_still_takes_a_thumbnail_file(self):
        name = self._legacy_deck("Renamed")

        api.update_title(name, "A new title")
        url = api.save_presentation_thumbnail(name, webp_capture())

        self.assertEqual(frappe.db.get_value(DOCTYPE, name, "slug"), "a-new-title")
        self.assertTrue(url.startswith("/"), url)
        self.assertEqual(frappe.db.get_value(DOCTYPE, name, "thumbnail"), url)

    def test_a_docshare_on_a_presentation_does_not_fail_a_migration(self):
        """`after_migrate` runs `validate_content_registry`. Desk assignment
        writes a `DocShare` (`frappe/desk/form/assign_to.py` calls
        `frappe.share.add`) and no tool rewrites those rows as grants before
        Build, so activating now would refuse the site."""
        name = self._legacy_deck("Shared")
        share = frappe.share.add(DOCTYPE, name, OTHER, read=1)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )

        validate_content_registry()

    def test_activation_accepts_the_frozen_legacy_title_column(self):
        """Ticket 29 has no impossible choice left.

        §14.7 reads `Presentation.title` at Build and §14.10 drops it at
        Cleanup, one release after activation, so the column has to outlive
        activation. §10.2 forbids it because a title field is a mirror. The
        declaration names it in `legacy_fields`, which exempts it from the
        forbidden-field check and freezes it instead, so no mirror exists in
        either direction and the Build value stays for the §14.11 rollback.
        """
        meta = frappe.get_meta(DOCTYPE)
        self.assertIsNotNone(meta.get_field("title"), "Build still reads it (§14.7)")

        with activated():
            validate_content_registry()

    def test_the_display_title_still_resolves_to_the_frozen_legacy_column(self):
        """Dropping `"title_field": "title"` from the JSON changed nothing.

        Frappe resolves an absent `title_field` to a field literally called
        `title` before it falls back to `name`
        (`frappe/model/meta.py:373-384`), so the doctype still displays the
        legacy column. What holds §10.2's "no mirror in either direction" is
        the freeze, not the missing attribute: `refuse_legacy_field_write`
        refuses every write, so the value cannot diverge from what Build left.
        Setting `title_field` to `name` instead is not open either — it would
        rename every legacy deck's backing `File` to its docname on the next
        save (`suite/drive/overrides/file.py:607-613`).
        """
        meta = frappe.get_meta(DOCTYPE)
        self.assertIsNone(meta.get("title_field"), "the JSON names none")
        self.assertEqual(meta.get_title_field(), "title", "frappe supplies one anyway")
        self.assertIn("title", slides.SPEC.legacy_fields, "so it has to be a declared exemption")

    def test_activation_refuses_a_display_title_frappe_supplied_and_nobody_declared(self):
        """The guard reads the resolved display title, not the raw attribute.

        A doctype that owns a `title` column and declares no `title_field` is
        the exact shape §10.2 forbids, and it is also the shape that reads as
        "no title_field". Checking the attribute alone would wave it through.
        """
        undeclared = dataclasses.replace(slides.SPEC, legacy_fields=())
        meta = frappe.get_meta(DOCTYPE)
        self.assertIsNone(meta.get("title_field"))
        with self.assertRaises(DriveConflict):
            _validate_forbidden_fields(meta, undeclared)
        # And the declared one is accepted, on the same resolved answer.
        _validate_forbidden_fields(meta, slides.SPEC)

    def test_activation_still_refuses_a_title_column_nobody_declared(self):
        """The hatch is opt-in. An app that just grows a `title` is still refused."""
        undeclared = dataclasses.replace(slides.SPEC, legacy_fields=())
        with (
            activated(),
            patch(
                "suite.drive._core.content._build_registry",
                return_value={DOCTYPE: undeclared},
            ),
            self.assertRaises(DriveConflict),
        ):
            validate_content_registry()

    def test_a_legacy_declaration_expires_with_the_column_cleanup_drops(self):
        """The exemption cannot outlive Cleanup.

        Once §14.10 drops the column, the entry names a field the doctype no
        longer owns and the next migration refuses until the declaration drops
        it too. `trashed` stands in here for the already-dropped column.
        """
        stale = dataclasses.replace(slides.SPEC, legacy_fields=("title", "trashed"))
        with (
            activated(),
            patch("suite.drive._core.content._build_registry", return_value={DOCTYPE: stale}),
            self.assertRaises(DriveConflict),
        ):
            validate_content_registry()


class TestSlidesInDrive(IntegrationTestCase):
    """Lifecycle, history, media, previews, composites, and satellites, on real rows.

    Every test runs under `activated()`, because none of these workflows exist
    on a site until ticket 29 registers the declaration.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ensure_user(USER)
        ensure_user(OTHER)
        # A run killed between `setUp` and its cleanup leaves the fixture roots
        # behind, and `create_root` then refuses every later run.
        _purge_fixture_roots()
        frappe.db.commit()

    def setUp(self):
        super().setUp()
        frappe.set_user("Administrator")
        self._blobs_before = set(frappe.get_all("File Blob", pluck="name"))
        # Entered first, so its exit runs last: the fixture purge below is a
        # Drive workflow and needs the registry it injects.
        activation = activated()
        activation.__enter__()
        self.addCleanup(activation.__exit__, None, None, None)
        # Registered before the first row exists, so a `setUp` that dies half
        # way still hands its roots back.
        self.addCleanup(self._remove_fixture_rows)
        self.root = create_root(kind="Personal", title="Slides Root", user=USER)
        self.other_root = create_root(kind="Personal", title="Slides Other", user=OTHER)
        self.admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
        self.person = Principals(USER, (USER, "$GENERAL"), ("$PUBLIC",))

    def _remove_fixture_rows(self):
        frappe.set_user("Administrator")
        _purge_fixture_roots()
        for blob in set(frappe.get_all("File Blob", pluck="name")) - self._blobs_before:
            frappe.delete_doc("File Blob", blob, force=1, ignore_permissions=True, ignore_missing=True)
        frappe.db.commit()

    # helpers

    def _deck(self, title="Deck", parent=None, **kwargs) -> str:
        return drive.create_document(parent or self.root.node, title, content_doctype=DOCTYPE, **kwargs)

    def _docname(self, node: str) -> str:
        return frappe.db.get_value("Drive Node", node, "content_docname")

    def _slide_rows(self, node: str) -> list[dict]:
        return slides._slide_rows(self._docname(node))

    def _write_slide(self, node: str, **values) -> str:
        """Put one slide's body columns straight into the first slide row."""
        docname = self._docname(node)
        row = slides._slide_rows(docname)[0]
        frappe.db.set_value(SATELLITE, row["name"], values, update_modified=False)
        # `set_value` on a child row leaves the parent's document cache alone,
        # and the composite read path uses `get_cached_doc`.
        frappe.clear_document_cache(DOCTYPE, docname)
        return row["name"]

    def _media(self, node: str, title: str, payload: bytes) -> str:
        blob = put_blob(io.BytesIO(payload), is_private=True, filename=title)
        with patch("suite.drive._core.previews.enqueue_render"):
            return create_file(
                self.admin, node, title, blob=blob.name, size=blob.file_size, mime=blob.mime_type
            )

    def _blob_of(self, media: str) -> str:
        return frappe.db.get_value("Drive Node", media, "blob")

    def _used_bytes(self) -> int:
        return frappe.db.get_value("Drive Root", self.root.name, "used_bytes")

    def _as(self, user: str):
        frappe.set_user(user)
        self.addCleanup(frappe.set_user, "Administrator")

    # creation, and the immutable link

    def test_a_new_deck_carries_its_node_and_its_node_carries_it(self):
        node = self._deck(title="Kickoff")
        row = frappe.db.get_value(
            "Drive Node", node, ("kind", "mime", "title", "content_doctype", "content_docname"), as_dict=True
        )
        self.assertEqual(row.kind, "document")
        self.assertEqual(row.mime, "frappe/slides")
        self.assertEqual(row.title, "Kickoff")
        self.assertEqual(row.content_doctype, DOCTYPE)
        self.assertEqual(frappe.db.get_value(DOCTYPE, row.content_docname, "node"), node)

    def test_a_new_deck_starts_with_one_empty_slide_and_no_title_of_its_own(self):
        node = self._deck(title="Kickoff")
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        self.assertEqual(len(deck.slides), 1)
        self.assertFalse(deck.title, "Drive owns the title; §10.2 forbids a mirror")
        self.assertFalse(deck.slug)

    def test_a_linked_deck_cannot_write_the_frozen_legacy_title(self):
        """The freeze is what makes the §10.2 exemption honest.

        `legacy_fields` keeps the column past activation, so the column must
        stop being a mirror some other way. Every write to it is refused, in
        either direction, whoever attempts it.
        """
        node = self._deck(title="Frozen")
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        deck.title = "A mirror of the node title"

        with self.assertRaises(DriveConflict):
            deck.save(ignore_permissions=True)

    def test_a_save_keeps_the_build_title_so_the_rollback_source_survives(self):
        """§14.11: after Build the rollback is "ship the old code", which reads
        this column. A Drive-native save must leave the value Build wrote
        exactly as it found it, not clear it and not refuse the save."""
        node = self._deck(title="Kept")
        docname = self._docname(node)
        # What §14.7 leaves behind on a deck Build linked.
        frappe.db.set_value(DOCTYPE, docname, "title", "The Build title", update_modified=False)
        frappe.clear_document_cache(DOCTYPE, docname)

        deck = frappe.get_doc(DOCTYPE, docname)
        deck.theme = "dark"
        deck.save(ignore_permissions=True)

        self.assertEqual(frappe.db.get_value(DOCTYPE, docname, "title"), "The Build title")
        self.assertEqual(frappe.db.get_value("Drive Node", node, "title"), "Kept")

    def test_a_deck_without_a_node_cannot_exist(self):
        with self.assertRaises(DriveConflict):
            frappe.new_doc(DOCTYPE).insert(ignore_permissions=True)

    def test_a_saved_deck_cannot_repoint_itself_at_another_node(self):
        first = self._deck(title="First")
        second = self._deck(title="Second")
        deck = frappe.get_doc(DOCTYPE, self._docname(first))
        deck.node = second
        with self.assertRaises(DriveConflict):
            deck.save(ignore_permissions=True)

    def test_the_title_is_read_from_the_node_and_never_mirrored(self):
        node = self._deck(title="Quarterly")
        self.assertEqual(frappe.get_doc(DOCTYPE, self._docname(node)).node_title, "Quarterly")

    # templates (§8.10: there is no template verb)

    def test_a_template_starts_a_new_deck_and_drops_the_template_flag(self):
        template = self._deck(title="Pitch template", is_template=True)
        self._write_slide(template, elements=elements_naming(), background="#101010ff")
        started = self._deck(title="Pitch", from_node=template)

        self.assertTrue(frappe.db.get_value("Drive Node", template, "is_template"))
        self.assertFalse(frappe.db.get_value("Drive Node", started, "is_template"))
        self.assertEqual(self._slide_rows(started)[0]["background"], "#101010ff")
        self.assertFalse(
            frappe.db.get_value(DOCTYPE, self._docname(started), "is_template"),
            "the flag lives on the node, and the legacy column is never written",
        )

    # copy, and the media it carries

    def test_a_copy_carries_the_slides_and_repoints_every_picture(self):
        node = self._deck(title="Illustrated")
        picture = self._media(node, "one.png", png())
        poster = self._media(node, "poster.png", png("green"))
        self._write_slide(node, background=picture, elements=video_with(picture, {"url": poster}))

        copied = drive.copy(node, self.root.node, title="Illustrated copy")
        copied_media = frappe.get_all(
            "Drive Node", filters={"parent": copied, "state": "Active"}, pluck="name"
        )
        self.assertEqual(len(copied_media), 2)
        self.assertFalse(set(copied_media) & {picture, poster})

        row = self._slide_rows(copied)[0]
        element = json.loads(row["elements"])[0]
        self.assertIn(row["background"], copied_media)
        self.assertIn(element["src"], copied_media)
        self.assertIn(element["poster"]["url"], copied_media, "a dictionary poster follows the copy")
        self.assertEqual(row["background"], element["src"], "one blob, one node inside one deck")

    def test_a_copy_repoints_every_element_on_a_slide_not_only_the_first(self):
        """One slide, three pictures. A rewrite that stops at the first change
        leaves the rest of the copy pointing at the source deck's nodes, which
        the destination's owner may not be able to read at all."""
        node = self._deck(title="Three pictures")
        first = self._media(node, "one.png", png("red"))
        second = self._media(node, "two.png", png("green"))
        third = self._media(node, "three.png", png("blue"))
        self._write_slide(node, elements=elements_naming(first, second, third))

        copied = drive.copy(node, self.root.node, title="Three pictures copy")
        copied_media = set(
            frappe.get_all("Drive Node", filters={"parent": copied, "state": "Active"}, pluck="name")
        )
        named = [element["src"] for element in json.loads(self._slide_rows(copied)[0]["elements"])]

        self.assertEqual(len(named), 3)
        self.assertFalse(set(named) & {first, second, third}, "no element still names the source")
        self.assertTrue(set(named) <= copied_media)

    def test_one_picture_used_twice_becomes_one_node_and_one_charge(self):
        node = self._deck(title="Twice")
        picture = self._media(node, "logo.png", png("blue"))
        self._write_slide(node, background=picture, elements=elements_naming(picture, picture))
        before = self._used_bytes()

        copied = drive.copy(node, self.root.node, title="Twice copy")
        copied_media = frappe.get_all("Drive Node", filters={"parent": copied}, pluck="name")

        self.assertEqual(len(copied_media), 1, "one media node per blob inside one document")
        self.assertEqual(self._used_bytes(), before + frappe.db.get_value("Drive Node", picture, "size"))

    def test_a_copy_shares_the_blob_it_never_stores_the_bytes_twice(self):
        node = self._deck(title="Shared blob")
        picture = self._media(node, "one.png", png())
        self._write_slide(node, background=picture)

        copied = drive.copy(node, self.root.node, title="Shared blob copy")
        copy_media = frappe.get_all("Drive Node", filters={"parent": copied}, pluck="name")[0]
        self.assertEqual(self._blob_of(copy_media), self._blob_of(picture))

    # cross-deck paste (§8.9, ticket 16's upload-side handoff)

    def test_a_pasted_slide_brings_its_pictures_under_the_destination_deck(self):
        source = self._deck(title="Paste source")
        destination = self._deck(title="Paste destination")
        picture = self._media(source, "one.png", png())

        answered = api.update_slide_attachments(
            self._docname(destination), {"elements": elements_naming(picture)}
        )

        element = json.loads(answered["elements"])[0]
        self.assertNotEqual(element["src"], picture, "the destination owns its own node")
        adopted = frappe.db.get_value("Drive Node", element["src"], ("parent", "blob"), as_dict=True)
        self.assertEqual(adopted.parent, destination)
        self.assertEqual(adopted.blob, self._blob_of(picture), "the blob is shared, not stored twice")
        self.assertEqual(
            frappe.db.get_value("Drive Node", picture, "parent"), source, "the source is untouched"
        )

    def test_pasting_the_same_picture_twice_reuses_the_node_and_charges_once(self):
        source = self._deck(title="Repeat source")
        destination = self._deck(title="Repeat destination")
        picture = self._media(source, "logo.png", png("blue"))
        docname = self._docname(destination)
        before = self._used_bytes()

        first = api.update_slide_attachments(docname, {"elements": elements_naming(picture)})
        second = api.update_slide_attachments(docname, {"elements": elements_naming(picture)})

        self.assertEqual(json.loads(first["elements"])[0]["src"], json.loads(second["elements"])[0]["src"])
        self.assertEqual(frappe.db.count("Drive Node", {"parent": destination, "kind": "file"}), 1)
        self.assertEqual(self._used_bytes(), before + frappe.db.get_value("Drive Node", picture, "size"))

    def test_an_upload_of_a_blob_the_deck_already_holds_reuses_its_node(self):
        """Ticket 16's explicit handoff: §8.9's per-blob rule covers upload too,
        not only copy. Without it the same picture uploaded twice would be two
        nodes and two charges against one deck."""
        node = self._deck(title="Uploaded twice")
        blob = put_blob(io.BytesIO(png("orange")), is_private=True, filename="logo.png")
        before = self._used_bytes()

        with patch("suite.drive._core.previews.enqueue_render"):
            first = create_file(
                self.admin, node, "logo.png", blob=blob.name, size=blob.file_size, mime=blob.mime_type
            )
            second = create_file(
                self.admin, node, "logo-again.png", blob=blob.name, size=blob.file_size, mime=blob.mime_type
            )

        self.assertEqual(first, second)
        self.assertEqual(self._used_bytes(), before + blob.file_size)

    def test_a_loose_element_paste_adopts_its_src_and_its_poster(self):
        source = self._deck(title="Element source")
        destination = self._deck(title="Element destination")
        picture = self._media(source, "one.png", png())
        poster = self._media(source, "poster.png", png("green"))

        answered = api.get_updated_json(
            self._docname(destination), [{"type": "video", "src": picture, "poster": poster}]
        )

        self.assertEqual(
            {answered[0]["src"], answered[0]["poster"]},
            set(frappe.get_all("Drive Node", filters={"parent": destination, "kind": "file"}, pluck="name")),
        )

    def test_a_paste_of_media_the_caller_cannot_read_is_skipped_not_disclosed(self):
        """§8.9 skips what the copier cannot read, and a body holds colours and
        URLs beside ids, so an id that answers nothing cannot refuse the paste."""
        unreadable = self._deck(title="Not for them")
        picture = self._media(unreadable, "secret.png", png("black"))
        mine = self._deck(title="Mine")
        # Edit on this one deck, and nothing on the deck holding the picture.
        grant(mine, OTHER, drive.EDIT, self.admin)

        self._as(OTHER)
        mapping = drive.adopt_media(mine, [picture, "not-a-node-at-all"])
        frappe.set_user("Administrator")

        self.assertEqual(mapping, {})
        self.assertEqual(frappe.db.count("Drive Node", {"parent": mine, "kind": "file"}), 0)

    def test_a_paste_that_names_something_other_than_media_is_refused(self):
        folder = create_folder(self.admin, self.root.node, "Not media")
        node = self._deck(title="Refuses a folder")
        with self.assertRaises(DriveConflict):
            drive.adopt_media(node, [folder])

    def test_a_paste_naming_a_node_the_caller_cannot_read_is_never_told_what_it_is(self):
        """§5.4 on the source side. A caller who owns one deck can put any id in
        a slide body, so the refusal must not separate "a folder you cannot see"
        from "no such node": that is an existence and kind oracle."""
        hidden = create_folder(self.admin, self.other_root.node, "Not yours")
        mine = self._deck(title="Probe", parent=self.root.node)
        grant(mine, OTHER, drive.EDIT, self.admin)
        frappe.db.commit()

        self._as(OTHER)
        self.assertEqual(drive.adopt_media(mine, [hidden]), {}, "skipped, exactly like an unknown id")
        self.assertEqual(drive.adopt_media(mine, ["no-such-node"]), {})

    def test_a_paste_cannot_pull_an_ordinary_file_in_from_outside_a_deck(self):
        """The refusal says "media below a Drive content document", so it has to
        mean it. An ordinary file is not a deck's media, and letting one in is
        the move `_validate_generic_destination` refuses the other way."""
        folder = create_folder(self.admin, self.root.node, "Loose files")
        loose = self._media(folder, "loose.png", png())
        node = self._deck(title="Refuses a loose file")

        with self.assertRaises(DriveConflict):
            drive.adopt_media(node, [loose])

    def test_a_paste_that_names_no_media_is_still_checked(self):
        """`adopt_media` is the gate `update_slide_attachments` relies on for a
        linked deck. Returning an empty map before the check would let a
        stranger post a slide naming no picture and be answered."""
        node = self._deck(title="Empty paste")
        frappe.db.commit()

        self._as(OTHER)
        with self.assertRaises(DriveNotFound):
            drive.adopt_media(node, [])
        with self.assertRaises(DriveNotFound):
            api.update_slide_attachments(self._docname(node), {"elements": "[]"})

    def test_a_reader_cannot_paste_into_a_deck_and_a_stranger_is_not_told_it_exists(self):
        source = self._deck(title="Paste rights source")
        picture = self._media(source, "one.png", png())
        target = self._deck(title="Paste rights target")

        self._as(OTHER)
        with self.assertRaises(DriveNotFound):
            drive.adopt_media(target, [picture])
        frappe.set_user("Administrator")

        grant(target, OTHER, drive.READ, self.admin)
        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            drive.adopt_media(target, [picture])

    # history

    def test_a_version_round_trips_the_slides_the_theme_and_the_references(self):
        node = self._deck(title="Versioned")
        docname = self._docname(node)
        self._write_slide(node, background="#111111ff", elements=elements_naming())
        frappe.db.set_value(DOCTYPE, docname, "theme", "dark", update_modified=False)

        self._as(USER)
        seq = drive.take_version(node, kind="named", label="before the edit")
        frappe.set_user("Administrator")

        self._write_slide(node, background="#222222ff")
        frappe.db.set_value(DOCTYPE, docname, "theme", "light", update_modified=False)
        restore_version(self.person, node, seq)

        self.assertEqual(self._slide_rows(node)[0]["background"], "#111111ff")
        self.assertEqual(frappe.db.get_value(DOCTYPE, docname, "theme"), "dark")

    def test_a_restore_keeps_the_state_it_replaced_as_history(self):
        node = self._deck(title="Kept")
        self._write_slide(node, background="#aaaaaaff")
        seq = drive.take_version(node)
        self._write_slide(node, background="#bbbbbbff")

        captured = restore_version(self.admin, node, seq)
        self.assertGreater(captured, seq, "the state a restore replaced is versioned first")
        self.assertEqual(frappe.db.count("Drive Node Version", {"node": node}), 2)

    def test_a_restore_replaces_the_slides_rather_than_appending_them(self):
        node = self._deck(title="Replaced")
        seq = drive.take_version(node)
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        deck.append("slides", {"elements": "[]"})
        deck.save(ignore_permissions=True)
        self.assertEqual(len(self._slide_rows(node)), 2)

        restore_version(self.admin, node, seq)
        self.assertEqual(len(self._slide_rows(node)), 1)

    def test_the_deck_takes_a_version_through_drive(self):
        node = self._deck(title="Methodical")
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        self._as(USER)
        seq = deck.drive_take_version(kind="named", label="milestone")
        frappe.set_user("Administrator")

        row = frappe.db.get_value(
            "Drive Node Version", {"node": node, "seq": seq}, ("kind", "label", "actor"), as_dict=True
        )
        self.assertEqual((row.kind, row.label, row.actor), ("named", "milestone", USER))

    # purge

    def test_a_purge_removes_the_deck_its_slides_and_its_media(self):
        node = self._deck(title="Purged")
        docname = self._docname(node)
        picture = self._media(node, "one.png", png())
        slide = self._slide_rows(node)[0]["name"]

        update(self.admin, node, state="Trashed")
        purge(self.admin, node)

        self.assertFalse(frappe.db.exists("Drive Node", node))
        self.assertFalse(frappe.db.exists("Drive Node", picture))
        self.assertFalse(frappe.db.exists(DOCTYPE, docname))
        self.assertFalse(frappe.db.exists(SATELLITE, slide))

    def test_a_purge_keeps_no_recoverable_copy_of_the_deck(self):
        # `delete_doc` keeps the whole row as JSON in `Deleted Document` unless
        # it is told not to, so a purge that forgets `delete_permanently` leaves
        # every slide behind (§8.8: purge deletes).
        node = self._deck(title="Confidential")
        docname = self._docname(node)
        self._write_slide(node, elements=elements_naming("a-secret"))

        update(self.admin, node, state="Trashed")
        purge(self.admin, node)

        self.assertFalse(
            frappe.db.exists("Deleted Document", {"deleted_doctype": DOCTYPE, "deleted_name": docname}),
            "a purged deck must not survive as a recoverable row",
        )

    # the media sweep's one question (§10.6)

    def test_the_deck_answers_only_the_pictures_it_still_names(self):
        """Drive owns the trashing itself, and the daily pass is not run here:
        it would sweep every document on the site, and a shared-site test never
        touches a live user's rows."""
        node = self._deck(title="Swept")
        kept = self._media(node, "kept.png", png())
        poster = self._media(node, "poster.png", png("green"))
        self._media(node, "forgotten.png", png("black"))
        self._write_slide(node, background=kept, elements=video_with(kept, {"url": poster}))

        self.assertEqual(slides.SPEC.used_nodes(self._docname(node)), {kept, poster})

    def test_a_background_colour_never_hides_a_picture_from_the_sweep(self):
        node = self._deck(title="Coloured")
        kept = self._media(node, "kept.png", png())
        self._write_slide(node, background="#00ff00ff", elements=elements_naming(kept))
        self.assertEqual(slides.SPEC.used_nodes(self._docname(node)), {kept})

    # previews (§9.2, [012 §8])

    def test_the_browser_capture_is_pushed_through_drive_and_not_onto_a_file(self):
        node = self._deck(title="Captured")
        docname = self._docname(node)
        before = frappe.db.get_value("Drive Node", node, ("modified", "content_modified"), as_dict=True)

        answered = api.save_presentation_thumbnail(docname, webp_capture())

        row = frappe.db.get_value("Drive Node Preview", {"node": node}, ["source_blob", "blob"], as_dict=True)
        self.assertEqual(answered, "")
        self.assertIsNone(row.source_blob, "a pushed preview has no source blob")
        self.assertTrue(row.blob)
        self.assertFalse(frappe.db.get_value(DOCTYPE, docname, "thumbnail"), "no legacy thumbnail column")
        self.assertFalse(
            frappe.db.exists("File", {"attached_to_doctype": DOCTYPE, "attached_to_name": docname})
        )
        after = frappe.db.get_value("Drive Node", node, ("modified", "content_modified"), as_dict=True)
        self.assertEqual(after, before, "a preview is not an edit")

    def test_a_reader_cannot_push_a_preview(self):
        node = self._deck(title="Guarded capture")
        grant(node, OTHER, drive.READ, self.admin)
        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            api.save_presentation_thumbnail(self._docname(node), webp_capture())

    def test_a_copy_carries_the_preview_so_it_looks_right_at_once(self):
        node = self._deck(title="Previewed")
        api.save_presentation_thumbnail(self._docname(node), webp_capture())
        copied = drive.copy(node, self.root.node, title="Previewed copy")
        self.assertTrue(frappe.db.exists("Drive Node Preview", {"node": copied}))

    # composites (§6.6)

    def test_a_composite_may_reference_only_what_the_saver_can_read(self):
        theirs = self._deck(title="Theirs", parent=self.other_root.node)
        composite = self._deck(title="Composite")
        deck = frappe.get_doc(DOCTYPE, self._docname(composite))
        deck.is_composite = 1
        deck.append("reference_presentations", {"presentation": self._docname(theirs)})

        self._as(USER)
        with self.assertRaises(frappe.PermissionError):
            deck.save(ignore_permissions=True)

    def test_a_composite_save_grants_the_reference_nothing_and_forces_nothing_public(self):
        """§6.6 removes the forced-public row. Being named grants nothing, so a
        save writes no grant and no public permission of any kind."""
        from suite.drive.overrides.file import File as DriveFile

        # The row §6.6 removes is a `Drive Permission` with an empty user
        # (`presentation.py:106-110`), not a `Drive Grant`. Counting grants
        # alone would pass whether or not this ticket landed.
        permissions_before = frappe.db.count("Drive Permission", {"user": "", "deny": 0})

        referenced = self._deck(title="Referenced")
        composite = self._composite([referenced], title="Open composite")

        self.assertEqual(frappe.db.count("Drive Permission", {"user": "", "deny": 0}), permissions_before)
        self.assertEqual(frappe.db.count("Drive Grant", {"node": referenced, "principal": "$PUBLIC"}), 0)
        self.assertEqual(frappe.db.count("Drive Grant", {"node": composite, "principal": "$PUBLIC"}), 0)
        for name in (self._docname(referenced), self._docname(composite)):
            with self.subTest(deck=name):
                self.assertFalse(
                    DriveFile.get_for_doc(DOCTYPE, name),
                    "a linked deck has no File, so the forced-public row cannot be written",
                )

    def test_a_composite_marks_an_unreadable_reference_instead_of_dropping_it(self):
        mine = self._deck(title="Mine to share")
        hidden = self._deck(title="Hidden later")
        composite = self._composite([mine, hidden], title="Marked composite")
        self._write_slide(mine, background="#111111ff")
        self._write_slide(hidden, background="#222222ff")
        grant(composite, OTHER, drive.READ, self.admin)
        grant(mine, OTHER, drive.READ, self.admin)
        frappe.db.commit()

        self._as(OTHER)
        answered = api.get_composite_presentation(self._docname(composite))
        frappe.set_user("Administrator")

        readable = {row["presentation"]: row["readable"] for row in answered["references"]}
        self.assertEqual(readable[self._docname(mine)], True)
        self.assertEqual(readable[self._docname(hidden)], False, "marked, never dropped silently")
        self.assertEqual([slide.background for slide in answered["slides"]], ["#111111ff"])

        named = {row["presentation"]: row["node"] for row in answered["references"]}
        self.assertEqual(named[self._docname(mine)], mine)
        self.assertIsNone(
            named[self._docname(hidden)],
            "a node id is the handle every Drive route takes; §5.4 never discloses one",
        )

    def test_a_stranger_reads_no_composite_at_all(self):
        """One answer for "not a composite", "no such deck", and "a composite
        you cannot read". `get_composite_presentation` is guest-reachable, so
        `deck_is_readable` swallows Drive's own `DriveNotFound` and the route
        raises the single `frappe.PermissionError` it raises for the other two
        (`presentation.py:759-767`). A `DriveNotFound` expectation here would
        assert the disclosure the route exists to prevent."""
        composite = self._composite([self._deck(title="Inner")], title="Private composite")
        frappe.db.commit()
        self._as(OTHER)
        with self.assertRaises(frappe.PermissionError):
            api.get_composite_presentation(self._docname(composite))

    def test_the_composite_route_answers_a_stranger_the_same_way_three_times(self):
        """The three refusals have to be indistinguishable, or the route tells a
        stranger which names are linked composites (§5.4)."""
        composite = self._composite([self._deck(title="Inner three")], title="Private three")
        plain = self._deck(title="Not a composite")
        frappe.db.commit()

        self._as(OTHER)
        answers = set()
        for name in (self._docname(composite), self._docname(plain), "no-such-deck"):
            with self.subTest(name=name):
                with self.assertRaises(frappe.PermissionError) as refused:
                    api.get_composite_presentation(name)
                answers.add(str(refused.exception))
        self.assertEqual(len(answers), 1, "three different messages would separate the three cases")

    def _composite(self, referenced: list[str], title: str) -> str:
        node = self._deck(title=title)
        deck = frappe.get_doc(DOCTYPE, self._docname(node))
        deck.is_composite = 1
        for reference in referenced:
            deck.append("reference_presentations", {"presentation": self._docname(reference)})
        deck.save(ignore_permissions=True)
        return node

    # the satellite (§10.3)

    def test_a_slide_takes_its_rights_from_the_deck_node(self):
        node = self._deck(title="Satellite")
        slide = frappe.get_doc(SATELLITE, self._slide_rows(node)[0]["name"])
        grant(node, OTHER, drive.READ, self.admin)
        frappe.db.commit()

        self.assertTrue(satellite_has_permission(slide, "read", OTHER))
        self.assertFalse(satellite_has_permission(slide, "write", OTHER), "read to see, edit to change")
        grant(node, OTHER, drive.EDIT, self.admin)
        self.assertTrue(satellite_has_permission(slide, "write", OTHER))

    def test_a_stranger_sees_neither_the_slide_row_nor_the_slide_list(self):
        node = self._deck(title="Satellite private")
        slide = frappe.get_doc(SATELLITE, self._slide_rows(node)[0]["name"])
        frappe.db.commit()

        self.assertFalse(satellite_has_permission(slide, "read", OTHER))
        predicate = satellite_query_conditions(OTHER, SATELLITE)
        self.assertNotIn(slide.name, self._slides_matching(predicate))
        self.assertIn(slide.name, self._slides_matching(satellite_query_conditions(USER, SATELLITE)))

    def test_the_slide_list_filter_names_the_parent_doctype_too(self):
        # Names are unique per doctype, not across them: without `parenttype` a
        # row under an unrelated parent whose name matches a readable deck would
        # pass the filter.
        predicate = satellite_query_conditions(USER, SATELLITE)
        self.assertIn("`tabSlide`.`parenttype` = ", predicate)

    def _slides_matching(self, predicate: str) -> set[str]:
        if predicate in ("", "1=0"):
            return set() if predicate else self._all_slides()
        rows = frappe.db.sql(f"SELECT `name` FROM `tabSlide` WHERE {predicate}")
        return {row[0] for row in rows}

    def _all_slides(self) -> set[str]:
        return set(frappe.get_all(SATELLITE, pluck="name"))

    # authorization on the deck itself

    def test_an_inherited_folder_grant_reaches_the_row_and_the_list(self):
        folder = create_folder(self.admin, self.root.node, "Shared folder")
        node = self._deck(title="Inherited", parent=folder)
        docname = self._docname(node)
        grant(folder, OTHER, drive.READ, self.admin)
        frappe.db.commit()

        self._as(OTHER)
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertIn(docname, frappe.get_list(DOCTYPE, pluck="name"))
        self.assertFalse(frappe.has_permission(DOCTYPE, "write", docname))

    def test_a_stranger_reads_neither_the_row_nor_the_list(self):
        node = self._deck(title="Private")
        docname = self._docname(node)
        frappe.db.commit()

        self._as(OTHER)
        self.assertFalse(frappe.has_permission(DOCTYPE, "read", docname))
        self.assertNotIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

    def test_the_editor_access_answer_comes_from_the_node(self):
        node = self._deck(title="Ladder")
        docname = self._docname(node)
        frappe.db.commit()

        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "none")
        frappe.set_user("Administrator")

        grant(node, OTHER, drive.READ, self.admin)
        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "view")
        frappe.set_user("Administrator")

        grant(node, OTHER, drive.EDIT, self.admin)
        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "edit")

    def test_a_linked_composite_answers_editor_access_from_the_node_too(self):
        """The composite arm used to run first and answer `"view"` off the
        legacy `is_composite` column with no check, on a guest route. A stranger
        learned that a name is a composite deck Drive owns (§5.4), and the
        answer came from a column rather than from `Drive Grant` (§1)."""
        composite = self._composite([self._deck(title="Inner access")], title="Composite ladder")
        docname = self._docname(composite)
        frappe.db.commit()

        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "none", "a stranger is told nothing")
        frappe.set_user("Administrator")

        grant(composite, OTHER, drive.READ, self.admin)
        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "view")
        frappe.set_user("Administrator")

        # A composite is a live view over other decks: Edit still reads as view.
        grant(composite, OTHER, drive.MANAGE, self.admin)
        self._as(OTHER)
        self.assertEqual(api.get_editor_access(docname), "view", "its own body is not editable")

    def test_a_guest_learns_nothing_from_editor_access_about_a_linked_deck(self):
        """A Guest holds no grant, so every linked name answers the same way,
        composite or not. Any other answer is the oracle the composite read
        route was fixed to close."""
        composite = self._composite([self._deck(title="Inner guest")], title="Guest composite")
        plain = self._deck(title="Guest plain")
        frappe.db.commit()

        self._as("Guest")
        answers = {
            api.get_editor_access(self._docname(composite)),
            api.get_editor_access(self._docname(plain)),
        }
        frappe.set_user("Administrator")
        self.assertEqual(answers, {"none"})

    def test_a_legacy_composite_still_answers_view_without_a_grant(self):
        """The legacy arm is untouched: Build has not linked the row and ticket
        23 owns the legacy read path."""
        legacy = make_presentation("Legacy composite access")
        self.addCleanup(
            frappe.delete_doc, DOCTYPE, legacy.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.set_value(DOCTYPE, legacy.name, "is_composite", 1, update_modified=False)
        frappe.db.commit()

        self._as(OTHER)
        self.assertEqual(api.get_editor_access(legacy.name), "view")

    def test_a_trashed_deck_stays_readable_and_leaves_the_list(self):
        node = self._deck(title="Binned")
        docname = self._docname(node)
        update(self.admin, node, state="Trashed")
        frappe.db.commit()

        self._as(USER)
        self.assertTrue(frappe.has_permission(DOCTYPE, "read", docname), "the bin opens read-only")
        self.assertNotIn(docname, frappe.get_list(DOCTYPE, pluck="name"))

    def test_a_trashed_deck_refuses_a_paste_and_a_preview_push(self):
        source = self._deck(title="Trash source")
        picture = self._media(source, "one.png", png())
        node = self._deck(title="Binned writes")
        update(self.admin, node, state="Trashed")

        with self.assertRaises(DriveForbidden):
            drive.adopt_media(node, [picture])
        with self.assertRaises(DriveForbidden):
            api.save_presentation_thumbnail(self._docname(node), webp_capture())

    def test_a_trashed_deck_refuses_a_paste_that_names_no_picture_at_all(self):
        """§8.8: the bin opens read-only. The trash refusal used to sit after
        the empty-map early return, so a slide naming no media was accepted by a
        deck in the bin, and the endpoint's own `drive.check` does not read the
        trash state either."""
        node = self._deck(title="Binned empty paste")
        update(self.admin, node, state="Trashed")
        frappe.db.commit()

        with self.assertRaises(DriveForbidden):
            drive.adopt_media(node, [])
        with self.assertRaises(DriveForbidden):
            api.update_slide_attachments(self._docname(node), {"elements": "[]"})

    def test_a_docshare_cannot_open_a_deck_the_grants_refuse(self):
        node = self._deck(title="Unshared")
        docname = self._docname(node)
        with self.assertRaises(DriveForbidden):
            frappe.share.add(DOCTYPE, docname, OTHER, read=1)

        # A row written before adoption is refused on the read side too.
        share = frappe.get_doc(
            {"doctype": "DocShare", "share_doctype": DOCTYPE, "share_name": docname, "read": 1, "user": OTHER}
        )
        share.flags.ignore_validate = True
        share.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

        self._as(OTHER)
        with self.assertRaises(DriveForbidden):
            frappe.has_permission(DOCTYPE, "read", docname)

    # failure and rollback

    def test_a_failed_reference_rewrite_leaves_no_copy_and_no_charge(self):
        node = self._deck(title="Fragile")
        picture = self._media(node, "one.png", png())
        self._write_slide(node, background=picture, elements=elements_naming(picture))
        nodes_before = frappe.db.count("Drive Node")
        decks_before = frappe.db.count(DOCTYPE)
        bytes_before = self._used_bytes()

        with patch.object(slides, "_remap_element", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                drive.copy(node, self.root.node, title="Fragile copy")

        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), decks_before)
        self.assertEqual(self._used_bytes(), bytes_before)

    def test_a_refused_create_leaves_neither_a_node_nor_a_deck(self):
        nodes_before = frappe.db.count("Drive Node")
        decks_before = frappe.db.count(DOCTYPE)

        def explode(node):
            raise RuntimeError("boom")

        broken = dataclasses.replace(slides.SPEC, create_empty=explode)
        with patch("suite.drive._core.content.spec_for", return_value=broken):
            with self.assertRaises(RuntimeError):
                self._deck(title="Never")

        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), decks_before)

    def test_a_failed_adoption_leaves_no_media_and_no_charge(self):
        source = self._deck(title="Adopt source")
        picture = self._media(source, "one.png", png())
        destination = self._deck(title="Adopt destination")
        nodes_before = frappe.db.count("Drive Node")
        bytes_before = self._used_bytes()

        with patch("suite.drive._core.previews.copy_preview", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                drive.adopt_media(destination, [picture])

        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(self._used_bytes(), bytes_before)

    def test_a_stranger_cannot_create_a_deck_in_somebody_elses_drive(self):
        # A caller below Read never learns the node is there: `require` answers
        # `DriveNotFound`, because an unreadable node is never a 403 (§5.4).
        nodes_before = frappe.db.count("Drive Node")
        decks_before = frappe.db.count(DOCTYPE)
        self._as(OTHER)
        with self.assertRaises(DriveNotFound):
            drive.create_document(self.root.node, "Intruder", content_doctype=DOCTYPE)
        frappe.set_user("Administrator")
        self.assertEqual(frappe.db.count("Drive Node"), nodes_before)
        self.assertEqual(frappe.db.count(DOCTYPE), decks_before)

    # the dual path, and what Build has not copied yet

    def test_the_staged_legacy_guards_never_answer_for_a_linked_row(self):
        """The dual path, from the other side. While the hooks are staged they
        are `presentation.py`'s own, and a linked deck has no `File`, so the
        legacy predicate's template arm would have listed it and the legacy row
        check would have granted its owner everything."""
        node = self._deck(title="Linked")
        deck = frappe.get_doc(DOCTYPE, self._docname(node))

        self.assertFalse(api.has_permission(deck, "read", USER))
        self.assertFalse(api.has_permission(deck, "write", USER))
        predicate = api.get_permission_query_conditions(USER)
        self.assertIn("`tabPresentation`.`node` IS NULL", predicate)

    def test_a_docshare_cannot_open_a_linked_deck_through_the_staged_guards(self):
        """The staged guards run alone between Build and ticket 29, and
        answering False is not a denial. Frappe reads it as "no role
        permission" and then asks `false_if_not_shared`
        (`frappe/permissions.py:214-216`); the list side ORs the shared names
        around the predicate (`frappe/database/query.py:1737-1741`). Either
        would open a linked deck with no `Drive Grant` (§1).
        """
        node = self._deck(title="Staged and shared")
        docname = self._docname(node)
        share = frappe.get_doc(
            {"doctype": "DocShare", "share_doctype": DOCTYPE, "share_name": docname, "read": 1, "user": OTHER}
        )
        share.flags.ignore_validate = True
        share.insert(ignore_permissions=True)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

        deck = frappe.get_doc(DOCTYPE, docname)
        # Both guards raise the same `DriveForbidden`. It is a
        # `frappe.ValidationError` with a 403 status, not a
        # `frappe.PermissionError`: the two are unrelated classes
        # (`frappe/exceptions.py:23,40`), so a `PermissionError` expectation
        # here would never match what Drive raises.
        with self.assertRaises(DriveForbidden):
            api.has_permission(deck, "read", OTHER)
        with self.assertRaises(DriveForbidden):
            api.get_permission_query_conditions(OTHER)

    def test_a_docshare_on_a_legacy_deck_leaves_the_staged_list_alone(self):
        """The refusal is scoped to a deck that carries a node. Before Build no
        row has one, so a site with Desk assignments lists what it always did."""
        legacy = make_presentation("Assigned")
        self.addCleanup(
            frappe.delete_doc, DOCTYPE, legacy.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        share = frappe.share.add(DOCTYPE, legacy.name, OTHER, read=1)
        self.addCleanup(
            frappe.delete_doc, "DocShare", share.name, force=1, ignore_permissions=True, ignore_missing=True
        )
        frappe.db.commit()

        self.assertIn("`tabPresentation`.`node` IS NULL", api.get_permission_query_conditions(OTHER))

    def test_a_linked_deck_refuses_every_legacy_method(self):
        """A linked deck never falls back to the `File`: that would be a way
        around `Drive Grant` (§1)."""
        node = self._deck(title="No legacy writes")
        docname = self._docname(node)
        template = self._deck(title="No legacy template", is_template=True)

        for legacy in (
            lambda: api.save_base64_image("data:image/png;base64,AAAA", docname, "img"),
            lambda: api.delete_presentation(docname),
            lambda: api.update_title(docname, "Renamed"),
            lambda: api.is_public_presentation(docname),
            lambda: api.get_webp_doc(docname, {}),
            lambda: api.optimize_images(docname),
            lambda: api.create_presentation(duplicate_from=docname),
            lambda: api.create_presentation(template=self._docname(template)),
        ):
            with self.subTest(legacy=legacy), self.assertRaises(frappe.ValidationError):
                legacy()

        self.assertTrue(frappe.db.exists(DOCTYPE, docname), "nothing was deleted")
        self.assertFalse(frappe.db.get_value(DOCTYPE, docname, "title"))

    def test_a_linked_deck_never_grows_a_backing_file(self):
        node = self._deck(title="No File")
        docname = self._docname(node)
        self.assertFalse(
            frappe.db.exists("File", {"attached_to_doctype": DOCTYPE, "attached_to_name": docname})
        )
        with self.assertRaises(frappe.ValidationError):
            frappe.get_doc(DOCTYPE, docname).create_drive_file()

    def test_a_save_stamps_the_node_and_never_the_deck_title(self):
        # `create_document` stamps `content_modified` itself, so the creation
        # stamp is the value the save must beat. Deleting `drive_touch` leaves
        # the creation stamp in place and fails the comparison.
        node = self._deck(title="Stamped")
        created = get_datetime(frappe.db.get_value("Drive Node", node, "content_modified"))
        deck = frappe.get_doc(DOCTYPE, self._docname(node))

        deck.theme = "dark"
        deck.save(ignore_permissions=True)

        after = frappe.db.get_value("Drive Node", node, ("content_modified", "title"), as_dict=True)
        self.assertGreater(get_datetime(after.content_modified), created)
        self.assertEqual(after.title, "Stamped")

    def test_the_legacy_columns_and_media_paths_survive_adoption(self):
        # §14.7: Build reads these, Cleanup removes them. Nothing in this
        # ticket may drop them early.
        meta = frappe.get_meta(DOCTYPE)
        for legacy in ("title", "slug", "thumbnail", "is_template", "is_composite"):
            self.assertIsNotNone(meta.get_field(legacy), legacy)
        self.assertIsNotNone(frappe.get_meta(SATELLITE).get_field("background"))
        self.assertTrue(callable(api.save_base64_image), "the legacy upload path is still here")


def _purge_fixture_roots() -> None:
    """Hand back every Drive root the two fixture users own, through Drive's purge.

    `USER` and `OTHER` belong to this module alone, so the filter can never
    reach a live account or another test.
    """
    admin = Principals("Administrator", ("Administrator",), (), is_admin=True)
    roots = frappe.get_all("Drive Root", filters={"user": ["in", (USER, OTHER)]}, pluck="name")
    # Purging a document node calls the app's `on_purge`, which Drive reads from
    # the registry, so the purge runs registered even when the caller is not.
    with activated():
        for root in roots:
            if frappe.db.get_value("Drive Root", root, "state") == "Active":
                update_root(root, admin, state="Archived")
            purge_root(root, admin)
