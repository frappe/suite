"""§14.6 and §14.7: make legacy Writer bodies readable by the new Writer.

Build changes a Writer body in two ways and touches nothing else:

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
  Build wraps each such image in its own paragraph instead.

Three callers, one `DocumentPictures` per document:

- Step 7 calls `convert_writer_body` once per Writer document, before its
  history, and rewrites the live body (the Yjs `content` and the `html`).
- Step 7 then passes each page of that document's `Writer Version` rows to
  `writer_version_html`. A version can show a picture the live body no
  longer shows, so its ids are mapped too, with the same copies: a version
  shown or restored after Build names the document's own node. Only the id
  inside each picture reference changes. Version bytes are HTML, which the
  editor parses with ProseMirror's `DOMParser`; that wraps loose inline
  content itself, so B113 needs no rewrite there.
- Step 8 calls `convert_template_body` for each `Writer Template` before it
  writes the template's document, so the template node gets its own copies
  and every document made from the template names pictures it can read.
  Step 8 validates a stored template document against this rewritten body.

## Why this module reads Writer bodies itself

`suite/writer/drive.py` already reads and remaps media ids, but Drive code
may not import a content product (`suite/tests/test_architecture.py`), and
Build is Drive code. The three spellings below are therefore a copy of
`suite.writer.drive.MEDIA_PATTERNS`, and the two must change together.

Every pycrdt call runs inside `_readable()`. A body pycrdt cannot read
raises `pyo3_runtime.PanicException`, which derives from `BaseException`.
An unreadable body is reported and left exactly as it is: the runtime falls
back to a raw scan for such a body, and Build has no better reading of it.
"""

import base64
import binascii
import re
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass

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

IMAGE = "image"
PARAGRAPH = "paragraph"
# The parents an image may sit in directly. `paragraph` and `heading` hold
# inline content and `imageGroup` holds `image+`. A `codeBlock` holds only
# text, so a paragraph inside it would be just as invalid, and an image there
# is left alone. Every other parent, the root fragment included, accepts only
# blocks.
IMAGE_PARENTS = frozenset({"paragraph", "heading", "imageGroup", "codeBlock"})

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
        copies = pictures.claim(_html_ids(body.html or "") | _body_ids(body.content))
        rewrite = _rewritten(body, pictures.mapping)
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
    inside each picture reference changes; every other byte is the source's.
    """
    copies = pictures.claim(set().union(*(_html_ids(text) for text in snapshots)))
    if copies:
        target = env.content_target
        target.insert_nodes(copies)
        target.commit()
        content.writer_media_copied += len(copies)
    if not pictures.mapping:
        return list(snapshots)
    rewritten = [_remap_text(text, pictures.mapping) for text in snapshots]
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
    copies = pictures.claim(_html_ids(body.html or "") | _body_ids(body.content))
    rewrite = _rewritten(body, pictures.mapping)
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


def _rewritten(body: WriterBody, mapping: dict[str, str]) -> _Rewrite | None:
    """The body with `mapping` applied and loose images wrapped, or None.

    None means nothing changed, so a body that is already valid and names
    only its own pictures is never written.
    """
    html = _remap_text(body.html, mapping) if body.html and mapping else body.html
    content, wrapped = _rewritten_content(body.content, mapping)
    if content == body.content and html == body.html:
        return None
    return _Rewrite(WriterBody(content=content, html=html), wrapped)


def _rewritten_content(content: str | None, mapping: dict[str, str]) -> tuple[str | None, int]:
    raw = _decoded(content)
    if raw is None:
        return content, 0
    with _readable():
        document, fragment = _loaded(raw)
        changed = False
        with document.transaction():
            if mapping:
                for element in _elements(fragment):
                    for key, value in dict(element.attributes).items():
                        if not isinstance(value, str):
                            continue
                        rewritten = (
                            mapping.get(value, value)
                            if key == NODE_ATTRIBUTE
                            else _remap_text(value, mapping)
                        )
                        if rewritten != value:
                            element.attributes[key] = rewritten
                            changed = True
            wrapped = _wrap_loose_images(fragment)
        if not changed and not wrapped:
            return content, 0
        return base64.b64encode(document.get_update()).decode("ascii"), wrapped


def _wrap_loose_images(fragment) -> int:
    """Put every image whose parent accepts only blocks in its own paragraph.

    One paragraph per image, so pictures that stood one under another still
    do. The replacement carries every attribute the image had. Yjs has no
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


def _html_ids(text: str) -> set[str]:
    return {match.group(1) for pattern in MEDIA_PATTERNS for match in pattern.finditer(text)}


def _body_ids(content: str | None) -> set[str]:
    """The ids the live attributes name. Deleted content is never read."""
    raw = _decoded(content)
    if raw is None:
        return set()
    found: set[str] = set()
    with _readable():
        _, fragment = _loaded(raw)
        for element in _elements(fragment):
            for key, value in dict(element.attributes).items():
                if not isinstance(value, str):
                    continue
                # `data-node` holds the bare id, with the attribute name held
                # apart from it, so the patterns alone never see it here.
                if key == NODE_ATTRIBUTE and BARE_MEDIA_ID.fullmatch(value):
                    found.add(value)
                else:
                    found |= _html_ids(value)
    return found


def _remap_text(text: str, mapping: dict[str, str]) -> str:
    """Replace only the id inside each match, never the rest of the URL."""

    def swap(match: re.Match) -> str:
        replacement = mapping.get(match.group(1))
        if replacement is None:
            return match.group(0)
        start, end = match.start(1) - match.start(), match.end(1) - match.start()
        return match.group(0)[:start] + replacement + match.group(0)[end:]

    for pattern in MEDIA_PATTERNS:
        text = pattern.sub(swap, text)
    return text


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
