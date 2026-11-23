"""§14.6 and §14.7: make legacy Writer bodies readable by the new Writer.

Build changes a Writer body in three ways and touches nothing else:

- **Pictures another document owns** (B112). A legacy body can show a
  picture stored under a different document: the legacy embed URL served
  any embed its reader could read, wherever it was filed. The new Writer
  reads a picture only through the document's own media session (§9.4),
  which holds that document's children and nothing else, so the picture
  would disappear. Build gives the document its own media node for the
  same `File Blob` (no bytes are copied) and points the body at it.
- **Pictures that sit directly inside a list item** (B113). The editor's
  `image` node is inline, and `listItem`, `taskItem`, `blockquote`, table
  cells, and the document root accept only blocks, so the editor drops an
  image found directly inside one. ProseMirror cannot mix inline and block
  content in one content expression, so the schema cannot accept it.
  Build wraps each such image in its own paragraph instead. At the top it
  wraps each run of loose inline content, text included, in one paragraph:
  old Writer fitted the run into one, so pictures in a run stood side by
  side.
- **Picture addresses on the old site's host.** Old Writer could store a
  picture as an absolute address on the host it ran on,
  `https://drive.frappe.io/api/method/...`. Build drops the scheme and host
  so the document doesn't depend on the host (owner ruling, 2026-11-13).
  Only the old Frappe hosts and the site's own count, in any case and on
  the scheme's default port; an address on any other host or port stays
  as it is. Only a whole `src` or `href` value changes, never an address
  inside other text.

A picture reference is a `src`, `href` or `data-node` attribute, of a real
html start tag or of a Yjs element. An id anywhere else, in a sentence or a
caption, shows no picture, so it is never copied or rewritten.

Three callers, one `DocumentPictures` per document:

- Step 7 calls `convert_writer_body` once per Writer document, before its
  history, and rewrites the live body (the Yjs `content` and the `html`).
- Step 7 then passes each page of that document's `Writer Version` rows to
  `writer_version_html`. A version can show a picture the live body no
  longer shows, so its ids are mapped too, with the same copies: a version
  shown or restored after Build names the document's own node. Only the id
  and an own host inside each picture reference change. Version bytes are HTML, which the
  editor parses with ProseMirror's `DOMParser`; that wraps loose inline
  content itself, so B113 needs no rewrite there.
- Step 8 calls `convert_template_body` for each `Writer Template` before it
  writes the template's document, so the template node gets its own copies
  and every document made from the template names pictures it can read.
  Step 8 validates a stored template document against this rewritten body.

## Why this module reads Writer bodies itself

`suite/writer/content/files.py` already reads and remaps media ids, but Drive code
may not import a content product (`suite/tests/test_architecture.py`), and
Build is Drive code. The three spellings below are therefore a copy of
`suite.writer.content.files.MEDIA_PATTERNS`, and the two must change together.

Every pycrdt call runs inside `_readable()`. A body pycrdt cannot read
raises `pyo3_runtime.PanicException`, which derives from `BaseException`.
An unreadable body is reported and left exactly as it is: the runtime falls
back to a raw scan for such a body, and Build has no better reading of it.
"""

import base64
import binascii
import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

import pycrdt

from suite.drive.patches.build.content_mapping import child_path
from suite.drive.patches.build.ports import ACTIVE, TRASHED, WriterBody
from suite.drive.patches.build.titles import SiblingTitles

# The Yjs root fragment the editor binds to.
BODY_FRAGMENT = "default"

NODE_ATTRIBUTE = "data-node"
MEDIA_ID = r"[A-Za-z0-9_-]{1,140}"
MEDIA_PATTERNS = (
    re.compile(rf"(?:suite\.)?writer\.api\.embed\.get\?id=({MEDIA_ID})"),
    re.compile(rf"(?:suite\.)?drive\.api\.embed\.get_file_content\?[^\"'<>\s]*?\bembed_name=({MEDIA_ID})"),
    re.compile(rf'{NODE_ATTRIBUTE}="({MEDIA_ID})"'),
)
BARE_MEDIA_ID = re.compile(MEDIA_ID)
# The hosts old Frappe Drive was served from. A constant, not site config:
# a key nobody set on prod would leave every address in place silently
OLD_PROD_HOSTS = ("drive.frappe.io", "suite.bom.frappe.cloud", "suite.frappe.io")
API_METHOD = "/api/method/"
EMBED_PATH = re.compile(
    rf"{API_METHOD}(?:suite\.)?(?:writer\.api\.embed\.get|drive\.api\.embed\.get_file_content)\?"
)
DEFAULT_PORTS = {"http": 80, "https": 443}
# A start tag with its name, quotes respected. A comment, and a text-only element up to
# its closing tag, hold no tags and match with no name
HTML_TAG = re.compile(
    r"""<!--.*?-->"""
    r"""|<(?P<text>textarea|script|style|title)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^"'>])*>(?:.*?</(?P=text)\s*>|.*)"""
    r"""|<(?P<name>[A-Za-z][^\s/>"']*)(?:"[^"]*"|'[^']*'|[^"'>])*>""",
    re.DOTALL | re.IGNORECASE,
)
TAG_ATTRIBUTE = re.compile(r"""([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?""")
# Only these attributes hold a picture reference; an id anywhere else is someone's words
ADDRESS_ATTRIBUTES = ("src", "href")
MEDIA_ATTRIBUTES = (*ADDRESS_ATTRIBUTES, NODE_ATTRIBUTE)

IMAGE = "image"
PARAGRAPH = "paragraph"
# The parents an image may sit in directly. `paragraph` and `heading` hold
# inline content and `imageGroup` holds `image+`. A `codeBlock` holds only
# text, so a paragraph inside it would be just as invalid, and an image there
# is left alone. Every other parent, the root fragment included, accepts only
# blocks.
IMAGE_PARENTS = frozenset({"paragraph", "heading", "imageGroup", "codeBlock"})
# The editor's inline atoms, which a paragraph holds and the root does not
INLINE_NODES = frozenset({IMAGE, "hardBreak", "mention", "tagItem", "attachment"})

# Called once per id that stays as it is, with the reason.
ReportMissing = Callable[[str, str], None]


class UnreadableBody(Exception):
    """One Writer body pycrdt refused to read."""


@dataclass(frozen=True)
class _Rewrite:
    body: WriterBody
    images_wrapped: int


class DocumentPictures:
    """Which node each picture one Writer document names becomes after Build.

    A picture the document holds keeps its id. A borrowed one maps to the
    document's copy: the oldest child with the same blob, whoever made it,
    or a new node `claim` plans. The same object sees the live body and then
    every version page, so a blob gets one copy however many texts name it,
    and a rerun meets the copies it made and plans none.
    """

    def __init__(self, env, document, node: str, report: ReportMissing, *, node_row: dict | None = None):
        children = env.content_target.child_nodes(node)
        self.mapping: dict[str, str] = {}
        self._env = env
        self._document = document
        self._node = node
        # Step 8 passes the template node it is about to write. Step 7 reads
        # the stored node only when it first needs a copy.
        self._node_row = node_row
        self._report = report
        self.own_hosts = own_hosts(env.content.site_host())
        self._own = {child["name"] for child in children}
        self._settled: set[str] = set()
        self._by_blob: dict[str, str] = {}
        for child in sorted(children, key=lambda row: (str(row.get("creation") or ""), row["name"])):
            if child.get("kind") == "file" and child.get("blob"):
                self._by_blob.setdefault(child["blob"], child["name"])
        self._titles = SiblingTitles({child["title"] for child in children if child.get("state") == ACTIVE})

    def claim(self, named: set[str]) -> list[dict]:
        """Map every borrowed id in `named` this object has not met yet.

        Answers the copies to insert. The caller inserts them before it
        commits any text that names them. Copies only a picture whose node is
        a stored file below another document, with Ready bytes. Anything else
        stays as it is and is reported once, the way a missing picture of the
        document's own is.
        """
        foreign = sorted(named - self._own - self._settled)
        if not foreign:
            return []
        self._settled.update(foreign)
        target = self._env.content_target
        found = target.nodes(tuple(foreign))
        parents = target.nodes(
            tuple(sorted({row["parent_node"] for row in found.values() if row.get("parent_node")}))
        )
        copies: list[dict] = []
        for name in foreign:
            picture = found.get(name)
            reason = _uncopyable(target, picture, parents)
            if reason:
                self._report(name, reason)
                continue
            blob = picture["blob"]
            if blob not in self._by_blob:
                copy = _copy_node(
                    self._env, self._document, self._parent(), picture, self._titles.claim(picture["title"])
                )
                copies.append(copy)
                self._by_blob[blob] = copy["name"]
            self.mapping[name] = self._by_blob[blob]
        return copies

    def _parent(self) -> dict:
        if self._node_row is None:
            self._node_row = self._env.content_target.nodes((self._node,))[self._node]
        return self._node_row


def convert_writer_body(env, content, document, node: str) -> DocumentPictures:
    """Copy borrowed pictures under `node` and rewrite the live body to use them.

    Answers the document's pictures, for `writer_version_html`. Rerunnable at
    any point. A rewritten body names only the document's own children and
    holds no loose image, so the next pass finds nothing to copy and nothing
    to wrap.
    """
    source, target = env.content, env.content_target
    label = f"Writer Document:{document.name}"
    pictures = DocumentPictures(env, document, node, _history_report(content, label))
    # Step 8 writes a template's document from its `Writer Template` row,
    # pictures included (`convert_template_body`), and validates it field by
    # field against that row, so step 7 leaves its body alone.
    if source.writer_document_is_template(document.name):
        return pictures
    body = source.writer_body(document.name)
    if body is None:
        return pictures
    copies: list[dict] = []
    rewrite = None
    try:
        hosts = pictures.own_hosts
        copies = pictures.claim(_html_ids(body.html or "", hosts) | _body_ids(body.content, hosts))
        rewrite = _rewritten(body, pictures)
    except UnreadableBody:
        # The body stays as it is. A copy already claimed is still inserted
        # below: the mapping names it, and a version may use it.
        content.writer_bodies_unreadable += 1
        content.record_issue(label, "body cannot be read; it was left as it is", phase="history")

    if not copies and rewrite is None:
        return pictures
    target.insert_nodes(copies)
    if rewrite is not None:
        target.update_writer_body(document.name, rewrite.body.content, rewrite.body.html)
    # One commit for both, so the copies and the body that names them land
    # together. A kill before it loses both, and the rerun redoes both.
    target.commit()
    content.writer_media_copied += len(copies)
    if rewrite is not None:
        content.writer_bodies_rewritten += 1
        content.writer_images_wrapped += rewrite.images_wrapped
    return pictures


def writer_version_html(env, content, pictures: DocumentPictures, snapshots: list[str]) -> list[str]:
    """One page of version HTML, each pointing at the document's own pictures.

    Copies a picture the first time any version names it, and commits the
    copies before the caller writes a version that names them. Only the id
    and an own host inside each picture reference change; every other byte
    is the source's.
    """
    copies = pictures.claim(set().union(*(_html_ids(text, pictures.own_hosts) for text in snapshots)))
    if copies:
        target = env.content_target
        target.insert_nodes(copies)
        target.commit()
        content.writer_media_copied += len(copies)

    rewritten = [_remap_text(text, pictures.mapping, pictures.own_hosts) for text in snapshots]

    content.writer_versions_rewritten += sum(
        new != old for new, old in zip(rewritten, snapshots, strict=True)
    )
    return rewritten


def convert_template_body(
    env, result, template, node: dict, body: WriterBody
) -> tuple[WriterBody, list[dict]]:
    """A Writer template's body as its document gets it, and the copies it needs.

    `node` is the template node as step 8 plans it; on a first run it is not
    stored yet, so this only plans. Step 8 inserts the copies with the
    document. The template node gets its own copies, the same way a Writer
    document does, so a document made from the template names pictures it
    can read. Answers the same body for the same source on every run: a
    rerun finds the copies under the node and maps onto them.
    """
    label = f"Writer Template:{template.name}"

    def report(name: str, reason: str) -> None:
        result.template_media_references_missing += 1
        result.record_issue(
            label, f"media reference {name!r} {reason}; it was left as it is", phase="templates"
        )

    pictures = DocumentPictures(env, template, node["name"], report, node_row=node)
    hosts = pictures.own_hosts
    copies = pictures.claim(_html_ids(body.html or "", hosts) | _body_ids(body.content, hosts))
    rewrite = _rewritten(body, pictures)
    return (rewrite.body if rewrite else body), copies


def _history_report(content, label: str) -> ReportMissing:
    def report(name: str, reason: str) -> None:
        content.writer_media_references_missing += 1
        content.record_issue(
            label, f"media reference {name!r} {reason}; it was left as it is", phase="history"
        )

    return report


def _uncopyable(target, picture, parents) -> str:
    if picture is None:
        return "names no node"
    if picture.get("kind") != "file" or not picture.get("blob"):
        return "names a node that holds no stored file"
    if (parents.get(picture.get("parent_node")) or {}).get("kind") != "document":
        return "names a file that belongs to no document"
    blob = target.blob(picture["blob"])
    if blob is None or blob.status != "Ready":
        return "names a file whose bytes are not Ready"
    return ""


def _copy_node(env, document, parent: dict, picture: dict, title: str) -> dict:
    """A new media node under `parent` for the same blob as `picture`.

    A child of a Trashed document is Trashed with it, under the document's
    own trash root, as §14.4 does for every other child.
    """
    trashed = parent.get("state") == TRASHED
    owner = document.owner or picture["owner"]
    return {
        "name": env.new_id(),
        "title": title,
        "parent_node": parent["name"],
        "root": parent["root"],
        "path": child_path(parent),
        "kind": "file",
        "blob": picture["blob"],
        "size": picture.get("size") or 0,
        "mime": picture.get("mime"),
        "url": None,
        "content_doctype": None,
        "content_docname": None,
        "state": TRASHED if trashed else ACTIVE,
        "trashed_at": parent.get("trashed_at") if trashed else None,
        "trash_root": parent.get("trash_root") if trashed else None,
        "content_modified": picture.get("content_modified"),
        "is_template": 0,
        "owner": owner,
        "creation": picture["creation"],
        "modified": picture["modified"],
        "modified_by": document.modified_by or owner,
        "docstatus": 0,
        "idx": 0,
    }


def _rewritten(body: WriterBody, pictures: DocumentPictures) -> _Rewrite | None:
    """Apply the pictures' ids and hosts and wrap loose images; None when nothing changed."""
    mapping = pictures.mapping
    hosts = pictures.own_hosts
    html = body.html
    if html:
        html = _remap_text(html, mapping, hosts)

    content, wrapped = _rewritten_content(body.content, mapping, hosts)
    if content == body.content and html == body.html:
        return None
    return _Rewrite(WriterBody(content=content, html=html), wrapped)


def _rewritten_content(
    content: str | None, mapping: dict[str, str], hosts: frozenset
) -> tuple[str | None, int]:
    raw = _decoded(content)
    if raw is None:
        return content, 0
    with _readable():
        document, fragment = _loaded(raw)
        before = document.get_state()
        changed = False
        with document.transaction():
            for element in _elements(fragment):
                for key, value in dict(element.attributes).items():
                    if not isinstance(value, str):
                        continue

                    rewritten = rewritten_attribute(key, value, mapping, hosts)
                    if rewritten != value:
                        element.attributes[key] = rewritten
                        changed = True

            runs, run_images = wrap_top_level_runs(fragment)
            wrapped = run_images + _wrap_loose_images(fragment)

        if not changed and not runs and not wrapped:
            return content, 0

        # Merged onto the stored bytes: an update from the document alone leaves out what Yjs holds back
        update = pycrdt.merge_updates(raw, document.get_update(before))
        return base64.b64encode(update).decode("ascii"), wrapped


def rewritten_attribute(key: str, value: str, mapping: dict[str, str], hosts: frozenset) -> str:
    """Answer a picture attribute's value with its ids swapped and its own host dropped."""
    if key == NODE_ATTRIBUTE:
        return mapping.get(value, value)

    path = picture_path(key, value, hosts)
    if path is None:
        return value

    match = path_id(path)
    if match is None:
        return path

    replacement = mapping.get(match.group(1), match.group(1))
    return path[: match.start(1)] + replacement + path[match.end(1) :]


def picture_path(key: str, value: str, hosts: frozenset) -> str | None:
    """Answer a whole picture address on this site as a site path; None for any other value."""
    if key not in ADDRESS_ATTRIBUTES:
        return None

    path = site_address(value, hosts)
    if not EMBED_PATH.match(path):
        return None

    return path


def path_id(path: str) -> re.Match | None:
    """Match the id a picture path names, right after its method."""
    for pattern in MEDIA_PATTERNS:
        match = pattern.match(path, len(API_METHOD))
        if match:
            return match

    return None


def wrap_top_level_runs(fragment: pycrdt.XmlFragment) -> tuple[int, int]:
    """Put each run of loose inline content at the top in one paragraph, answering runs and images."""
    # Old Writer drew a run so: ProseMirror fitted it into the paragraph the
    # root needs, and the next block closed that paragraph. Yjs has no move,
    # so the run is deleted and an equal one inserted in a paragraph at its index
    runs = 0
    images = 0
    for start, pieces in reversed(top_level_runs(fragment)):
        for _ in pieces:
            del fragment.children[start]

        wrapper = fragment.children.insert(start, pycrdt.XmlElement(PARAGRAPH))
        for piece in pieces:
            append_copy(wrapper, piece)

        runs += 1
        images += [tag for tag, _ in pieces].count(IMAGE)

    return runs, images


def top_level_runs(fragment: pycrdt.XmlFragment) -> list[tuple[int, list]]:
    """Answer the index each run of loose inline content at the top starts at, with a copy of its pieces."""
    runs: list[tuple[int, list]] = []
    for index, child in enumerate(fragment.children):
        if not loose_inline(child):
            continue

        if not runs or runs[-1][0] + len(runs[-1][1]) != index:
            runs.append((index, []))

        runs[-1][1].append(piece_of(child))

    return runs


def loose_inline(child: pycrdt.XmlElement | pycrdt.XmlText) -> bool:
    """Answer whether a child of the root is text or an inline atom."""
    if isinstance(child, pycrdt.XmlText):
        return True

    return isinstance(child, pycrdt.XmlElement) and child.tag in INLINE_NODES and not list(child.children)


def piece_of(child: pycrdt.XmlElement | pycrdt.XmlText) -> tuple[str | None, object]:
    """Copy a text with its formatting, or an atom with its attributes."""
    if isinstance(child, pycrdt.XmlText):
        return None, child.diff()

    return child.tag, dict(child.attributes)


def append_copy(wrapper: pycrdt.XmlElement, piece: tuple[str | None, object]) -> None:
    """Append a copied piece to the paragraph."""
    tag, held = piece
    if tag is not None:
        wrapper.children.append(pycrdt.XmlElement(tag, held))
        return

    text = wrapper.children.append(pycrdt.XmlText())
    for value, attributes in held:
        if isinstance(value, str):
            text.insert(len(text), value, attributes)
        else:
            text.insert_embed(len(text), value, attributes)


def _wrap_loose_images(fragment) -> int:
    """Put every image whose parent accepts only blocks in its own paragraph.

    One paragraph per image, so pictures that stood one under another still
    do. Runs at the top are wrapped already. The replacement carries every attribute the image had. Yjs has no
    move, so the image is deleted and an equal one inserted at its index.
    """
    wrapped = 0
    stack = [fragment]
    while stack:
        parent = stack.pop()
        tag = parent.tag if isinstance(parent, pycrdt.XmlElement) else None
        children = list(parent.children)
        if tag not in IMAGE_PARENTS:
            for index, child in enumerate(children):
                if not _loose_image(child):
                    continue
                attributes = dict(child.attributes)
                del parent.children[index]
                parent.children.insert(
                    index, pycrdt.XmlElement(PARAGRAPH, None, [pycrdt.XmlElement(IMAGE, attributes)])
                )
                wrapped += 1
        stack.extend(child for child in parent.children if isinstance(child, pycrdt.XmlElement))
    return wrapped


def _loose_image(child) -> bool:
    # An image is an atom. One with children is not the editor's image, and
    # copying only its attributes would lose them.
    return isinstance(child, pycrdt.XmlElement) and child.tag == IMAGE and not list(child.children)


def _html_ids(text: str, hosts: frozenset) -> set[str]:
    return set().union(*(attribute_ids(name, value, hosts) for _, _, name, value in media_values(text)))


def attribute_ids(key: str, value: str, hosts: frozenset) -> set[str]:
    """Answer the ids a picture attribute names; none for any other attribute."""
    # `data-node` holds the bare id, so the patterns alone never see it
    if key == NODE_ATTRIBUTE and BARE_MEDIA_ID.fullmatch(value):
        return {value}

    path = picture_path(key, value, hosts)
    match = path_id(path or "")
    if match is None:
        return set()

    return {match.group(1)}


def media_values(html: str) -> Iterator[tuple[int, int, str, str]]:
    """Yield the span, lowercase name and value of each picture attribute in a real start tag."""
    for tag in HTML_TAG.finditer(html):
        # A comment matches with no tag name
        if tag.group("name") is not None:
            yield from tag_media_values(html, tag)


def tag_media_values(html: str, tag: re.Match) -> Iterator[tuple[int, int, str, str]]:
    """Yield the span, lowercase name and value of each picture attribute in one start tag."""
    for attribute in TAG_ATTRIBUTE.finditer(html, tag.end("name"), tag.end() - 1):
        name = attribute.group(1).lower()
        # The last group that matched is the value; group 1 alone is a bare attribute name
        value = attribute.lastindex
        if name not in MEDIA_ATTRIBUTES or value == 1:
            continue

        yield attribute.start(value), attribute.end(value), name, attribute.group(value)


def _body_ids(content: str | None, hosts: frozenset) -> set[str]:
    """The ids the live attributes name. Deleted content is never read."""
    raw = _decoded(content)
    if raw is None:
        return set()
    found: set[str] = set()
    with _readable():
        _, fragment = _loaded(raw)
        for element in _elements(fragment):
            for key, value in dict(element.attributes).items():
                if isinstance(value, str):
                    found |= attribute_ids(key, value, hosts)

    return found


def own_hosts(site_host: str) -> frozenset:
    """Answer this site's hosts as lowercase `(host, port)` pairs, None for a default port."""
    return frozenset({(host, None) for host in OLD_PROD_HOSTS} | {host_and_port(f"//{site_host}")}) - {None}


def host_and_port(address: str) -> tuple[str, int | None] | None:
    """Answer an address's lowercase host and its port, None for its scheme's default."""
    try:
        parts = urlsplit(address)
        port = parts.port
    except ValueError:
        return None

    if not parts.hostname or "@" in parts.netloc:
        return None

    if port in {DEFAULT_PORTS.get(parts.scheme), None} or (not parts.scheme and port in {80, 443}):
        port = None

    return parts.hostname, port


def site_address(value: str, hosts: frozenset) -> str:
    """Drop the scheme and host from a whole picture address on one of `hosts`."""
    if not value.lower().startswith(("http://", "https://")) or host_and_port(value) not in hosts:
        return value

    # `urlsplit` drops tabs and newlines, so its parts may not line up with the value
    parts = urlsplit(value)
    prefix = f"{parts.scheme}://{parts.netloc}"
    rest = value[len(prefix) :]
    if value[: len(prefix)].lower() != prefix.lower() or not EMBED_PATH.match(rest):
        return value

    return rest


def _remap_text(text: str, mapping: dict[str, str], hosts: frozenset) -> str:
    """Rewrite only the value of each picture attribute in a real start tag."""
    pieces: list[str] = []
    last = 0
    for start, end, name, value in media_values(text):
        pieces += [text[last:start], rewritten_attribute(name, value, mapping, hosts)]
        last = end

    pieces.append(text[last:])
    return "".join(pieces)


def _decoded(content: str | None) -> bytes | None:
    if not content:
        return None
    try:
        raw = base64.b64decode(content, validate=True)
    except (ValueError, binascii.Error) as undecodable:
        raise UnreadableBody from undecodable
    return raw or None


def _loaded(raw: bytes):
    document = pycrdt.Doc()
    fragment = pycrdt.XmlFragment()
    document[BODY_FRAGMENT] = fragment
    document.apply_update(raw)
    return document, fragment


def _elements(fragment):
    stack = list(fragment.children)
    while stack:
        node = stack.pop()
        if isinstance(node, pycrdt.XmlElement):
            yield node
            stack.extend(node.children)


@contextmanager
def _readable():
    try:
        yield
    except (KeyboardInterrupt, SystemExit, UnreadableBody):
        raise
    except BaseException as unreadable:
        raise UnreadableBody from unreadable
