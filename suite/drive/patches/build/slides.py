"""Convert Slides media, previews, and body references."""

import io
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import replace
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps

from suite.drive.patches.build.content_mapping import InvalidLegacyContent, exact_fields, standard_fields
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.history import _document_node
from suite.drive.patches.build.slide_journal import SlideBody
from suite.drive.patches.build.templates import convert_templates
from suite.drive.utils.files import S3_URL_PREFIX

MAX_IMAGE_PIXELS = 25_000_000
MEDIA_KEYS = ("src", "poster")
NODE_FIELDS = (
    "name",
    "title",
    "parent",
    "root",
    "path",
    "kind",
    "blob",
    "size",
    "mime",
    "state",
    "content_modified",
    "owner",
    "creation",
    "modified",
    "modified_by",
)


class BuildSlidesError(RuntimeError):
    """A deck cannot be converted without guessing."""


def convert_slides_and_templates(env, *, batch_size: int = BUILD_BATCH_SIZE):
    """Implement §14.2 step 8 without deleting any source row or blob."""
    if not env.state.tree().completed or not env.state.grants().completed:
        raise BuildSlidesError("ticket 27 tree and grants must complete first")
    source, target = _ports(env)
    if env.slide_journal is None:
        raise RuntimeError("Build has no Slide preimage journal")
    result = env.state.content()
    result.slides_completed = False
    result.media_nodes_created = 0
    result.media_duplicates_collapsed = 0
    result.slide_elements_rewritten = 0
    result.deck_previews_created = 0
    result.blobless_nodes = 0
    result.slides_deferred = 0

    try:
        convert_templates(env, batch_size=batch_size)
        after = ""
        while True:
            decks = source.documents("Presentation", after, batch_size)
            if not decks:
                break
            for deck in decks:
                node = _document_node(source, target, deck)
                if node is None:
                    result.slides_deferred += 1
                    continue
                deck = replace(deck, node=node)
                counts = _convert_deck(env, deck, batch_size, result)
                result.media_nodes_created += counts[0]
                result.media_duplicates_collapsed += counts[1]
                result.deck_previews_created += counts[2]
                result.slide_elements_rewritten += counts[3]
                result.blobless_nodes += counts[4]
                env.state.put_content(result)
            after = decks[-1].name
            if len(decks) < batch_size:
                break
        result.slides_completed = result.slides_deferred == 0
        result.completed = result.history_completed and result.links_completed and result.slides_completed
        env.state.put_content(result)
        return result
    except (InvalidLegacyContent, ValueError, OSError) as error:
        result.record_issue("slides", str(error))
        env.state.put_content(result)
        raise BuildSlidesError(str(error)) from error


def _convert_deck(env, deck, batch_size, result):
    target = env.content_target
    deck_node = target.nodes((deck.node,)).get(deck.node)
    if not deck_node or deck_node.get("kind") != "document":
        raise InvalidLegacyContent(f"Presentation {deck.name} has no document node")
    slides = env.content.slides(deck.name)
    parsed = {slide.name: _parse_elements(slide) for slide in slides}
    files = sorted(env.content.media_files(deck.name), key=lambda row: (str(row.creation or ""), row.name))
    thumbnail, excluded = _thumbnail_file(deck, files)
    media = [row for row in files if row.name not in excluded]
    mapping, created, collapsed, blobless = _media_mapping(env, deck, deck_node, media)
    local_mapping = dict(mapping)
    borrowed, borrowed_created = _borrowed_mapping(env, deck, deck_node, parsed, mapping, result)
    mapping.update(borrowed)
    created += borrowed_created
    preview_created = _preview(env, deck, thumbnail)
    target.commit()
    retained = target.child_nodes(deck_node["name"])
    created = sum(row.get("kind") == "file" and bool(row.get("blob")) for row in retained)
    blobless = sum(row.get("kind") == "file" and not row.get("blob") for row in retained)

    updates = []
    for slide in slides:
        before = SlideBody(slide.elements, slide.background)
        elements, changed, disagreements = _rewrite_elements(parsed[slide.name], mapping, local_mapping)
        background, _ = _rewrite_value(slide.background, mapping)
        after = SlideBody(_dump(elements), background)
        if disagreements:
            result.record_issue(
                f"Slide:{slide.name}",
                f"{disagreements} attachmentName value(s) disagreed with src; src won",
            )
        if after == before:
            continue
        env.slide_journal.append(
            presentation=deck.name,
            slide=slide.name,
            before=before,
            after=after,
            changed_elements=changed,
            created_at=env.now(),
        )
        updates.append({"name": slide.name, "elements": after.elements, "background": after.background})
        if len(updates) >= batch_size:
            target.update_slides(updates)
            target.commit()
            updates = []
    if updates:
        target.update_slides(updates)
        target.commit()
    current = {
        row.name: SlideBody(
            next((item["elements"] for item in updates if item["name"] == row.name), row.elements),
            next((item["background"] for item in updates if item["name"] == row.name), row.background),
        )
        for row in slides
    }
    # The target port mutates fakes and SQL immediately. Rebuild planned values
    # so recovery also covers a crash after SQL and before the state write.
    for row in slides:
        elements, _, _ = _rewrite_elements(parsed[row.name], mapping, local_mapping)
        background, _ = _rewrite_value(row.background, mapping)
        current[row.name] = SlideBody(_dump(elements), background)
    rewritten = env.slide_journal.recover_changed_elements(deck.name, current)
    return created, collapsed, preview_created, rewritten, blobless


def _parse_elements(slide):
    try:
        value = json.loads(slide.elements) if slide.elements else []
    except (TypeError, ValueError) as error:
        raise InvalidLegacyContent(f"Slide {slide.name} elements are not JSON") from error
    if not isinstance(value, list):
        raise InvalidLegacyContent(f"Slide {slide.name} elements are not a list")
    return [item for item in value if isinstance(item, dict)]


def _media_mapping(env, deck, parent, files):
    target = env.content_target
    groups = defaultdict(list)
    for row in files:
        groups[("blob", row.blob) if row.blob else ("file", row.name)].append(row)
    mapping = {}
    created = 0
    collapsed = 0
    blobless = 0
    children = target.child_nodes(parent["name"])
    for _key, rows in sorted(groups.items(), key=lambda item: (str(item[0]), item[1][0].name)):
        rows.sort(key=lambda row: (str(row.creation or ""), row.name))
        source = rows[0]
        if source.blob:
            collapsed += len(rows) - 1
            blob = _ready_blob(target, source.blob)
            matches = [
                row for row in children if row.get("kind") == "file" and row.get("blob") == source.blob
            ]
            if len(matches) > 1:
                raise InvalidLegacyContent(f"Presentation {deck.name} has duplicate media nodes")
            source_node = target.nodes((source.name,)).get(source.name)
            if source_node and not source_node.get("blob"):
                if matches and matches[0]["name"] != source.name:
                    raise InvalidLegacyContent(f"media placeholder {source.name} conflicts with a blob node")
                placeholder = _media_node(source, parent, source.name, None)
                exact_fields(source_node, placeholder, NODE_FIELDS, f"media placeholder {source.name}")
                target.update_media_node(source.name, blob.name, int(blob.file_size), blob.mime_type)
                name = source.name
            else:
                name = matches[0]["name"] if matches else source.name
            planned = _media_node(source, parent, name, blob)
            found = target.nodes((name,)).get(name)
            if found and found.get("blob"):
                exact_fields(found, planned, NODE_FIELDS, f"media node {name}")
            elif not found:
                target.insert_nodes([planned])
                children.append(planned)
            created += 1
            for row in rows:
                for alias in _aliases(row):
                    _bind(mapping, alias, name)
        else:
            blobless += 1
            planned = _media_node(source, parent, source.name, None)
            found = target.nodes((source.name,)).get(source.name)
            if found:
                exact_fields(found, planned, NODE_FIELDS, f"blobless media node {source.name}")
            else:
                target.insert_nodes([planned])
                children.append(planned)
    return mapping, created, collapsed, blobless


def _borrowed_mapping(env, deck, parent, parsed, local, result):
    references = set()
    for elements in parsed.values():
        for element in elements:
            for key in MEDIA_KEYS:
                references |= _strings(element.get(key))
    unresolved = tuple(
        sorted(value for value in references if value not in local and not _never_media(value))
    )
    lookup = set(unresolved)
    for value in unresolved:
        lookup |= _path_variants(value)
    candidates = env.content.media_files_by_urls(tuple(sorted(lookup)))
    by_url = defaultdict(list)
    for row in candidates:
        if row.deck != deck.name and env.content.presentation_is_template(row.deck):
            for alias in _aliases(row):
                by_url[alias].append(row)
    mapping = {}
    created = 0
    children = env.content_target.child_nodes(parent["name"])
    for value in unresolved:
        rows = by_url.get(value, [])
        if not rows:
            # A non-template global File cannot be adopted: Build cannot
            # reconstruct the original paste actor's access.
            if any(row.deck != deck.name and value in _aliases(row) for row in candidates):
                result.record_issue(
                    f"Presentation:{deck.name}",
                    f"media reference {value!r} belongs to a non-template Presentation and was not adopted",
                )
            continue
        blobs = {row.blob for row in rows if row.blob and env.content_target.blob(row.blob)}
        if len(blobs) != 1:
            raise InvalidLegacyContent(f"borrowed media {value!r} is ambiguous")
        blob_name = next(iter(blobs))
        blob = _ready_blob(env.content_target, blob_name)
        matches = [row for row in children if row.get("kind") == "file" and row.get("blob") == blob_name]
        if len(matches) > 1:
            raise InvalidLegacyContent(f"Presentation {deck.name} has duplicate borrowed media")
        if matches:
            name = matches[0]["name"]
        else:
            source = min(rows, key=lambda row: (str(row.creation or ""), row.name))
            name = env.new_id()
            planned = _media_node(source, parent, name, blob)
            planned.update(
                owner=deck.owner,
                modified_by=deck.modified_by or deck.owner,
                content_modified=source.file_modified or source.modified,
            )
            env.content_target.insert_nodes([planned])
            children.append(planned)
        created += 1
        mapping[value] = name
    return mapping, created


def _media_node(row, parent, name, blob):
    return {
        "name": name,
        "title": row.file_name or row.name,
        "parent": parent["name"],
        "root": parent["root"],
        "path": f"{parent['path'] or ''}{parent['name']}/",
        "kind": "file",
        "blob": blob.name if blob else None,
        "size": int(blob.file_size) if blob else 0,
        "mime": (blob.mime_type or "application/octet-stream") if blob else None,
        "url": None,
        "content_doctype": None,
        "content_docname": None,
        "state": "Active",
        "trashed_at": None,
        "trash_root": None,
        "content_modified": row.file_modified or row.modified,
        "is_template": 0,
        **standard_fields(row),
    }


def _thumbnail_file(deck, files):
    value = deck.thumbnail
    if not value or _never_media(value):
        return None, set()
    exact = [row for row in files if row.file_url == value]
    canonical = [row for row in files if _canonical(row.file_url) == _canonical(value)]
    tier = exact or canonical
    if not tier:
        raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is unmatched")
    marked = [row for row in tier if row.attached_to_field == "thumbnail"]
    winning = marked or tier
    blobs = {row.blob for row in winning}
    if len(blobs) != 1 or None in blobs:
        raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is ambiguous or blobless")
    chosen = min(winning, key=lambda row: (str(row.creation or ""), row.name))
    return chosen, {row.name for row in files if row.blob == chosen.blob and row in tier}


def _preview(env, deck, source):
    if source is None:
        return 0
    target = env.content_target
    blob = _ready_blob(target, source.blob)
    raw = target.read_blob(blob.name)
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is oversized")
            image.load()
            image = ImageOps.exif_transpose(image)
            reusable = bool(blob.is_private and blob.mime_type == "image/webp" and max(image.size) <= 512)
            if reusable:
                preview_blob = blob
            else:
                image.thumbnail((512, 512))
                output = io.BytesIO()
                image.convert("RGB").save(output, "WEBP")
                preview_blob = target.put_private_blob(output.getvalue(), f"{source.name}.webp")
    except (Image.UnidentifiedImageError, OSError) as error:
        raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is unreadable") from error
    if (
        not preview_blob
        or preview_blob.status != "Ready"
        or not preview_blob.is_private
        or preview_blob.mime_type != "image/webp"
    ):
        raise InvalidLegacyContent(f"Presentation {deck.name} preview blob is invalid")
    planned = {
        "name": source.name,
        "node": deck.node,
        "source_blob": None,
        "blob": preview_blob.name,
        **standard_fields(source),
    }
    found = target.preview(deck.node)
    if found:
        exact_fields(found, planned, tuple(planned), f"preview {source.name}")
        return 1
    target.insert_previews([planned])
    return 1


def _strings(value):
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        found = set()
        for nested in value.values():
            found |= _strings(nested)
        return found
    if isinstance(value, list):
        found = set()
        for nested in value:
            found |= _strings(nested)
        return found
    return set()


def _ready_blob(target, name):
    blob = target.blob(name)
    if not blob or blob.status != "Ready":
        raise InvalidLegacyContent(f"blob {name} is not Ready")
    return blob


def _aliases(row):
    values = {row.name, row.file_url, unquote(row.file_url or "")}
    parsed = urlsplit(row.file_url or "")
    if not parsed.netloc:
        values |= {_canonical(row.file_url), unquote(_canonical(row.file_url))}
    for value in tuple(values):
        if value.startswith("/files/"):
            values.add("/private" + value)
        elif value.startswith("/private/files/"):
            values.add(value.removeprefix("/private"))
    return {value for value in values if value}


def _path_variants(value):
    values = {value, unquote(value), _canonical(value)}
    for item in tuple(values):
        if item.startswith("/files/"):
            values.add("/private" + item)
        elif item.startswith("/private/files/"):
            values.add(item.removeprefix("/private"))
    return {item for item in values if item}


def _canonical(value):
    parsed = urlsplit(value or "")
    return unquote(parsed.path or value or "")


def _never_media(value):
    """A colour, data URL, bundled asset, or remote URL is never deck media."""
    text = str(value or "")
    return text.startswith(("data:", "/assets/", "#")) or bool(urlsplit(text).netloc)


def _local_legacy_url(value):
    text = str(value or "")
    return not urlsplit(text).netloc and text.startswith(("/files/", "/private/files/", S3_URL_PREFIX))


def _bind(mapping, alias, node):
    if alias in mapping and mapping[alias] != node:
        raise InvalidLegacyContent(f"media alias {alias!r} resolves to different blobs")
    mapping[alias] = node


def _rewrite_elements(elements, mapping, local_mapping):
    output = []
    changed = 0
    disagreements = 0
    for source in elements:
        item = deepcopy(source)
        item_changed = "attachmentName" in item
        attachment = item.pop("attachmentName", None)
        for key in MEDIA_KEYS:
            if key in item:
                item[key], nested = _rewrite_value(item[key], mapping)
                item_changed |= nested
        source_src = source.get("src")
        if isinstance(source_src, str) and isinstance(attachment, str):
            resolved = None if _never_media(source_src) else mapping.get(source_src)
            fallback = local_mapping.get(attachment)
            if resolved and fallback and resolved != fallback:
                disagreements += 1
            elif not resolved and fallback and _local_legacy_url(source_src):
                item["src"] = fallback
                item_changed = True
        changed += int(item_changed)
        output.append(item)
    return output, changed, disagreements


def _rewrite_value(value, mapping):
    if isinstance(value, str):
        if _never_media(value):
            return value, False
        return (mapping[value], True) if value in mapping else (value, False)
    changed = False
    if isinstance(value, dict):
        output = {}
        for key, nested in value.items():
            output[key], one = _rewrite_value(nested, mapping)
            changed |= one
        return output, changed
    if isinstance(value, list):
        output = []
        for nested in value:
            item, one = _rewrite_value(nested, mapping)
            output.append(item)
            changed |= one
        return output, changed
    return value, False


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _ports(env):
    if env.content is None or env.content_target is None:
        raise RuntimeError("Build content ports are not configured")
    return env.content, env.content_target
