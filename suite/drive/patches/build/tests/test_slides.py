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


if __name__ == "__main__":
    unittest.main()
