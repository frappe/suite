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

from suite.drive.patches.build.ports import ContentRow, MediaFileRow, SlideRow
from suite.drive.patches.build.slide_journal import SlideBody
from suite.drive.patches.build.slides import BuildSlidesError, convert_slides_and_templates
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

    def media_children(self, target, node):
        return [row for row in target.child_nodes(node) if row.get("kind") == "file"]

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

    def test_an_unmatched_local_thumbnail_refuses_the_deck(self):
        source = FakeContent(
            documents=[deck(thumbnail="/files/gone.webp")],
            media=[media("media-a", blob="blob-a")],
            users={"Administrator": True},
        )
        env, target = self.environment(source)
        target.add_blob("blob-a", b"a", mime_type="image/png")

        with self.assertRaisesRegex(BuildSlidesError, "unmatched"):
            convert_slides_and_templates(env)

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


if __name__ == "__main__":
    unittest.main()
