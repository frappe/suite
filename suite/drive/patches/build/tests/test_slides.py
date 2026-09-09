"""Slides media, preview, body rewrite, and rerun behavior."""

import io
import json
import struct
import tempfile
import unittest
import zlib
from dataclasses import replace
from pathlib import Path

from PIL import Image

from suite.drive.patches.build.ports import REMOVED, ContentRow, MediaFileRow, SlideRow, TreeRow
from suite.drive.patches.build.slide_journal import SlideBody
from suite.drive.patches.build.slides import SLIDE_FIELDS, BuildSlidesError, convert_slides_and_templates
from suite.drive.patches.build.state import ContentConversion
from suite.drive.patches.build.tests.fakes import FakeContent, FakeContentTarget, build_environment

S3_URL = "/api/method/suite.drive.api.s3.fetch"

STAMP = "2024-01-02 03:04:05.000000"
OWNER = "owner@example.com"


def deck(name="deck-1", **values):
    values.setdefault("node", "deck-node")
    values.setdefault("title", "Deck")
    values.setdefault("owner", OWNER)
    values.setdefault("creation", STAMP)
    values.setdefault("modified", STAMP)
    values.setdefault("modified_by", OWNER)
    return ContentRow("Presentation", name, **values)


def media(name, *, deck_name="deck-1", blob=None, url=None, field=None):
    return MediaFileRow(
        name=name,
        deck=deck_name,
        file_name=f"{name}.png",
        file_url=url or f"/files/{name}.png",
        blob=blob,
        attached_to_field=field,
        owner=OWNER,
        creation=STAMP,
        modified=STAMP,
        modified_by=OWNER,
        file_modified=STAMP,
    )


def webp_bytes(size=(32, 24)):
    output = io.BytesIO()
    Image.new("RGB", size, "red").save(output, "WEBP")
    return output.getvalue()


def image_bytes(fmt, size=(32, 24), **save):
    output = io.BytesIO()
    Image.new("RGB", size, "red").save(output, fmt, **save)
    return output.getvalue()


def rotated_jpeg(size=(40, 20)):
    """A JPEG whose EXIF orientation 6 swaps its stored width and height."""
    image = Image.new("RGB", size, "red")
    exif = image.getexif()
    exif[274] = 6
    output = io.BytesIO()
    image.save(output, "JPEG", exif=exif)
    return output.getvalue()


def png_declaring(width, height):
    """A one-pixel PNG whose IHDR claims another size, with a repaired CRC.

    `Image.open` answers `size` from that header alone, which is the value both
    pixel bounds read, so this stays a few hundred bytes.
    """
    data = bytearray(image_bytes("PNG", (1, 1)))
    data[16:24] = struct.pack(">II", width, height)
    data[29:33] = struct.pack(">I", zlib.crc32(bytes(data[12:29])))
    return bytes(data)


def preview_size(target):
    with Image.open(io.BytesIO(target.blob_bytes[target.preview_rows["deck-node"]["blob"]])) as image:
        return image.size


class SlidesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)

    def environment(self, source):
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
        )
        self.document_node(target, "deck-node", "deck-1", "Deck")
        return env, target

    def document_node(self, target, node, docname, title):
        target.node_rows[node] = {
            "name": node,
            "title": title,
            "parent": "root",
            "root": "root",
            "path": "",
            "kind": "document",
            "content_doctype": "Presentation",
            "content_docname": docname,
        }

    def tree_node(self, target, name, parent, **values):
        """The node §14.4 wrote for a media File the legacy tree also held."""
        row = {
            "name": name,
            "title": f"{name}.png",
            "parent": parent,
            "root": parent,
            "path": "",
            "kind": "file",
            "blob": None,
            "size": 0,
            "mime": None,
            "url": None,
            "content_doctype": None,
            "content_docname": None,
            "state": "Active",
            "trashed_at": None,
            "trash_root": None,
            "content_modified": STAMP,
            "is_template": 0,
            "owner": OWNER,
            "creation": STAMP,
            "modified": STAMP,
            "modified_by": OWNER,
            "docstatus": 0,
            "idx": 0,
        }
        row.update(values)
        target.node_rows[name] = row
        return row

    def media_children(self, target, node):
        return [row for row in target.child_nodes(node) if row.get("kind") == "file"]

    def test_a_second_slides_phase_keeps_one_shot_repairs(self):
        result = ContentConversion(slide_elements_repaired=1)

        result.begin_phase("slides", SLIDE_FIELDS)
        result.begin_phase("slides", SLIDE_FIELDS)

        self.assertEqual(result.slide_elements_repaired, 1)

    def test_same_blob_media_collapses_and_all_exact_aliases_rewrite(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps(
                        [
                            {
                                "src": "/files/media-a.png",
                                "poster": {"value": "/private/files/media-b.png"},
                                "attachmentName": "media-b",
                                "text": "keep",
                            }
                        ]
                    ),
                    "/files/media-b.png",
                )
            ],
            media=[
                media("media-b", blob="blob-1", url="/files/media-b.png"),
                media("media-a", blob="blob-1", url="/files/media-a.png"),
            ],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", b"media", mime_type="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_nodes_created, 1)
        self.assertEqual(result.media_duplicates_collapsed, 1)
        self.assertEqual(result.slide_elements_rewritten, 1)
        body = json.loads(source.slide_rows["slide-1"].elements)
        self.assertEqual(body[0]["src"], "media-a")
        self.assertEqual(body[0]["poster"]["value"], "media-a")
        self.assertNotIn("attachmentName", body[0])
        self.assertEqual(source.slide_rows["slide-1"].background, "media-a")
        self.assertEqual(len(env.slide_journal.records), 1)

        convert_slides_and_templates(env)
        self.assertEqual(len(env.slide_journal.records), 1)

    def test_media_nodes_carry_the_deck_child_path(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": "/files/media-a.png"}]))],
            media=[media("media-a", blob="blob-1"), media("media-b")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", b"media", mime_type="image/png")

        convert_slides_and_templates(env)

        # `_core/nodes.child_path` is `f"{path or '/'}{name}/"`. A node stored
        # without the leading slash is refused by `_check_tree_position` on
        # every later save, move, restore, or copy.
        for name in ("media-a", "media-b"):
            self.assertEqual(target.node_rows[name]["path"], "/deck-node/")
            self.assertEqual(target.node_rows[name]["parent"], "deck-node")
            self.assertEqual(target.node_rows[name]["root"], "root")

    def test_a_deck_too_deep_to_hold_media_is_refused_before_it_writes(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, "[]")],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        # `Drive Node.path` is `varchar(500)`, so a child of this deck cannot
        # carry a legal path. Bulk SQL fires no validator, so an over-long one
        # would be stored and every later save of that node would fail.
        target.node_rows["deck-node"]["path"] = "/" + "x" * 500

        with self.assertRaisesRegex(BuildSlidesError, "too deep to hold media nodes"):
            convert_slides_and_templates(env)

        self.assertEqual(self.media_children(target, "deck-node"), [])

    def test_a_deck_past_the_depth_cap_is_refused_the_same_way(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, "[]")],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.node_rows["deck-node"]["path"] = "/" + "/".join(f"n{index}" for index in range(41)) + "/"

        with self.assertRaisesRegex(BuildSlidesError, "too deep to hold media nodes"):
            convert_slides_and_templates(env)

    def test_media_inserts_are_held_to_the_batch_size(self):
        rows = [media(f"media-{index}", blob=f"blob-{index}") for index in range(5)]
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, "[]")],
            media=rows,
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        for row in rows:
            target.add_blob(row.blob, row.name.encode(), mime_type="image/png")
        sizes = []
        original = target.insert_nodes

        def record(nodes):
            media_rows = [row for row in nodes if row["parent"] == "deck-node"]
            if media_rows:
                sizes.append(len(media_rows))
            original(nodes)

        target.insert_nodes = record

        convert_slides_and_templates(env, batch_size=2)

        # §14.2 holds a Build write to the batch size. One insert per node
        # would put a whole deck's media in a single transaction.
        self.assertEqual(sizes, [2, 2, 1])
        self.assertEqual(len(self.media_children(target, "deck-node")), 5)

    def test_media_files_sharing_a_file_name_get_deduped_sibling_titles(self):
        first = replace(media("media-a", blob="blob-a"), file_name="picture.png")
        second = replace(media("media-b", blob="blob-b"), file_name="picture.png")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, "[]")],
            media=[first, second],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("blob-b", b"b", mime_type="image/png")

        convert_slides_and_templates(env)

        # `_refuse_sibling_collision` bars two Active siblings from sharing a
        # title, and bulk SQL fires no validator. The rename happens here or
        # the pair lands in a state the runtime cannot produce or repair.
        titles = sorted(row["title"] for row in self.media_children(target, "deck-node"))
        self.assertEqual(titles, ["picture (2).png", "picture.png"])

        convert_slides_and_templates(env)

        again = sorted(row["title"] for row in self.media_children(target, "deck-node"))
        self.assertEqual(again, titles)

    def test_an_untouched_slide_keeps_its_stored_bytes(self):
        stored = json.dumps([{"src": "https://cdn.example.com/a.png", "text": "keep"}], indent=2)
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, stored)],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        # Nothing resolved, so nothing is a rewrite. Dumping the parsed body
        # back would compact the stored JSON, fill the journal, and edit a
        # source row the ticket says to preserve.
        self.assertEqual(source.slide_rows["slide-1"].elements, stored)
        self.assertEqual(result.slide_elements_rewritten, 0)
        self.assertEqual(env.slide_journal.records, [])

    def test_a_double_encoded_body_is_read_rewritten_and_stored_as_an_array(self):
        # A legacy row whose `elements` is a JSON string holding the JSON
        # array. No Build pass wrote it, and the Slides runtime refuses it.
        stored = json.dumps(json.dumps([{"src": "/files/media-a.png", "text": "keep"}]))
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, stored)],
            media=[media("media-a", blob="blob-1")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", b"media", mime_type="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.slide_elements_repaired, 1)
        self.assertEqual(result.slide_elements_rewritten, 1)
        body = json.loads(source.slide_rows["slide-1"].elements)
        self.assertEqual(body, [{"src": "media-a", "text": "keep"}])

        again = convert_slides_and_templates(env)
        self.assertEqual(again.slide_elements_repaired, 1)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), body)
        self.assertEqual(len(env.slide_journal.records), 1)

    def test_a_double_encoded_body_with_no_media_is_still_stored_as_an_array(self):
        # The production shape: two text elements, so nothing resolves and
        # only the double encoding is repaired.
        elements = [{"type": "text", "content": "one"}, {"type": "text", "content": "two"}]
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps(json.dumps(elements)))],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.slide_elements_repaired, 1)
        self.assertEqual(result.slide_elements_rewritten, 0)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), elements)

        again = convert_slides_and_templates(env)
        self.assertEqual(again.slide_elements_repaired, 1)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), elements)
        self.assertEqual(len(env.slide_journal.records), 1)

    def test_a_double_encoded_body_that_is_not_a_list_still_refuses_the_deck(self):
        for stored in (json.dumps(json.dumps({"src": "/files/media-a.png"})), json.dumps("plain text")):
            with self.subTest(stored=stored):
                source = FakeContent(
                    documents=[deck()],
                    slides=[SlideRow("slide-1", "deck-1", 1, stored)],
                    users={"Administrator": True},
                )
                env, _ = self.environment(source)

                with self.assertRaisesRegex(BuildSlidesError, "not a list"):
                    convert_slides_and_templates(env)
                self.assertEqual(source.slide_rows["slide-1"].elements, stored)

    def test_null_and_empty_bodies_hold_no_elements_and_are_left_alone(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, None), SlideRow("slide-2", "deck-1", 2, "")],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertTrue(result.slides_completed)
        self.assertEqual(result.slide_elements_repaired, 0)
        self.assertEqual(result.slide_elements_rewritten, 0)
        self.assertIsNone(source.slide_rows["slide-1"].elements)
        self.assertEqual(source.slide_rows["slide-2"].elements, "")
        self.assertEqual(env.slide_journal.records, [])

    def test_an_unmatched_thumbnail_is_reported_and_the_deck_still_converts(self):
        source = FakeContent(
            documents=[deck(thumbnail="/files/gone.webp")],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": "/files/media-a.png"}]))],
            media=[media("media-a", blob="blob-1")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", b"media", mime_type="image/png")

        result = convert_slides_and_templates(env)

        # A preview is derived data. Refusing the whole Build over one is
        # worse than losing it, so the run reports and carries on.
        self.assertTrue(result.slides_completed)
        self.assertEqual(result.deck_previews_created, 0)
        self.assertEqual(len(result.issues), 1)
        self.assertIn("matches no File row", result.issues[0].reason)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements)[0]["src"], "media-a")

    def test_a_private_thumbnail_matches_a_public_thumbnail_url(self):
        row = replace(media("thumb", url="/private/files/thumb.webp", field="thumbnail"), blob="blob-1")
        source = FakeContent(
            documents=[deck(thumbnail="/files/thumb.webp")],
            slides=[SlideRow("slide-1", "deck-1", 1, "[]")],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", webp_bytes(), mime_type="image/webp", is_private=1)

        result = convert_slides_and_templates(env)

        # A deck made private after its thumbnail was written keeps the old
        # public URL on the `Presentation` row and the private one on `File`.
        self.assertEqual(result.deck_previews_created, 1)
        self.assertEqual(result.issues, [])

    def test_a_deck_wider_than_one_page_converts_every_slide_and_file(self):
        """§13 reads the deck in bounded pages, and §12 still preflights all of it."""
        rows = [media(f"media-{index}", blob=f"blob-{index}") for index in range(5)]
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(f"slide-{index}", "deck-1", index + 1, json.dumps([{"src": row.file_url}]))
                for index, row in enumerate(rows)
            ],
            media=rows,
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        for index in range(5):
            target.add_blob(f"blob-{index}", b"media", mime_type="image/png")

        result = convert_slides_and_templates(env, batch_size=2)

        self.assertEqual(result.media_nodes_created, 5)
        self.assertEqual(result.slide_elements_rewritten, 5)
        self.assertEqual(len(self.media_children(target, "deck-node")), 5)
        for index in range(5):
            body = json.loads(source.slide_rows[f"slide-{index}"].elements)
            self.assertEqual(body[0]["src"], f"media-{index}")

    def test_blobless_media_creates_a_placeholder_but_does_not_resolve_body(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps([{"src": "/files/missing.png", "attachmentName": "missing"}]),
                )
            ],
            media=[media("missing")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.blobless_nodes, 1)
        self.assertEqual(result.media_nodes_created, 0)
        self.assertIsNone(target.node_rows["missing"]["blob"])
        body = json.loads(source.slide_rows["slide-1"].elements)
        self.assertEqual(body, [{"src": "/files/missing.png"}])

    def test_later_ready_blob_repairs_the_source_named_placeholder(self):
        row = media("media-a")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": row.file_url}]))],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        convert_slides_and_templates(env)

        source.media_rows[0] = replace(row, blob="blob-1")
        target.add_blob("blob-1", b"media", mime_type="image/png")
        result = convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["media-a"]["blob"], "blob-1")
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements)[0]["src"], "media-a")
        self.assertEqual(result.blobless_nodes, 0)

    def test_src_wins_an_attachment_disagreement_and_the_issue_is_recorded(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps([{"src": "/private/files/a.png", "attachmentName": "media-b"}]),
                )
            ],
            media=[
                media("media-a", blob="blob-a", url="/private/files/a.png"),
                media("media-b", blob="blob-b", url="/private/files/b.png"),
            ],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("blob-b", b"b", mime_type="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": "media-a"}])
        self.assertEqual(result.issues_total, 1)
        self.assertEqual(result.issues[0].source, "Slide:slide-1")
        self.assertIn("src won", result.issues[0].reason)

    def test_same_deck_attachment_repairs_only_an_unresolved_local_legacy_url(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps(
                        [
                            {"src": "/private/files/old-name.png", "attachmentName": "media-a"},
                            {"src": "https://remote.example/a.png", "attachmentName": "media-a"},
                            {"src": "/assets/suite/a.png", "attachmentName": "media-a"},
                            {"type": "image", "attachmentName": "media-a"},
                        ]
                    ),
                )
            ],
            media=[media("media-a", blob="blob-a", url="/private/files/current.png")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(
            json.loads(source.slide_rows["slide-1"].elements),
            [
                {"src": "media-a"},
                {"src": "https://remote.example/a.png"},
                {"src": "/assets/suite/a.png"},
                {"type": "image"},
            ],
        )

    def test_encoded_and_decoded_s3_fetch_urls_are_the_same_alias(self):
        encoded = "/api/method/suite.drive.api.s3.fetch?path=team%2Flogo.webp"
        decoded = "/api/method/suite.drive.api.s3.fetch?path=team/logo.webp"
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": decoded}]))],
            media=[media("media-a", blob="blob-a", url=encoded)],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/webp")

        convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": "media-a"}])

    def test_a_remote_file_url_never_resolves_a_body_reference(self):
        remote = "https://cdn.example/logo.png"
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": remote}]))],
            media=[media("media-a", blob="blob-a", url=remote)],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": remote}])
        self.assertEqual(target.node_rows["media-a"]["blob"], "blob-a")

    def test_one_template_file_is_borrowed_into_each_consuming_deck(self):
        template = deck("template", node=None, title="Template", is_template=1)
        first = deck("consumer-a", node="consumer-a-node", title="A")
        second = deck("consumer-b", node="consumer-b-node", title="B")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[template, first, second],
            slides=[
                SlideRow("slide-a", first.name, 1, json.dumps([{"src": template_url}])),
                SlideRow("slide-b", second.name, 1, json.dumps([{"src": template_url}])),
            ],
            media=[media("template-file", deck_name=template.name, blob="blob-a", url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, first.node, first.name, first.title)
        self.document_node(target, second.node, second.name, second.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        borrowed = [self.media_children(target, node) for node in (first.node, second.node)]
        self.assertEqual([len(rows) for rows in borrowed], [1, 1])
        self.assertNotEqual(borrowed[0][0]["name"], borrowed[1][0]["name"])
        self.assertNotIn("template-file", {rows[0]["name"] for rows in borrowed})
        self.assertEqual(
            [json.loads(source.slide_rows[slide].elements)[0]["src"] for slide in ("slide-a", "slide-b")],
            [borrowed[0][0]["name"], borrowed[1][0]["name"]],
        )
        for rows, consumer in zip(borrowed, (first, second), strict=True):
            self.assertEqual(rows[0]["owner"], consumer.owner)
            self.assertEqual(rows[0]["title"], "template-file.png")

        convert_slides_and_templates(env)
        self.assertEqual([self.media_children(target, node) for node in (first.node, second.node)], borrowed)

    def test_a_borrowed_reference_reuses_the_consuming_deck_blob_node(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[template, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": template_url}]))],
            media=[
                media("template-file", deck_name=template.name, blob="blob-a", url=template_url),
                media("own-file", deck_name=consumer.name, blob="blob-a", url="/private/files/own.png"),
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual([row["name"] for row in self.media_children(target, consumer.node)], ["own-file"])
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": "own-file"}])

    def test_two_template_blobs_for_one_url_refuse_the_deck(self):
        first = deck("template-a", node=None, title="Template A", is_template=1)
        second = deck("template-b", node=None, title="Template B", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        shared_url = "/private/files/logo.png"
        source = FakeContent(
            documents=[first, second, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": shared_url}]))],
            media=[
                media("file-a", deck_name=first.name, blob="blob-a", url=shared_url),
                media("file-b", deck_name=second.name, blob="blob-b", url=shared_url),
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("blob-b", b"b", mime_type="image/png")

        with self.assertRaises(BuildSlidesError):
            convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": shared_url}])

    def one_picture_twice(self, deck_name, *, private_bytes=b"one picture"):
        """The pair legacy Slides left: one picture stored public and private.

        `/files/logo.png` and `/private/files/logo.png` are two `File` rows on
        one deck, pointing at two `File Blob` rows of the same bytes. Three
        such pairs sit on the "Frappeverse 2025" template deck.
        """
        return [
            media("public-file", deck_name=deck_name, blob="blob-public", url="/files/logo.png"),
            media("private-file", deck_name=deck_name, blob="blob-private", url="/private/files/logo.png"),
        ], private_bytes

    def add_pair_blobs(self, target, private_bytes):
        target.add_blob("blob-public", b"one picture", mime_type="image/png", is_private=0)
        target.add_blob("blob-private", private_bytes, mime_type="image/png")

    def test_a_borrowed_picture_stored_public_and_private_resolves_to_one_node(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        rows, private_bytes = self.one_picture_twice(template.name)
        source = FakeContent(
            documents=[template, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": "/files/logo.png"}]))],
            media=rows,
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        self.add_pair_blobs(target, private_bytes)

        result = convert_slides_and_templates(env)

        borrowed = self.media_children(target, consumer.node)
        self.assertEqual(len(borrowed), 1)
        # Tier 1: the reference spells the public row's `file_url` exactly.
        self.assertEqual(borrowed[0]["blob"], "blob-public")
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": borrowed[0]["name"]}])
        self.assertEqual(result.borrowed_duplicates_collapsed, 1)
        self.assertEqual(result.issues_total, 0)

        again = convert_slides_and_templates(env)

        self.assertEqual(self.media_children(target, consumer.node), borrowed)
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": borrowed[0]["name"]}])
        # The rerun reads a node id, adopts nothing, and collapses nothing.
        # The counter reports the mint, so §14.9 keeps none of it.
        self.assertEqual(again.borrowed_duplicates_collapsed, 0)

    def test_two_borrowed_blobs_of_different_bytes_still_refuse_the_deck(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        rows, _ = self.one_picture_twice(template.name)
        source = FakeContent(
            documents=[template, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": "/files/logo.png"}]))],
            media=rows,
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        self.add_pair_blobs(target, b"another picture")

        with self.assertRaises(BuildSlidesError) as caught:
            convert_slides_and_templates(env)

        self.assertIn("is ambiguous", str(caught.exception))
        self.assertEqual(self.media_children(target, consumer.node), [])
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": "/files/logo.png"}])

    def test_a_deck_picture_stored_public_and_private_becomes_one_node(self):
        rows, private_bytes = self.one_picture_twice("deck-1")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": "/files/logo.png"}]))],
            media=rows,
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        self.add_pair_blobs(target, private_bytes)

        result = convert_slides_and_templates(env)

        children = self.media_children(target, "deck-node")
        self.assertEqual([row["name"] for row in children], ["private-file"])
        # No reference spells one row over the other, so tier 2 wins.
        self.assertEqual(children[0]["blob"], "blob-private")
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": "private-file"}])
        self.assertEqual((result.media_nodes_created, result.media_duplicates_collapsed), (1, 1))

        again = convert_slides_and_templates(env)

        self.assertEqual(self.media_children(target, "deck-node"), children)
        self.assertEqual((again.media_nodes_created, again.media_duplicates_collapsed), (1, 1))

    def test_a_non_template_borrowed_file_stays_unresolved_and_is_reported(self):
        other = deck("other", node="other-node", title="Other")
        shared_url = "/private/files/pasted.png"
        source = FakeContent(
            documents=[deck(), other],
            slides=[
                SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": shared_url}])),
                SlideRow("slide-2", other.name, 1, json.dumps([])),
            ],
            media=[media("other-file", deck_name=other.name, blob="blob-a", url=shared_url)],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        self.document_node(target, other.node, other.name, other.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": shared_url}])
        self.assertEqual(self.media_children(target, "deck-node"), [])
        self.assertEqual(result.issues_total, 1)
        self.assertEqual(result.issues[0].source, "Presentation:deck-1")
        self.assertIn("non-template", result.issues[0].reason)

    def test_private_small_webp_thumbnail_becomes_the_deck_preview(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            slides=[],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.deck_previews_created, 1)
        self.assertEqual(target.preview_rows["deck-node"]["name"], "thumb")
        self.assertEqual(target.preview_rows["deck-node"]["blob"], "thumb-blob")
        self.assertNotIn("thumb", target.node_rows)

    def test_public_thumbnail_is_reencoded_into_a_private_webp(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp", is_private=0)

        convert_slides_and_templates(env)

        preview_blob = target.preview_rows["deck-node"]["blob"]
        self.assertNotEqual(preview_blob, "thumb-blob")
        self.assertEqual(target.blob_rows[preview_blob].mime_type, "image/webp")
        self.assertEqual(target.blob_rows[preview_blob].is_private, 1)

    def test_invalid_slide_preflight_writes_no_media_or_preview(self):
        row = media("media-a", blob="blob-1")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, "not-json")],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-1", b"media")
        before = set(target.node_rows)

        with self.assertRaisesRegex(BuildSlidesError, "not JSON"):
            convert_slides_and_templates(env)
        self.assertEqual(set(target.node_rows) - before, {"id1", "id3"})
        self.assertFalse(target.preview_rows)
        self.assertEqual(source.slide_rows["slide-1"].elements, "not-json")

    def test_true_orphan_deck_is_deferred_for_the_link_phase(self):
        orphan = deck(node=None)
        source = FakeContent(documents=[orphan], users={"Administrator": True})
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
        )

        result = convert_slides_and_templates(env)

        self.assertFalse(result.slides_completed)
        self.assertEqual(result.slides_deferred, 1)
        self.assertNotIn(orphan.name, target.node_rows)

    def test_a_deck_whose_only_file_is_removed_is_skipped_not_deferred(self):
        # §14.4 skipped the File row, so the deck has no node and gets none.
        # Step 8 converts nothing for it and does not stop the migration;
        # step 10 records it.
        removed = deck(node=None)
        source = FakeContent(
            documents=[removed],
            files=[
                TreeRow(
                    "file-1",
                    status=REMOVED,
                    content_doctype="Presentation",
                    content_docname=removed.name,
                )
            ],
            users={"Administrator": True},
        )
        target = FakeContentTarget(content=source)
        env = build_environment(
            self.path,
            content=source,
            content_target=target,
            content_ready=True,
        )

        result = convert_slides_and_templates(env)

        self.assertTrue(result.slides_completed)
        self.assertEqual(result.slides_deferred, 0)
        self.assertEqual(result.media_nodes_created, 0)
        self.assertEqual(result.deck_previews_created, 0)
        self.assertEqual(result.issues, [])
        self.assertNotIn(removed.name, target.node_rows)

    # -- defect 1: same-site absolute URLs

    def test_a_same_site_absolute_url_resolves_as_file_url_and_as_a_body_value(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps(
                        [
                            {"src": "https://site.example/files/a.png"},
                            {"src": "/files/b.png"},
                        ]
                    ),
                )
            ],
            media=[
                media("media-a", blob="blob-a", url="/files/a.png"),
                media("media-b", blob="blob-b", url="https://site.example/files/b.png"),
            ],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("blob-b", b"b", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(
            json.loads(source.slide_rows["slide-1"].elements),
            [{"src": "media-a"}, {"src": "media-b"}],
        )

    # -- defect 2: the S3 fetch URL carries its identity in the query

    def test_two_s3_media_files_convert_and_every_s3_spelling_resolves(self):
        encoded_a = f"{S3_URL}?path=team%2Fa.webp"
        encoded_b = f"{S3_URL}?path=team%2Fb.webp"
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps(
                        [
                            {"src": encoded_a},
                            {"src": f"{S3_URL}?path=team/a.webp"},
                            {"src": "team/a.webp"},
                            {"src": encoded_b},
                        ]
                    ),
                )
            ],
            media=[
                media("media-a", blob="blob-a", url=encoded_a),
                media("media-b", blob="blob-b", url=encoded_b),
            ],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/webp")
        target.add_blob("blob-b", b"b", mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_nodes_created, 2)
        self.assertEqual(
            json.loads(source.slide_rows["slide-1"].elements),
            [{"src": "media-a"}, {"src": "media-a"}, {"src": "media-a"}, {"src": "media-b"}],
        )

    def test_a_decoded_s3_thumbnail_matches_only_its_own_file(self):
        encoded = f"{S3_URL}?path=team%2Fcover.webp"
        row = media("thumb", blob="thumb-blob", url=encoded)
        other = media("other", blob="other-blob", url=f"{S3_URL}?path=team%2Fother.webp")
        source = FakeContent(
            documents=[deck(thumbnail=f"{S3_URL}?path=team/cover.webp")],
            media=[row, other],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")
        target.add_blob("other-blob", b"other", mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.deck_previews_created, 1)
        self.assertEqual(target.preview_rows["deck-node"]["name"], "thumb")

    # -- defect 3: the controller child-path rule

    def test_a_media_child_of_a_root_level_deck_uses_the_controller_path(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["deck-node"]["path"], "")
        self.assertEqual(target.node_rows["media-a"]["path"], "/deck-node/")

    # -- defect 4: composite decks

    def test_a_composite_deck_never_copies_the_referenced_deck_media(self):
        template = deck("template", node=None, title="Template", is_template=1)
        composite = deck("composite", node="composite-node", title="Composite", is_composite=1)
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[composite, template],
            slides=[SlideRow("slide-a", composite.name, 1, json.dumps([{"src": template_url}]))],
            media=[media("template-file", deck_name=template.name, blob="blob-a", url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, composite.node, composite.name, composite.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(self.media_children(target, composite.node), [])
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": template_url}])
        self.assertEqual(
            [row["name"] for row in self.media_children(target, template.name)], ["template-file"]
        )

    # -- defect 5: a borrowed reference with no Ready blob

    def test_a_borrowed_reference_without_a_ready_blob_is_reported_not_refused(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[consumer, template],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": template_url}]))],
            media=[media("template-file", deck_name=template.name, url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)

        result = convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": template_url}])
        self.assertEqual(self.media_children(target, consumer.node), [])
        self.assertEqual(result.issues_total, 1)
        self.assertIn("no Ready blob", result.issues[0].reason)

    def test_a_media_reference_without_a_file_row_is_reported_not_rewritten(self):
        missing = "/files/gone.png"
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-a", "deck-1", 1, json.dumps([{"src": missing}]))],
            users={"Administrator": True},
        )
        env, target = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": missing}])
        self.assertEqual(self.media_children(target, "deck-node"), [])
        self.assertEqual(result.media_references_missing_file_rows, 1)
        self.assertEqual(result.issues_total, 1)
        self.assertEqual(
            result.issues[0].reason,
            "media reference '/files/gone.png' matches no File row attached to a Presentation "
            "and no media node; was not adopted",
        )

    def test_empty_media_references_are_not_reported(self):
        source = FakeContent(
            documents=[deck()],
            slides=[
                SlideRow(
                    "slide-a",
                    "deck-1",
                    1,
                    json.dumps([{"src": "", "poster": "   "}]),
                    "",
                )
            ],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_references_missing_file_rows, 0)
        self.assertEqual(result.issues, [])

    def test_a_bare_hex_colour_is_not_reported_as_media(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-a", "deck-1", 1, "[]", "ffffff")],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_references_missing_file_rows, 0)
        self.assertEqual(result.issues, [])

    def test_a_hash_prefixed_colour_is_still_not_reported_as_media(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-a", "deck-1", 1, "[]", "#ffffff")],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_references_missing_file_rows, 0)
        self.assertEqual(result.issues, [])

    def test_a_ten_character_hex_reference_is_not_treated_as_a_colour(self):
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-a", "deck-1", 1, json.dumps([{"src": "abcdef1234"}]))],
            users={"Administrator": True},
        )
        env, _ = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_references_missing_file_rows, 1)
        self.assertEqual(result.issues_total, 1)

    def test_a_second_slides_run_clears_only_its_own_evidence(self):
        """The three phases share one record, so a rerun may drop only its rows."""
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[consumer, template],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": template_url}]))],
            media=[media("template-file", deck_name=template.name, url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        seeded = env.state.content()
        seeded.record_issue("Sheet:sheet-1", "history said no", phase="history")
        env.state.put_content(seeded)

        convert_slides_and_templates(env)
        result = convert_slides_and_templates(env)

        self.assertEqual(result.issues_by_phase, {"history": 1, "slides": 1})
        self.assertEqual(result.issues_total, 2)
        self.assertEqual([issue.phase for issue in result.issues], ["history", "slides"])

    # -- defect 6: a borrowed background

    def test_a_borrowed_background_resolves_to_the_adopted_node(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-back.png"
        source = FakeContent(
            documents=[consumer, template],
            slides=[SlideRow("slide-a", consumer.name, 1, "[]", template_url)],
            media=[media("template-file", deck_name=template.name, blob="blob-a", url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        convert_slides_and_templates(env)

        adopted = self.media_children(target, consumer.node)
        self.assertEqual(len(adopted), 1)
        self.assertEqual(source.slide_rows["slide-a"].background, adopted[0]["name"])

    # -- defect 7: a blob with no MIME type

    def test_a_placeholder_upgraded_from_a_blob_without_a_mime_reruns(self):
        row = media("media-a")
        source = FakeContent(
            documents=[deck()],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        convert_slides_and_templates(env)

        source.media_rows[0] = replace(row, blob="blob-1")
        target.add_blob("blob-1", b"media", mime_type="")
        convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["media-a"]["mime"], "application/octet-stream")
        result = convert_slides_and_templates(env)
        self.assertEqual(result.media_nodes_created, 1)

    # -- defect 8: a decompression bomb reaches neither handler

    def test_a_decompression_bomb_thumbnail_refuses_the_deck(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", png_declaring(100_000, 100_000), mime_type="image/png")

        with self.assertRaisesRegex(BuildSlidesError, "unreadable"):
            convert_slides_and_templates(env)

    def test_a_thumbnail_above_the_pixel_ceiling_refuses_the_deck(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", png_declaring(6000, 5000), mime_type="image/png")

        with self.assertRaisesRegex(BuildSlidesError, "oversized"):
            convert_slides_and_templates(env)

    # -- defect 9: a journal conflict is a RuntimeError, not a ValueError

    def test_a_journal_conflict_records_an_issue_and_raises_build_slides_error(self):
        body = json.dumps([{"src": "/files/media-a.png"}])
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, body)],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        # A previous transition whose `after` is not the current body: the site
        # journal answers that with `JournalConflictError`.
        env.slide_journal.records.append(
            ("deck-1", "slide-1", SlideBody("[]", None), SlideBody("[]", None), 0, STAMP)
        )

        with self.assertRaises(BuildSlidesError):
            convert_slides_and_templates(env)

        self.assertEqual(env.state.content().issues_total, 1)
        self.assertEqual(source.slide_rows["slide-1"].elements, body)

    # -- defect 10: counters come from the mapping, not from a recount

    def test_a_pre_existing_deck_child_is_not_counted_as_created_media(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("stray-blob", b"stray", mime_type="image/png")
        for name, blob in (("stray-file", "stray-blob"), ("stray-empty", None)):
            target.node_rows[name] = {
                "name": name,
                "parent": "deck-node",
                "root": "root",
                "path": "/deck-node/",
                "kind": "file",
                "blob": blob,
            }

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_nodes_created, 1)
        self.assertEqual(result.blobless_nodes, 0)
        again = convert_slides_and_templates(env)
        self.assertEqual((again.media_nodes_created, again.blobless_nodes), (1, 0))

    # -- defect 11: media inserts respect the batch ceiling

    def test_media_nodes_insert_in_batches_at_the_commit_ceiling(self):
        rows = [media(f"media-{index}", blob=f"blob-{index}") for index in range(5)]
        source = FakeContent(documents=[deck()], media=rows, users={"Administrator": True})
        env, target = self.environment(source)
        for row in rows:
            target.add_blob(row.blob, row.blob.encode(), mime_type="image/png")
        sizes = []
        insert_nodes = target.insert_nodes

        def record(planned):
            media_rows = [row for row in planned if row.get("parent") == "deck-node"]
            if media_rows:
                sizes.append(len(media_rows))
            insert_nodes(planned)

        target.insert_nodes = record

        convert_slides_and_templates(env, batch_size=2)

        self.assertEqual(sizes, [2, 2, 1])

    # -- preview conversion

    def test_a_large_private_webp_is_reencoded_instead_of_reused(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes((800, 600)), mime_type="image/webp")

        convert_slides_and_templates(env)

        self.assertNotEqual(target.preview_rows["deck-node"]["blob"], "thumb-blob")
        self.assertEqual(preview_size(target), (512, 384))

    def test_an_oversized_png_thumbnail_is_scaled_to_512(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", image_bytes("PNG", (1024, 768)), mime_type="image/png")

        convert_slides_and_templates(env)

        self.assertEqual(preview_size(target), (512, 384))

    def test_a_jpeg_thumbnail_keeps_its_exif_orientation(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.jpg", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", rotated_jpeg((40, 20)), mime_type="image/jpeg")

        convert_slides_and_templates(env)

        # Orientation 6 is a quarter turn, so the stored 40x20 is displayed 20x40.
        self.assertEqual(preview_size(target), (20, 40))

    def test_png_and_jpeg_thumbnails_become_private_webp_previews(self):
        for suffix, fmt, mime in (("png", "PNG", "image/png"), ("jpg", "JPEG", "image/jpeg")):
            with self.subTest(format=fmt):
                row = media("thumb", blob="thumb-blob", url=f"/files/thumb.{suffix}", field="thumbnail")
                source = FakeContent(
                    documents=[deck(thumbnail=row.file_url)],
                    media=[row],
                    users={"Administrator": True},
                )
                env, target = self.environment(source)
                target.add_blob("thumb-blob", image_bytes(fmt, (64, 48)), mime_type=mime)

                convert_slides_and_templates(env)

                preview_blob = target.blob_rows[target.preview_rows["deck-node"]["blob"]]
                self.assertEqual(preview_blob.mime_type, "image/webp")
                self.assertEqual(preview_blob.is_private, 1)
                self.assertEqual(preview_size(target), (64, 48))
                self.assertEqual(target.blob_bytes["thumb-blob"], image_bytes(fmt, (64, 48)))

    def test_a_truncated_thumbnail_refuses_the_deck(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        # A whole header and half the pixels: the probe passes, the decode does not.
        target.add_blob("thumb-blob", image_bytes("PNG", (256, 256))[:-120], mime_type="image/png")

        with self.assertRaisesRegex(BuildSlidesError, "unreadable"):
            convert_slides_and_templates(env)
        self.assertFalse(target.preview_rows)

    def test_a_corrupt_thumbnail_refuses_the_deck(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", b"not an image at all", mime_type="image/png")

        with self.assertRaisesRegex(BuildSlidesError, "unreadable"):
            convert_slides_and_templates(env)
        self.assertFalse(target.preview_rows)

    # -- thumbnail classification

    def test_a_canonical_url_match_selects_the_thumbnail(self):
        row = media("thumb", blob="thumb-blob", url="/files/a%20cover.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail="/files/a cover.webp")],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.deck_previews_created, 1)
        self.assertEqual(target.preview_rows["deck-node"]["name"], "thumb")

    def test_two_blobs_in_the_winning_thumbnail_tier_refuse_the_deck(self):
        url = "/files/cover.webp"
        source = FakeContent(
            documents=[deck(thumbnail=url)],
            media=[
                media("thumb-a", blob="blob-a", url=url),
                media("thumb-b", blob="blob-b", url=url),
            ],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", webp_bytes(), mime_type="image/webp")
        target.add_blob("blob-b", webp_bytes((16, 16)), mime_type="image/webp")

        with self.assertRaisesRegex(BuildSlidesError, "ambiguous"):
            convert_slides_and_templates(env)

    def test_a_stale_thumbnail_marker_stays_ordinary_media(self):
        chosen = media("thumb", blob="thumb-blob", url="/files/cover.webp")
        stale = media("stale", blob="stale-blob", url="/files/old.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=chosen.file_url)],
            media=[chosen, stale],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")
        target.add_blob("stale-blob", webp_bytes((16, 16)), mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(target.preview_rows["deck-node"]["name"], "thumb")
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["stale"])
        self.assertEqual(result.media_nodes_created, 1)

    def test_an_unmatched_local_thumbnail_keeps_the_deck_and_its_media(self):
        source = FakeContent(
            documents=[deck(thumbnail="/files/gone.webp")],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        result = convert_slides_and_templates(env)

        # A preview is derived data. Refusing the deck, its media, and every
        # deck after it over one missing File row costs more than the preview.
        self.assertTrue(result.slides_completed)
        self.assertEqual(result.deck_previews_created, 0)
        self.assertEqual(target.preview_rows, {})
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["media-a"])
        self.assertEqual(
            [issue.reason for issue in result.issues if "matches no File row" in issue.reason],
            ["thumbnail '/files/gone.webp' matches no File row; no preview was built"],
        )

    def test_an_asset_thumbnail_creates_no_preview(self):
        source = FakeContent(
            documents=[deck(thumbnail="/assets/suite/cover.png")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)

        result = convert_slides_and_templates(env)

        self.assertEqual(result.deck_previews_created, 0)
        self.assertFalse(target.preview_rows)

    # -- exact rerun validation

    def test_a_changed_media_node_refuses_on_rerun(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        convert_slides_and_templates(env)

        target.node_rows["media-a"]["title"] = "renamed.png"

        with self.assertRaisesRegex(BuildSlidesError, "media node media-a"):
            convert_slides_and_templates(env)

    def test_a_changed_preview_refuses_on_rerun(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")
        convert_slides_and_templates(env)

        target.preview_rows["deck-node"]["name"] = "someone-else"

        with self.assertRaisesRegex(BuildSlidesError, "preview thumb"):
            convert_slides_and_templates(env)

    def test_a_stored_preview_is_accepted_without_re_encoding(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.png", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", image_bytes("PNG", (64, 48)), mime_type="image/png")
        result = convert_slides_and_templates(env)
        stored = dict(target.preview_rows["deck-node"])
        self.assertEqual(result.deck_previews_created, 1)

        # `put_private_blob` is content addressed. A new encoder renames the
        # blob, and the stored row must still validate.
        calls = []

        def reencode(data, filename):
            calls.append(filename)
            return target.add_blob(f"renamed-{len(calls)}", data + b"x", mime_type="image/webp")

        target.put_private_blob = reencode

        again = convert_slides_and_templates(env)

        self.assertEqual(calls, [])
        self.assertEqual(again.deck_previews_created, 1)
        self.assertEqual(target.preview_rows["deck-node"], stored)

    def test_a_stored_preview_with_a_public_blob_refuses(self):
        row = media("thumb", blob="thumb-blob", url="/files/thumb.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("thumb-blob", webp_bytes(), mime_type="image/webp")
        convert_slides_and_templates(env)
        target.add_blob("public-blob", webp_bytes((16, 16)), mime_type="image/webp", is_private=0)

        target.preview_rows["deck-node"]["blob"] = "public-blob"

        with self.assertRaisesRegex(BuildSlidesError, "preview blob is invalid"):
            convert_slides_and_templates(env)

    # -- defect 12: a borrowed reference is looked up through its spellings

    def test_a_site_absolute_reference_borrows_a_relative_template_file(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        source = FakeContent(
            documents=[template, consumer],
            slides=[
                SlideRow(
                    "slide-a",
                    consumer.name,
                    1,
                    json.dumps([{"src": "https://site.example/private/files/logo.png"}]),
                )
            ],
            media=[
                media(
                    "template-file",
                    deck_name=template.name,
                    blob="blob-a",
                    url="/private/files/logo.png",
                )
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        result = convert_slides_and_templates(env)

        adopted = self.media_children(target, consumer.node)
        self.assertEqual(len(adopted), 1)
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": adopted[0]["name"]}])
        # The adopted node and the template deck's own node for the same File.
        self.assertEqual(result.media_nodes_created, 2)
        self.assertEqual(result.issues_total, 0)

    def test_a_relative_reference_borrows_a_site_absolute_template_file(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        source = FakeContent(
            documents=[template, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": "/private/files/logo.png"}]))],
            media=[
                media(
                    "template-file",
                    deck_name=template.name,
                    blob="blob-a",
                    url="https://site.example/private/files/logo.png",
                )
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        result = convert_slides_and_templates(env)

        adopted = self.media_children(target, consumer.node)
        self.assertEqual(len(adopted), 1)
        self.assertEqual(json.loads(source.slide_rows["slide-a"].elements), [{"src": adopted[0]["name"]}])
        # The adopted node and the template deck's own node for the same File.
        self.assertEqual(result.media_nodes_created, 2)
        self.assertEqual(result.issues_total, 0)

    def test_a_site_absolute_reference_to_a_non_template_file_is_reported(self):
        other = deck("other", node="other-node", title="Other")
        source = FakeContent(
            documents=[deck(), other],
            slides=[
                SlideRow(
                    "slide-1",
                    "deck-1",
                    1,
                    json.dumps([{"src": "https://site.example/private/files/pasted.png"}]),
                ),
                SlideRow("slide-2", other.name, 1, json.dumps([])),
            ],
            media=[media("other-file", deck_name=other.name, blob="blob-a", url="/private/files/pasted.png")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        self.document_node(target, other.node, other.name, other.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(self.media_children(target, "deck-node"), [])
        self.assertEqual(result.issues_total, 1)
        self.assertEqual(result.issues[0].source, "Presentation:deck-1")
        self.assertIn("non-template", result.issues[0].reason)

    # -- defect 13: one File is both the deck preview and slide media

    def test_a_thumbnail_a_slide_uses_is_also_a_media_child(self):
        row = media("cover", blob="cover-blob", url="/files/cover.webp", field="thumbnail")
        source = FakeContent(
            documents=[deck(thumbnail=row.file_url)],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": "/files/cover.webp"}]))],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("cover-blob", webp_bytes(), mime_type="image/webp")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.deck_previews_created, 1)
        self.assertEqual(target.preview_rows["deck-node"]["name"], "cover")
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["cover"])
        self.assertEqual(result.media_nodes_created, 1)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements), [{"src": "cover"}])
        self.assertEqual(result.issues_total, 0)

        again = convert_slides_and_templates(env)
        self.assertEqual((again.media_nodes_created, again.deck_previews_created), (1, 1))
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["cover"])

    # -- defect 14: an identical rerun reports the same media count

    def test_a_borrowed_node_still_counts_on_an_identical_rerun(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[template, consumer],
            slides=[
                SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": template_url}])),
            ],
            media=[
                media("template-file", deck_name=template.name, blob="blob-a", url=template_url),
                media("own-file", deck_name=consumer.name, blob="blob-b", url="/files/own.png"),
            ],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        target.add_blob("blob-b", b"b", mime_type="image/png")

        first = convert_slides_and_templates(env)
        children = self.media_children(target, consumer.node)
        second = convert_slides_and_templates(env)

        self.assertEqual(first.media_nodes_created, 3)
        self.assertEqual(second.media_nodes_created, first.media_nodes_created)
        self.assertEqual(self.media_children(target, consumer.node), children)

    # -- defect 15: a media File the tree also filed keeps its node, under the deck

    def test_a_media_node_the_tree_filed_elsewhere_moves_under_the_deck(self):
        row = media("media-a", blob="blob-a")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": row.file_url}]))],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        self.tree_node(target, "media-a", "root", blob="blob-a", size=1, mime="image/png")

        result = convert_slides_and_templates(env)

        stored = target.node_rows["media-a"]
        self.assertEqual(
            (stored["parent"], stored["root"], stored["path"]), ("deck-node", "root", "/deck-node/")
        )
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["media-a"])
        self.assertEqual(result.media_nodes_created, 1)
        self.assertEqual(json.loads(source.slide_rows["slide-1"].elements)[0]["src"], "media-a")

    def test_the_move_is_counted_and_listed_and_survives_the_state_file(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        self.tree_node(target, "media-a", "personal-root", blob="blob-a", size=1, mime="image/png")

        result = convert_slides_and_templates(env)

        self.assertEqual(result.media_nodes_relocated, 1)
        self.assertEqual(
            [(row.deck, row.node, row.was_under) for row in result.relocated_media_nodes],
            [("deck-1", "media-a", "personal-root")],
        )
        # The report reads the record back out of the state file, so the
        # count and the list have to survive the round trip.
        stored = env.state.content()
        self.assertEqual(stored.media_nodes_relocated, 1)
        self.assertEqual(stored.relocated_media_nodes[0].was_under, "personal-root")

    def test_the_moved_node_drops_the_dedup_suffix_it_earned_in_the_old_folder(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        # §14.4 deduplicated against the personal root's sibling group. Under
        # the deck the plain title is free, and the plan claims it.
        self.tree_node(
            target, "media-a", "root", title="media-a (2).png", blob="blob-a", size=1, mime="image/png"
        )

        convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["media-a"]["title"], "media-a.png")

    def test_the_moved_node_takes_its_size_and_mime_from_the_blob(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"media bytes", mime_type="image/png")
        # §14.4 copied `File.file_size` and `File.mime_type`. §14.7 reads the
        # blob, which is what §10 charges and what the bytes actually are.
        self.tree_node(target, "media-a", "root", blob="blob-a", size=3, mime="image/heic")

        convert_slides_and_templates(env)

        stored = target.node_rows["media-a"]
        self.assertEqual((stored["size"], stored["mime"]), (len(b"media bytes"), "image/png"))

    def test_a_trashed_tree_node_becomes_an_active_child_of_the_deck(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        # Step 8 reads media without a status filter, so every other Trashed
        # media File becomes an Active media node. A Trashed one here would
        # be purged out from under a deck that still draws it.
        self.tree_node(
            target,
            "media-a",
            "root",
            blob="blob-a",
            size=1,
            mime="image/png",
            state="Trashed",
            trashed_at=STAMP,
            trash_root="media-a",
        )

        convert_slides_and_templates(env)

        stored = target.node_rows["media-a"]
        self.assertEqual(stored["state"], "Active")
        self.assertEqual((stored["trashed_at"], stored["trash_root"]), (None, None))
        self.assertEqual(stored["parent"], "deck-node")

    def test_a_second_run_moves_nothing_and_refuses_nothing(self):
        row = media("media-a", blob="blob-a")
        source = FakeContent(
            documents=[deck()],
            slides=[SlideRow("slide-1", "deck-1", 1, json.dumps([{"src": row.file_url}]))],
            media=[row],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        self.tree_node(target, "media-a", "root", blob="blob-a", size=1, mime="image/png")

        first = convert_slides_and_templates(env)
        placed = dict(target.node_rows["media-a"])
        second = convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["media-a"], placed)
        self.assertEqual(second.media_nodes_created, first.media_nodes_created)
        # The move happened once, so a later pass has nothing to move and the
        # count is cumulative rather than recomputed. `begin_phase` leaves it.
        self.assertEqual((first.media_nodes_relocated, second.media_nodes_relocated), (1, 1))
        self.assertEqual(len(second.relocated_media_nodes), 1)

    def test_a_stray_node_is_left_alone_when_the_deck_already_holds_the_blob(self):
        source = FakeContent(
            documents=[deck()],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        self.tree_node(target, "media-a", "root", blob="blob-a", size=1, mime="image/png")
        # A run that minted the node under another id got there first. Moving
        # `media-a` in as well would be the duplicate `_media_mapping` refuses.
        self.tree_node(
            target,
            "earlier",
            "deck-node",
            title="media-a.png",
            root="root",
            path="/deck-node/",
            blob="blob-a",
            size=1,
            mime="image/png",
        )

        result = convert_slides_and_templates(env)

        self.assertEqual(target.node_rows["media-a"]["parent"], "root")
        self.assertEqual(result.media_nodes_relocated, 0)
        self.assertEqual([row["name"] for row in self.media_children(target, "deck-node")], ["earlier"])

    def test_a_second_deck_copies_the_node_it_cannot_move(self):
        template = deck("template", node=None, title="Template", is_template=1)
        consumer = deck("consumer", node="consumer-node", title="Consumer")
        template_url = "/private/files/template-logo.png"
        source = FakeContent(
            documents=[template, consumer],
            slides=[SlideRow("slide-a", consumer.name, 1, json.dumps([{"src": template_url}]))],
            media=[media("template-file", deck_name=template.name, blob="blob-a", url=template_url)],
            users={"Administrator": True, OWNER: True},
        )
        env, target = self.environment(source)
        self.document_node(target, consumer.node, consumer.name, consumer.title)
        target.add_blob("blob-a", b"a", mime_type="image/png")
        self.tree_node(target, "template-file", "root", blob="blob-a", size=1, mime="image/png")

        result = convert_slides_and_templates(env)

        # [012] §4: the deck the File belongs to keeps the node, and the deck
        # that pasted it gets a copy under a new id, the same blob.
        template_node = target.node_rows["template-file"]["parent"]
        self.assertEqual(target.node_rows[template_node]["content_docname"], "template")
        copies = self.media_children(target, consumer.node)
        self.assertEqual([row["blob"] for row in copies], ["blob-a"])
        self.assertNotEqual(copies[0]["name"], "template-file")
        self.assertEqual(result.media_nodes_relocated, 1)

        second = convert_slides_and_templates(env)
        self.assertEqual(self.media_children(target, consumer.node), copies)
        self.assertEqual(second.media_nodes_relocated, 1)


if __name__ == "__main__":
    unittest.main()
