"""Convert Slides media, previews, and body references."""

import io
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import replace
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps

from suite.drive._core.nodes import child_path
from suite.drive.patches.build.content_mapping import InvalidLegacyContent, exact_fields, standard_fields
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.history import _document_node
from suite.drive.patches.build.slide_journal import SlideBody, SlideJournalError
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
    # `SlideJournalError` is a `RuntimeError`, so §12's journal conflicts would
    # otherwise leave the phase with no diagnostic and no state write.
    except (InvalidLegacyContent, ValueError, OSError, SlideJournalError) as error:
        result.record_issue("slides", str(error))
        env.state.put_content(result)
        raise BuildSlidesError(str(error)) from error


def _convert_deck(env, deck, batch_size, result):
    target = env.content_target
    deck_node = target.nodes((deck.node,)).get(deck.node)
    if not deck_node or deck_node.get("kind") != "document":
        raise InvalidLegacyContent(f"Presentation {deck.name} has no document node")
    host = env.content.site_host()
    slides = env.content.slides(deck.name)
    parsed = {slide.name: _parse_elements(slide) for slide in slides}
    files = sorted(env.content.media_files(deck.name), key=lambda row: (str(row.creation or ""), row.name))
    thumbnail, excluded = _thumbnail_file(deck, files, host)
    media = [row for row in files if row.name not in excluded]
    writer = _MediaWriter(target, deck_node, batch_size)
    mapping, nodes, collapsed, blobless = _media_mapping(env, deck, media, host, writer)
    local_mapping = dict(mapping)
    borrowed, borrowed_nodes = {}, set()
    if not deck.is_composite:
        # §11: a composite renders the referenced deck's own slides, so that
        # deck keeps the media and this one never copies it.
        borrowed, borrowed_nodes = _borrowed_mapping(env, deck, parsed, slides, mapping, result, host, writer)
    mapping.update(borrowed)
    writer.flush()
    preview_created = _preview(env, deck, thumbnail)
    target.commit()
    # §13 counts a validated non-null `(deck node, blob)` outcome once, whether
    # a local group or an adopted reference produced it.
    created = len(nodes | borrowed_nodes)

    updates = []
    for slide in slides:
        before = SlideBody(slide.elements, slide.background)
        elements, changed, disagreements = _rewrite_elements(parsed[slide.name], mapping, local_mapping, host)
        background, _ = _rewrite_value(slide.background, mapping, host)
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
    # The target port mutates fakes and SQL immediately. Rebuild planned values
    # so recovery also covers a crash after SQL and before the state write.
    current = {}
    for row in slides:
        elements, _, _ = _rewrite_elements(parsed[row.name], mapping, local_mapping, host)
        background, _ = _rewrite_value(row.background, mapping, host)
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


class _MediaWriter:
    """One deck's media node writes, held to §13's 1,000-row commit ceiling.

    One node is the indivisible unit, so the boundary falls between nodes. The
    planned rows also stay in `children`, because §11 resolves a borrowed
    reference against a node this deck has already planned.
    """

    def __init__(self, target, parent, batch_size):
        self.target = target
        self.parent = parent
        self.batch_size = batch_size
        self.children = target.child_nodes(parent["name"])
        self.pending = []
        self.written = 0

    def add(self, row):
        self.pending.append(row)
        self.children.append(row)
        self._reserve()

    def upgrade(self, name, blob, size, mime):
        self.target.update_media_node(name, blob, size, mime)
        self.written += 1
        self._reserve()

    def _reserve(self):
        if len(self.pending) + self.written >= self.batch_size:
            self.flush()

    def flush(self):
        if not self.pending and not self.written:
            return
        if self.pending:
            self.target.insert_nodes(self.pending)
            self.pending = []
        self.target.commit()
        self.written = 0


def _media_mapping(env, deck, files, host, writer):
    target = env.content_target
    parent = writer.parent
    groups = defaultdict(list)
    for row in files:
        groups[("blob", row.blob) if row.blob else ("file", row.name)].append(row)
    mapping = {}
    nodes = set()
    collapsed = 0
    blobless = 0
    for _key, rows in sorted(groups.items(), key=lambda item: (str(item[0]), item[1][0].name)):
        rows.sort(key=lambda row: (str(row.creation or ""), row.name))
        source = rows[0]
        if source.blob:
            collapsed += len(rows) - 1
            blob = _ready_blob(target, source.blob)
            matches = [
                row for row in writer.children if row.get("kind") == "file" and row.get("blob") == source.blob
            ]
            if len(matches) > 1:
                raise InvalidLegacyContent(f"Presentation {deck.name} has duplicate media nodes")
            source_node = target.nodes((source.name,)).get(source.name)
            if source_node and not source_node.get("blob"):
                if matches and matches[0]["name"] != source.name:
                    raise InvalidLegacyContent(f"media placeholder {source.name} conflicts with a blob node")
                placeholder = _media_node(source, parent, source.name, None)
                exact_fields(source_node, placeholder, NODE_FIELDS, f"media placeholder {source.name}")
                writer.upgrade(source.name, blob.name, int(blob.file_size), _mime(blob))
                name = source.name
            else:
                name = matches[0]["name"] if matches else source.name
            planned = _media_node(source, parent, name, blob)
            found = target.nodes((name,)).get(name)
            if found and found.get("blob"):
                exact_fields(found, planned, NODE_FIELDS, f"media node {name}")
            elif not found:
                writer.add(planned)
            nodes.add(name)
            for row in rows:
                for alias in _aliases(row, host):
                    _bind(mapping, alias, name)
        else:
            blobless += 1
            planned = _media_node(source, parent, source.name, None)
            found = target.nodes((source.name,)).get(source.name)
            if found:
                exact_fields(found, planned, NODE_FIELDS, f"blobless media node {source.name}")
            else:
                writer.add(planned)
    return mapping, nodes, collapsed, blobless


def _borrowed_mapping(env, deck, parsed, slides, local, result, host, writer):
    parent = writer.parent
    references = set()
    for elements in parsed.values():
        for element in elements:
            for key in MEDIA_KEYS:
                references |= _strings(element.get(key))
    # §12 rewrites a whole `background` scalar too, so it names media as well.
    references |= {row.background for row in slides if isinstance(row.background, str)}
    unresolved = tuple(sorted(value for value in references if _resolve(value, local, host) is None))
    lookup = set(unresolved)
    for value in unresolved:
        lookup |= _path_variants(value, host)
    candidates = env.content.media_files_by_urls(tuple(sorted(lookup)))
    by_url = defaultdict(list)
    for row in candidates:
        if row.deck != deck.name and env.content.presentation_is_template(row.deck):
            for alias in _aliases(row, host):
                by_url[alias].append(row)
    mapping = {}
    nodes = set()
    for value in unresolved:
        rows = by_url.get(value, [])
        if not rows:
            # A non-template global File cannot be adopted: Build cannot
            # reconstruct the original paste actor's access.
            if any(row.deck != deck.name and value in _aliases(row, host) for row in candidates):
                result.record_issue(
                    f"Presentation:{deck.name}",
                    f"media reference {value!r} belongs to a non-template Presentation and was not adopted",
                )
            continue
        # §3: one unambiguous Ready blob. A reference with none is unresolved
        # evidence, not a reason to refuse a deck that is otherwise convertible.
        blobs = {row.blob for row in rows if row.blob and _blob_is_ready(env.content_target, row.blob)}
        if not blobs:
            result.record_issue(
                f"Presentation:{deck.name}",
                f"media reference {value!r} has no Ready blob and was not adopted",
            )
            continue
        if len(blobs) != 1:
            raise InvalidLegacyContent(f"borrowed media {value!r} is ambiguous")
        blob_name = next(iter(blobs))
        blob = _ready_blob(env.content_target, blob_name)
        matches = [
            row for row in writer.children if row.get("kind") == "file" and row.get("blob") == blob_name
        ]
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
            writer.add(planned)
        nodes.add(name)
        mapping[value] = name
    return mapping, nodes


def _media_node(row, parent, name, blob):
    return {
        "name": name,
        "title": row.file_name or row.name,
        "parent": parent["name"],
        "root": parent["root"],
        # The controller rule, not a local spelling of it: a deck directly under
        # a root has `path == ""`, and its children still need `/<deck>/`.
        "path": child_path(parent),
        "kind": "file",
        "blob": blob.name if blob else None,
        "size": int(blob.file_size) if blob else 0,
        "mime": _mime(blob) if blob else None,
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


def _mime(blob):
    """The MIME a media node stores. Both writers must agree, or the next run
    refuses the node it repaired itself (§13 exact rerun validation)."""
    return blob.mime_type or "application/octet-stream"


def _thumbnail_file(deck, files, host=""):
    value = deck.thumbnail
    if not value or _never_media(value, host):
        return None, set()
    exact = [row for row in files if row.file_url == value]
    canonical = [
        row
        for row in files
        if not _never_media(row.file_url, host) and _canonical(row.file_url, host) == _canonical(value, host)
    ]
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
    found = target.preview(deck.node)
    if found:
        # §13 validates a stored row rather than rewriting it. `put_private_blob`
        # is content addressed, so re-encoding first would rename the preview
        # blob after any encoder change and refuse the deck for good.
        _validate_preview(target, deck, source, found)
        return 1
    raw = target.read_blob(blob.name)
    # Probe the declared size before any decode, the way `previews.py:181-198`
    # does. `Image.DecompressionBombError` derives from `Exception`, not
    # `OSError`, so a bomb reaches neither handler below.
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            width, height = probe.size
    except Exception as error:
        raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is unreadable") from error
    if width * height > MAX_IMAGE_PIXELS:
        raise InvalidLegacyContent(f"Presentation {deck.name} thumbnail is oversized")
    try:
        with Image.open(io.BytesIO(raw)) as image:
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
    target.insert_previews([planned])
    return 1


def _validate_preview(target, deck, source, found):
    """Accept one stored preview on its identity, never on its blob bytes.

    §4 of the media memo: the row is named by the chosen File, carries the deck
    node, and holds a validated private Ready WebP. Nothing here re-derives the
    blob, so the row survives an encoder change inside the rollback window.
    """
    identity = {
        "name": source.name,
        "node": deck.node,
        "source_blob": None,
        **standard_fields(source),
    }
    exact_fields(found, identity, tuple(identity), f"preview {source.name}")
    blob = target.blob(found.get("blob")) if found.get("blob") else None
    if not blob or blob.status != "Ready" or not blob.is_private or blob.mime_type != "image/webp":
        raise InvalidLegacyContent(f"Presentation {deck.name} preview blob is invalid")


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


def _aliases(row, host=""):
    """Every complete string that names this File, and nothing wider.

    The S3 spelling is the one that has to be special-cased: its identity is
    the whole `?path=` URL and the key that query argument carries. Stripping
    the query would leave `/api/method/suite.drive.api.s3.fetch`, which every
    S3 File on the site shares.
    """
    url = row.file_url or ""
    values = {row.name, url, unquote(url)}
    if url.startswith(S3_URL_PREFIX):
        values.add(unquote(url[len(S3_URL_PREFIX) :]))
    else:
        values |= _local_path_variants(url, host)
    return {value for value in values if value}


def _local_path_variants(url, host=""):
    """The `/files/` spellings of one local URL, including its absolute form."""
    parsed = urlsplit(url or "")
    if parsed.netloc and parsed.netloc != host:
        # §11: do not localize an unknown remote host.
        return set()
    if parsed.query:
        return set()
    values = set()
    for path in (parsed.path, unquote(parsed.path or "")):
        if path.startswith("/files/"):
            values |= {path, "/private" + path}
        elif path.startswith("/private/files/"):
            values |= {path, path.removeprefix("/private")}
    return values


def _path_variants(value, host=""):
    return {value, unquote(value)} | _local_path_variants(value, host)


def _local_url(value, host=""):
    """The path and query of one value when it names this site, else None."""
    parsed = urlsplit(str(value or ""))
    if parsed.netloc and parsed.netloc != host:
        return None
    return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path


def _canonical(value, host=""):
    """The percent-decoded path and query of one URL, for thumbnail tier 2.

    The query stays. Dropping it would leave every S3 File sharing
    `/api/method/suite.drive.api.s3.fetch`, and two S3 attachments would both
    match one S3 thumbnail.
    """
    return unquote(_local_url(value, host) or str(value or ""))


def _never_media(value, host=""):
    """A colour, data URL, bundled asset, or foreign host is never deck media.

    §11 keeps a same-site absolute URL resolvable, because legacy Slides stored
    one whenever the browser handed back a whole `file_url`.
    """
    text = str(value or "")
    if text.startswith(("data:", "/assets/", "#")):
        return True
    netloc = urlsplit(text).netloc
    return bool(netloc) and netloc != host


def _local_legacy_url(value, host=""):
    local = _local_url(value, host)
    return bool(local) and local.startswith(("/files/", "/private/files/", S3_URL_PREFIX))


def _resolve(value, mapping, host=""):
    """The node one complete value names, through its equivalent spellings.

    An exact alias wins. §11 resolves complete strings only, so this widens the
    spelling of one value and never matches a part of it, and it refuses to
    guess when two equivalent spellings name different nodes.
    """
    if _never_media(value, host):
        return None
    if value in mapping:
        return mapping[value]
    found = {mapping[name] for name in _path_variants(value, host) if name in mapping}
    return found.pop() if len(found) == 1 else None


def _bind(mapping, alias, node):
    if alias in mapping and mapping[alias] != node:
        raise InvalidLegacyContent(f"media alias {alias!r} resolves to different blobs")
    mapping[alias] = node


def _blob_is_ready(target, name):
    blob = target.blob(name)
    return bool(blob and blob.status == "Ready")


def _rewrite_elements(elements, mapping, local_mapping, host=""):
    output = []
    changed = 0
    disagreements = 0
    for source in elements:
        item = deepcopy(source)
        item_changed = "attachmentName" in item
        attachment = item.pop("attachmentName", None)
        for key in MEDIA_KEYS:
            if key in item:
                item[key], nested = _rewrite_value(item[key], mapping, host)
                item_changed |= nested
        source_src = source.get("src")
        if isinstance(source_src, str) and isinstance(attachment, str):
            resolved = _resolve(source_src, mapping, host)
            fallback = local_mapping.get(attachment)
            if resolved and fallback and resolved != fallback:
                disagreements += 1
            elif not resolved and fallback and _local_legacy_url(source_src, host):
                item["src"] = fallback
                item_changed = True
        changed += int(item_changed)
        output.append(item)
    return output, changed, disagreements


def _rewrite_value(value, mapping, host=""):
    if isinstance(value, str):
        node = _resolve(value, mapping, host)
        if node is None:
            return value, False
        # A keeper node takes its File's id, and that id is one of its own
        # aliases. Rewriting a value onto itself changes nothing, and counting
        # it would inflate `slide_elements_rewritten` on every repair run.
        return node, node != value
    changed = False
    if isinstance(value, dict):
        output = {}
        for key, nested in value.items():
            output[key], one = _rewrite_value(nested, mapping, host)
            changed |= one
        return output, changed
    if isinstance(value, list):
        output = []
        for nested in value:
            item, one = _rewrite_value(nested, mapping, host)
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
