"""Convert Writer and Presentation templates into Drive documents."""

from typing import NamedTuple

from suite.drive._core.nodes import child_path
from suite.drive._core.roles import MANAGE, READ
from suite.drive.patches.build.content import _ensure_personal_root, _grant_row
from suite.drive.patches.build.content_mapping import (
    InvalidLegacyContent,
    compact_settings,
    exact_fields,
    expected_node,
    standard_fields,
)
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.mapping import GENERAL
from suite.drive.patches.build.ports import ACTIVE
from suite.drive.patches.build.titles import SiblingTitles

ADMINISTRATOR = "Administrator"
# The counters this phase owns. Every other value in `ContentConversion`
# belongs to the links or slides phase and must survive a template rerun.
TEMPLATE_FIELDS = (
    "template_nodes_created",
    "writer_templates_converted",
    "template_title_renames",
)
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
    "url",
    "content_doctype",
    "content_docname",
    "state",
    "trashed_at",
    "trash_root",
    "content_modified",
    "is_template",
    "owner",
    "creation",
    "modified",
    "modified_by",
)
WRITER_FIELDS = (
    "name",
    "node",
    "content",
    "html",
    "settings",
    "collab",
    "owner",
    "creation",
    "modified",
    "modified_by",
)


class BuildTemplateError(RuntimeError):
    """A template target collision prevents exact conversion."""


class Place(NamedTuple):
    """Where a template node sits: parent folder, root, and canonical path."""

    folder: str
    root: str
    path: str


def convert_templates(env, *, batch_size: int = BUILD_BATCH_SIZE, result=None) -> str:
    """Create the shared template folder and exact template documents.

    `result` is the caller's live `ContentConversion`. A caller that loaded
    its own copy first must pass it: loading a second copy here and saving it
    is overwritten when the caller saves its older instance, and every
    template counter then reports zero.
    """
    source, target = _ports(env)
    owned = result is None
    result = env.state.content() if owned else result
    result.begin_phase("templates", TEMPLATE_FIELDS)
    place = _folder_place(target, _templates_folder(env))
    templates = _template_rows(source, batch_size)
    template_ids = {row.name for _kind, row in templates}
    siblings = target.child_nodes(place.folder)
    titles = SiblingTitles(
        {
            row["title"]
            for row in siblings
            if row.get("state") == ACTIVE and row.get("name") not in template_ids
        }
    )
    created = 0
    seen = 0
    renamed = 0

    for kind, row in templates:
        # `Presentation.title` is `reqd=0`, so NULL is a real source value and
        # `SiblingTitles.claim` would subscript it. Plan §6 falls back to the
        # source id for a content document with no title.
        source_title = row.title or row.name
        title = titles.claim(source_title)
        renamed += int(title != source_title)
        if kind == "writer":
            seen += 1
            created += _writer_template(env, place, row, title)
        else:
            created += _presentation_template(env, place, row, title)
        target.commit()
        env.state.put_content(result)

    result.writer_templates_converted = seen
    result.template_nodes_created = created
    result.template_title_renames = renamed
    result.title_renames = result.link_title_renames + renamed
    if owned:
        env.state.put_content(result)
    return place.folder


def _templates_folder(env) -> str:
    target = env.content_target
    root = _ensure_personal_root(env, ADMINISTRATOR)
    siblings = target.child_nodes(root)
    exact = [row for row in siblings if row.get("state") == ACTIVE and row.get("title") == "Templates"]
    collisions = [
        row
        for row in siblings
        if row.get("state") == ACTIVE and str(row.get("title") or "").casefold() == "templates"
    ]
    if len(exact) > 1 or len(collisions) != len(exact):
        raise InvalidLegacyContent("Administrator root has an ambiguous Templates title")
    if exact:
        row = exact[0]
        expected = {
            "title": "Templates",
            "parent": root,
            "root": root,
            "path": "",
            "kind": "folder",
            "blob": None,
            "size": 0,
            "mime": None,
            "url": None,
            "content_doctype": None,
            "content_docname": None,
            "state": ACTIVE,
            "trashed_at": None,
            "trash_root": None,
            "is_template": 0,
        }
        exact_fields(row, expected, tuple(expected), "Templates folder")
        return row["name"]

    stamp = env.now()
    name = env.new_id()
    node = {
        "name": name,
        "title": "Templates",
        "parent": root,
        "root": root,
        "path": "",
        "kind": "folder",
        "blob": None,
        "size": 0,
        "mime": None,
        "url": None,
        "content_doctype": None,
        "content_docname": None,
        "state": ACTIVE,
        "trashed_at": None,
        "trash_root": None,
        "content_modified": stamp,
        "is_template": 0,
        "owner": ADMINISTRATOR,
        "creation": stamp,
        "modified": stamp,
        "modified_by": ADMINISTRATOR,
        "docstatus": 0,
        "idx": 0,
    }
    target.insert_nodes([node])
    target.commit()
    return name


def _writer_template(env, place, row, title) -> int:
    target = env.content_target
    _valid_owner(env, row.owner)
    document = {
        "name": row.name,
        "node": row.name,
        "content": "AAA=",
        "html": row.content or "",
        "settings": compact_settings(row.keymap),
        "collab": 0,
        **standard_fields(row),
    }
    node = {
        "name": row.name,
        "title": title,
        "parent": place.folder,
        "root": place.root,
        "path": place.path,
        "kind": "document",
        "blob": None,
        "size": 0,
        "mime": "frappe/writer",
        "url": None,
        "content_doctype": "Writer Document",
        "content_docname": row.name,
        "state": ACTIVE,
        "trashed_at": None,
        "trash_root": None,
        "content_modified": row.modified,
        "is_template": 1,
        **standard_fields(row),
    }
    found_doc = target.writer_document(row.name)
    found_node = target.nodes((row.name,)).get(row.name)
    repair = ""
    if found_doc:
        # Plan §10: repair a blank reciprocal link once both rows match, and
        # refuse a link that names anything else. The Presentation path already
        # does this, so a stopped run must not strand the Writer path.
        repair = row.name if not found_doc.get("node") else ""
        fields = tuple(name for name in WRITER_FIELDS if name != "node") if repair else WRITER_FIELDS
        exact_fields(found_doc, document, fields, f"Writer template document {row.name}")
    if found_node:
        exact_fields(found_node, node, NODE_FIELDS, f"Writer template node {row.name}")
    grants = _missing_template_grants(env, row.name, row.owner)
    target.write_writer_template(
        None if found_doc else document,
        None if found_node else node,
        grants,
        link=repair,
    )
    return 1


def _presentation_template(env, place, row, title) -> int:
    target = env.content_target
    _valid_owner(env, row.owner)
    node = expected_node(
        row,
        name=row.name,
        title=title,
        parent=place.folder,
        root=place.root,
        path=place.path,
        mime="frappe/slides",
        is_template=1,
    )
    found = target.nodes((row.name,)).get(row.name)
    if found:
        exact_fields(found, node, NODE_FIELDS, f"Presentation template node {row.name}")
    if row.node and row.node != row.name:
        raise InvalidLegacyContent(f"Presentation template {row.name} links another node")
    grants = _missing_template_grants(env, row.name, row.owner)
    target.write_presentation_template(row.name, None if found else node, grants)
    return 1


def _missing_template_grants(env, node, owner) -> list[dict]:
    wanted = {GENERAL: READ}
    if owner != ADMINISTRATOR:
        wanted[owner] = MANAGE
    stored = env.content_target.grant_roles(node, tuple(wanted))
    rows = []
    for principal, role in wanted.items():
        if principal in stored:
            if stored[principal] != role:
                raise InvalidLegacyContent(f"template {node} has a conflicting {principal} grant")
        else:
            rows.append(_grant_row(env, node, principal, role))
    return rows


def _valid_owner(env, owner):
    if not owner:
        raise InvalidLegacyContent("template has no owner")
    if owner != ADMINISTRATOR and env.content.user_enabled(owner) is None:
        raise InvalidLegacyContent(f"template owner {owner} has no User row")


def _folder_place(target, folder) -> Place:
    """Read the folder once and derive the exact path its children must carry.

    `drive_node.py:80` recomputes a child path from its parent on every save,
    so a hand-built string that omits the leading slash makes `_validate_chain`
    throw and makes the `path LIKE CONCAT('%/', node, '/%')` ancestor-grant
    and `revoke_below` queries skip every template node.
    """
    node = target.nodes((folder,)).get(folder)
    if not node or not node.get("root"):
        raise InvalidLegacyContent("Templates folder is unavailable")
    return Place(folder, node["root"], child_path(node))


def _ports(env):
    if env.content is None or env.content_target is None:
        raise RuntimeError("Build content ports are not configured")
    return env.content, env.content_target


def _template_rows(source, batch_size):
    found = []
    after = ""
    while True:
        rows = source.writer_templates(after, batch_size)
        found.extend(("writer", row) for row in rows)
        if len(rows) < batch_size:
            break
        after = rows[-1].name
    after = ""
    while True:
        rows = source.documents("Presentation", after, batch_size)
        found.extend(("presentation", row) for row in rows if row.is_template)
        if len(rows) < batch_size:
            break
        after = rows[-1].name
    return sorted(found, key=lambda item: (str(item[1].creation or ""), item[1].name, item[0]))
