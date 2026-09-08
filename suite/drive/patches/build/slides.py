"""Convert Slides media, previews, and body references."""

import io
import json
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, replace
from urllib.parse import unquote, urlsplit

from PIL import Image, ImageOps

from suite.drive._core.nodes import child_path
from suite.drive.patches.build.content_mapping import (
    InvalidLegacyContent,
    exact_fields,
    standard_fields,
    within_capacity,
)
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.history import _document_node
from suite.drive.patches.build.slide_journal import SlideBody, SlideJournalError
from suite.drive.patches.build.templates import convert_templates
from suite.drive.patches.build.titles import SiblingTitles
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


# The counters and evidence this phase owns. A rerun clears its own rows and
# leaves the history and link phases' record alone.
SLIDE_FIELDS = (
    "slides_completed",
    "media_nodes_created",
    "media_duplicates_collapsed",
    "slide_elements_rewritten",
    "deck_previews_created",
    "blobless_nodes",
    "slides_deferred",
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
    result.begin_phase("slides", SLIDE_FIELDS)

    try:
        convert_templates(env, batch_size=batch_size, result=result)
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
        result.record_issue("slides", str(error), phase="slides")
        env.state.put_content(result)
        raise BuildSlidesError(str(error)) from error


def _convert_deck(env, deck, batch_size, result):
    target = env.content_target
    deck_node = target.nodes((deck.node,)).get(deck.node)
    if not deck_node or deck_node.get("kind") != "document":
        raise InvalidLegacyContent(f"Presentation {deck.name} has no document node")
    host = env.content.site_host()
    # §12 preflights every Slide of a deck before the first deck write, and
    # thumbnail classification needs the whole File set, so both are collected
    # in full. The reads themselves stay bounded pages (§13).
    slides = _pages(env.content.slides, deck.name, (0, ""), batch_size, lambda row: (row.idx, row.name))
    parsed = {slide.name: _parse_elements(slide) for slide in slides}
    files = _pages(
        env.content.media_files,
        deck.name,
        ("", ""),
        batch_size,
        lambda row: (str(row.creation or ""), row.name),
    )
    thumbnail, excluded = _thumbnail_file(deck, files, result, host)
    references = _references(parsed, slides)
    if any(_named_by(references, row, host) for row in files if row.name in excluded):
        # §14.7 asks for both conversions. A File a slide body names is deck
        # media whatever else it is, so it becomes a child node and the body
        # holds that node id, while the same File still builds the preview.
        # Every excluded row carries the chosen blob, so the group is one node.
        excluded = set()
    media = [row for row in files if row.name not in excluded]
    _refuse_unreachable_children(deck, deck_node)
    writer = _MediaWriter(target, deck_node, batch_size)
    titles = _sibling_titles(writer, media)
    mapping, nodes, collapsed, blobless = _media_mapping(env, deck, media, host, writer, titles)
    local_mapping = dict(mapping)
    borrowed, borrowed_nodes = {}, set()
    if not deck.is_composite:
        # §11: a composite renders the referenced deck's own slides, so that
        # deck keeps the media and this one never copies it.
        borrowed, borrowed_nodes = _borrowed_mapping(
            env, deck, references, mapping, result, host, writer, titles
        )
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
        planned = _planned_body(slide, parsed[slide.name], mapping, local_mapping, host)
        changed, disagreements = planned.changed, planned.disagreements
        after = SlideBody(planned.elements, planned.background)
        if disagreements:
            result.record_issue(
                f"Slide:{slide.name}",
                f"{disagreements} attachmentName value(s) disagreed with src; src won",
                phase="slides",
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
        planned = _planned_body(row, parsed[row.name], mapping, local_mapping, host)
        current[row.name] = SlideBody(planned.elements, planned.background)
    rewritten = env.slide_journal.recover_changed_elements(deck.name, current)
    return created, collapsed, preview_created, rewritten, blobless


@dataclass(frozen=True)
class _PlannedBody:
    """One slide body as Build intends to store it, with why it changed."""

    elements: str
    background: str | None
    changed: int
    disagreements: int


def _planned_body(slide, elements, mapping, local_mapping, host) -> _PlannedBody:
    """The stored body a slide keeps, or the rewritten one it earns.

    A deck whose media all live outside this mapping resolves nothing. Dumping
    its parsed elements back would still rewrite the row, because `json.dumps`
    is compact and the stored string may be indented or ordered by another
    writer. That is a body change with no reference change: it fills the
    journal, counts as a rewrite in §14.9, and edits a source row §14.7 says to
    preserve. So an untouched body keeps its exact stored bytes.
    """
    rewritten, changed, disagreements = _rewrite_elements(elements, mapping, local_mapping, host)
    background, moved = _rewrite_value(slide.background, mapping, host)
    return _PlannedBody(
        slide.elements if not changed else _dump(rewritten),
        slide.background if not moved else background,
        changed,
        disagreements,
    )


def _refuse_unreachable_children(deck, parent):
    """Refuse a deck whose media nodes could not carry a legal path.

    `Drive Node.path` is `varchar(500)` and the tree stops at `DEPTH_CAP`
    levels (§3.1). Bulk SQL fires no validator, so an over-long path would be
    stored, and every later save, move, restore, or copy of that media node
    would then fail `_check_tree_position`.
    """
    if not within_capacity(child_path(parent)):
        raise InvalidLegacyContent(f"Presentation {deck.name} sits too deep to hold media nodes")


def _media_title(row) -> str:
    """The title rule ticket 27 used for a File node, spelled the same way."""
    return (row.file_name or "").strip() or row.name


def _sibling_titles(writer, media) -> SiblingTitles:
    """The titles already taken below the deck node by nodes this run keeps.

    Every media node this run writes is re-titled from its source row, so a
    title this run is about to reclaim must not block it on a rerun. A node an
    earlier run left that this run does not revisit keeps its title and holds
    it against the rest.
    """
    blobs = {row.blob for row in media if row.blob}
    planned = {row.name for row in media}
    return SiblingTitles(
        {
            child["title"]
            for child in writer.children
            if child.get("state") == "Active"
            and child.get("name") not in planned
            and child.get("blob") not in blobs
        }
    )


def _pages(read, deck, start, batch_size, key):
    """Walk one deck's keyset pages and return the rows in cursor order."""
    collected = []
    after = start
    while True:
        rows = read(deck, after, batch_size)
        if not rows:
            break
        collected.extend(rows)
        after = key(rows[-1])
        if len(rows) < batch_size:
            break
    return collected


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


def _media_mapping(env, deck, files, host, writer, titles):
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
        # One claim per stored node. Two media Files of one deck can carry the
        # same `file_name`, and `_refuse_sibling_collision` bars two Active
        # siblings from sharing a title. Bulk SQL fires no validator, so the
        # rename happens here or the pair lands where the runtime cannot repair
        # it.
        title = titles.claim(_media_title(source))
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
                placeholder = _media_node(source, parent, source.name, None, title)
                exact_fields(source_node, placeholder, NODE_FIELDS, f"media placeholder {source.name}")
                writer.upgrade(source.name, blob.name, int(blob.file_size), _mime(blob))
                name = source.name
            else:
                name = matches[0]["name"] if matches else source.name
            planned = _media_node(source, parent, name, blob, title)
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
            planned = _media_node(source, parent, source.name, None, title)
            found = target.nodes((source.name,)).get(source.name)
            if found:
                exact_fields(found, planned, NODE_FIELDS, f"blobless media node {source.name}")
            else:
                writer.add(planned)
    return mapping, nodes, collapsed, blobless


def _borrowed_mapping(env, deck, references, local, result, host, writer, titles):
    parent = writer.parent
    unresolved = tuple(sorted(value for value in references if _resolve(value, local, host) is None))
    candidates = env.content.media_files_by_urls(tuple(sorted(_url_lookup(unresolved, host))))
    by_url = defaultdict(list)
    foreign = defaultdict(list)
    for row in candidates:
        if row.deck == deck.name:
            continue
        adoptable = env.content.presentation_is_template(row.deck)
        for alias in _aliases(row, host):
            foreign[alias].append(row)
            if adoptable:
                by_url[alias].append(row)
    mapping = {}
    nodes = set()
    for value in unresolved:
        rows = _named_rows(by_url, value, host)
        if not rows:
            # A non-template global File cannot be adopted: Build cannot
            # reconstruct the original paste actor's access.
            if _named_rows(foreign, value, host):
                result.record_issue(
                    f"Presentation:{deck.name}",
                    f"media reference {value!r} belongs to a non-template Presentation and was not adopted",
                    phase="slides",
                )
            continue
        # §3: one unambiguous Ready blob. A reference with none is unresolved
        # evidence, not a reason to refuse a deck that is otherwise convertible.
        blobs = {row.blob for row in rows if row.blob and _blob_is_ready(env.content_target, row.blob)}
        if not blobs:
            result.record_issue(
                f"Presentation:{deck.name}",
                f"media reference {value!r} has no Ready blob and was not adopted",
                phase="slides",
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
            planned = _media_node(source, parent, name, blob, titles.claim(_media_title(source)))
            planned.update(
                owner=deck.owner,
                modified_by=deck.modified_by or deck.owner,
                content_modified=source.file_modified or source.modified,
            )
            writer.add(planned)
        nodes.add(name)
        mapping[value] = name
    return mapping, nodes


def _media_node(row, parent, name, blob, title):
    return {
        "name": name,
        "title": title,
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


def _thumbnail_file(deck, files, result, host=""):
    """The File a deck preview is built from, or nothing and a report line.

    Three tiers, widest last. A `Presentation.thumbnail` written before the
    File was made private reads `/files/x.webp` while the row now reads
    `/private/files/x.webp`, and neither the exact nor the canonical tier
    matches that pair. `_path_variants` does.

    An unmatched thumbnail is reported, not raised. A preview is derived data:
    §14.7 hands media previews to the daily gap sweep, and the deck, its media,
    and every other deck on the site are worth more than one refusal.
    """
    value = deck.thumbnail
    if not value or _never_media(value, host):
        return None, set()
    exact = [row for row in files if row.file_url == value]
    canonical = [
        row
        for row in files
        if not _never_media(row.file_url, host) and _canonical(row.file_url, host) == _canonical(value, host)
    ]
    wanted = _path_variants(value, host)
    variant = [row for row in files if _path_variants(row.file_url or "", host) & wanted]
    tier = exact or canonical or variant
    if not tier:
        result.record_issue(
            f"Presentation:{deck.name}",
            f"thumbnail {value!r} matches no File row; no preview was built",
            phase="slides",
        )
        return None, set()
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
    """The `/files/` and `/private/files/` spellings of one local URL.

    A site-absolute URL narrows to those paths. The absolute spelling itself
    is not returned: `site_host` carries no scheme to rebuild it with.
    `_url_lookup` asks the database for that spelling instead.
    """
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


def _url_lookup(values, host=""):
    """Every stored `file_url` these references could be filed under.

    The port matches `file_url` exactly, so the widening §11 applies to a
    value must reach the query as well. Legacy Slides also stored the site's
    own absolute URL, so each local path is asked for under both schemes and
    the scheme-relative form. A returned row is still matched on its own
    aliases, so a wider question cannot widen an answer.
    """
    lookup = set()
    for value in values:
        variants = _path_variants(value, host)
        lookup |= variants
        if not host:
            continue
        paths = [path for path in variants if path.startswith("/") and not path.startswith("//")]
        lookup |= {
            prefix + path for prefix in (f"//{host}", f"http://{host}", f"https://{host}") for path in paths
        }
    return lookup


def _named_rows(index, value, host=""):
    """The File rows one complete value names, widened as `_resolve` widens.

    An exact alias wins, the way it does in `_resolve`. Both sides then carry
    every `/files/` spelling, so a body value and a stored `file_url` that
    differ only in spelling still meet. The caller refuses a widened set that
    names two blobs rather than guessing between them.
    """
    if value in index:
        return list(index[value])
    found = {}
    for alias in sorted(_path_variants(value, host)):
        for row in index.get(alias, ()):
            found[row.name] = row
    return list(found.values())


def _references(parsed, slides):
    """Every complete string a deck's slide bodies use to name media."""
    found = set()
    for elements in parsed.values():
        for element in elements:
            for key in MEDIA_KEYS:
                found |= _strings(element.get(key))
    # §12 rewrites a whole `background` scalar too, so it names media as well.
    return found | {row.background for row in slides if isinstance(row.background, str)}


def _named_by(references, row, host=""):
    """Whether a slide body names this File, through its equivalent spellings."""
    aliases = _aliases(row, host)
    return any(_path_variants(value, host) & aliases for value in references)


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
