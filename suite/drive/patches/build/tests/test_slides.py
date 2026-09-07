"""Slides media, preview, body rewrite, and rerun behavior."""

import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from PIL import Image

from suite.drive.patches.build.ports import ContentRow, MediaFileRow, SlideRow
from suite.drive.patches.build.slides import BuildSlidesError, convert_slides_and_templates
from suite.drive.patches.build.tests.fakes import FakeContent, FakeContentTarget, build_environment

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


def media(name, *, blob=None, url=None, field=None):
    return MediaFileRow(
        name=name,
        deck="deck-1",
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
        target.node_rows["deck-node"] = {
            "name": "deck-node",
            "title": "Deck",
            "parent": "root",
            "root": "root",
            "path": "",
            "kind": "document",
            "content_doctype": "Presentation",
            "content_docname": "deck-1",
        }
        return env, target

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


if __name__ == "__main__":
    unittest.main()
