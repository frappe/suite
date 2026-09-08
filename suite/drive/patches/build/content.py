"""Link content documents, adopt orphans, and map preserved shares."""

from suite.drive._core.roles import MANAGE
from suite.drive.patches.build.content_mapping import (
    InvalidLegacyContent,
    docshare_role,
    exact_fields,
    expected_node,
)
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.mapping import GENERAL, merged_role
from suite.drive.patches.build.ports import ACTIVE, PERSONAL, REMOVED, TRASHED
from suite.drive.patches.build.root_pairs import ARCHIVED
from suite.drive.patches.build.titles import SiblingTitles

MIMES = {
    "Writer Document": "frappe/writer",
    "Presentation": "frappe/slides",
    "Sheet": "frappe/sheet",
}

# The counters this phase owns. Every other value in `ContentConversion`
# belongs to the history or slides phase and must survive a link rerun.
LINK_FIELDS = (
    "links_completed",
    "documents_seen",
    "trash_disagreements",
    "orphan_content_docs_adopted",
    "link_title_renames",
    "docshare_rows_dropped",
)

# Plan §6's whole orphan mapping row. §13 forbids blessing a target "because
# only its primary key exists", so a rerun compares every mapped field: a node
# in the wrong root, with the wrong mime, or flagged `is_template` is refused.
ORPHAN_FIELDS = (
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


class BuildContentError(RuntimeError):
    """A source document cannot be linked without inventing identity."""


def link_content_documents(env, *, batch_size: int = BUILD_BATCH_SIZE):
    """Implement §14.2 step 10, then drain deferred history.

    §4 gives this phase two jobs: adopt orphans, and rerun history conversion
    for the nodes it adopted. Step 8 runs first and owns templates and Slide
    media. Both template kinds reach this loop with no `File` row, so neither
    is an orphan: this phase validates the link step 8 left and refuses a
    template with no node, with bounded evidence rather than a conversion.
    """
    if not env.state.tree().completed or not env.state.grants().completed:
        raise BuildContentError("ticket 27 tree and grants must complete first")
    source, target = _ports(env)
    result = env.state.content()
    result.begin_phase("links", LINK_FIELDS)
    link_renames = 0
    writes = 0

    def reserve(target_rows):
        nonlocal writes
        if writes and writes + target_rows > batch_size:
            target.commit()
            env.state.put_content(result)
            writes = 0
        writes += target_rows

    for doctype in MIMES:
        after = ""
        while True:
            rows = source.documents(doctype, after, batch_size)
            if not rows:
                break
            for row in rows:
                result.documents_seen += 1
                try:
                    adopted, renamed, disagreement = _link_one(env, row, reserve)
                except InvalidLegacyContent as error:
                    # `_fail` raises today. The `continue` keeps the three
                    # names below from depending on that for their binding.
                    _fail(env, result, f"{doctype}:{row.name}", str(error))
                    continue
                result.orphan_content_docs_adopted += int(adopted)
                link_renames += int(renamed)
                result.trash_disagreements += int(disagreement)
                if writes >= batch_size:
                    target.commit()
                    env.state.put_content(result)
                    writes = 0
            after = rows[-1].name
            if len(rows) < batch_size:
                break
    if writes:
        target.commit()

    result.link_title_renames = link_renames
    result.title_renames = result.template_title_renames + result.link_title_renames
    env.state.put_content(result)

    # Plan §7: the share mapper runs once templates and orphan links exist, so
    # an absent target means an unmigrated entity rather than phase ordering.
    #
    # `links_completed` stays False until the mapper returns. Set before it, a
    # kill inside the mapper leaves a record that claims step 10 finished with
    # no content share mapped, and §14.2 lets a rerun skip a complete record.
    _convert_content_shares(env, result, batch_size)
    result.links_completed = True
    env.state.put_content(result)

    from suite.drive.patches.build.history import convert_history_and_comments

    result = convert_history_and_comments(env, batch_size=batch_size, allow_deferred=False)
    result.links_completed = True
    result.completed = result.history_completed and result.slides_completed and result.links_completed
    env.state.put_content(result)
    return result


def _link_one(env, row, reserve) -> tuple[bool, bool, bool]:
    target = env.content_target
    files = env.content.files_for_content(row.doctype, row.name)
    nodes = target.content_nodes(row.doctype, row.name)

    if files:
        if len(files) != 1:
            raise InvalidLegacyContent("more than one File claims this content document")
        file = files[0]
        if file.status == REMOVED:
            raise InvalidLegacyContent("a Removed File still claims this content document")
        stored = target.nodes((file.name,)).get(file.name)
        if not stored:
            raise InvalidLegacyContent("the content File did not produce a Drive Node")
        _validate_content_node(stored, row, file.name)
        if len(nodes) != 1 or nodes[0]["name"] != file.name:
            raise InvalidLegacyContent("the content pair is absent or claimed by multiple nodes")
        if row.doctype == "Sheet":
            expected_trash = (file.status or ACTIVE) == TRASHED
            disagreement = bool(row.trashed) != expected_trash
        else:
            disagreement = False
        if row.node and row.node != file.name:
            raise InvalidLegacyContent("the document points at another Drive Node")
        if not row.node:
            reserve(1)
            target.write_content_link(row.doctype, row.name, file.name)
        return False, False, disagreement

    if row.doctype == "Presentation" and row.is_template:
        # Plan §6: a template took the separate template path in step 8. Step 10
        # only validates the link it left behind.
        if not row.node:
            raise InvalidLegacyContent("a Presentation template has no template node")
        if len(nodes) != 1 or nodes[0]["name"] != row.node:
            raise InvalidLegacyContent("a Presentation template has a broken reciprocal link")
        return False, False, False

    if len(nodes) > 1:
        raise InvalidLegacyContent("multiple Drive Nodes claim this orphan")
    stored = nodes[0] if nodes else None
    if row.node and not stored:
        raise InvalidLegacyContent("the orphan names a missing Drive Node")
    if row.node and row.node != stored["name"]:
        raise InvalidLegacyContent("the orphan points at another Drive Node")
    if stored is not None and stored.get("is_template"):
        # §14.7: step 8 mints a `Writer Document` for every `Writer Template`
        # and puts its node under `Templates` in Administrator's Personal Root.
        # That document has no `File` row, so it reaches this loop, but it is
        # not an orphan: re-deriving it here would refuse the template node
        # step 8 wrote and adopting it would move it to its owner's root.
        _validate_template_link(env, row, stored)
        return False, False, False
    if not row.owner:
        raise InvalidLegacyContent("the orphan has no owner for a Personal Root")
    if not stored and target.nodes((row.name,)):
        # Plan §6: refuse an unrelated target collision. Left to the insert it
        # is an `IntegrityError` from `bulk_insert`, raised inside the savepoint
        # and outside `except InvalidLegacyContent`, so the run dies with no
        # bounded evidence.
        raise InvalidLegacyContent("an unrelated Drive Node already holds this content id")

    root = _ensure_personal_root(env, row.owner, reserve)
    node, renamed = _orphan_node(env, row, root)
    if stored:
        exact_fields(stored, node, ORPHAN_FIELDS, f"orphan node {row.name}")
        if not row.node:
            reserve(1)
            target.write_content_link(row.doctype, row.name, stored["name"])
        return True, renamed, False
    reserve(2)
    target.write_orphan(node, row.doctype, row.name)
    return True, renamed, False


def _validate_template_link(env, row, stored) -> None:
    """Accept a template document only on evidence from its own source row.

    A flag on the target is not evidence. `Writer Template` and
    `Presentation.is_template` are the rows §14.7 converts, and they stay
    readable until Cleanup, so a node flagged `is_template` that no template
    row explains is a target collision and is refused.
    """
    if row.doctype == "Presentation":
        if not row.is_template:
            raise InvalidLegacyContent("a template node claims a Presentation that is not a template")
        return
    if row.doctype != "Writer Document" or not env.content.writer_document_is_template(row.name):
        raise InvalidLegacyContent(f"a template node claims {row.doctype} {row.name}, which is not one")


def _orphan_node(env, row, root) -> tuple[dict, bool]:
    """Plan §6's orphan mapping row, re-derived the same way on every run."""
    state = TRASHED if row.doctype == "Sheet" and row.trashed else ACTIVE
    source_title = row.title or ("Untitled Document" if row.doctype == "Writer Document" else row.name)
    title = source_title
    if state == ACTIVE:
        # A Trashed sibling holds no title reservation and restore re-dedupes
        # (titles.py, §14.4), which is why ticket 27's tree skips the deduper
        # for a Trashed row. This node is excluded from its own sibling group,
        # so a rerun derives the same title and reports the same rename.
        siblings = env.content_target.child_nodes(root)
        titles = SiblingTitles(
            {
                child.get("title")
                for child in siblings
                if child.get("state") == ACTIVE and child.get("name") != row.name
            }
        )
        title = titles.claim(source_title)
    trashed_at = (row.trashed_on or row.modified or row.creation) if state == TRASHED else None
    node = expected_node(
        row,
        name=row.name,
        title=title,
        parent=root,
        root=root,
        path="",
        mime=MIMES[row.doctype],
        state=state,
        trashed_at=trashed_at,
        trash_root=row.name if state == TRASHED else None,
    )
    return node, title != source_title


def _ensure_personal_root(env, user: str, reserve=lambda _rows: None) -> str:
    target = env.content_target
    # Lock the identity before the read, the way `_core/roots.py` and ticket
    # 27 both do. Read first and a root committed between the read and the
    # write leaves the user with two Active Personal Roots, which §3.2 bars
    # and no later run can repair.
    target.lock_root_identity(user)
    found = target.active_roots(user)
    if len(found) > 1:
        raise InvalidLegacyContent(f"user {user} has multiple Active Personal Roots")
    if found:
        node = target.nodes((found[0],)).get(found[0])
        metadata = target.root_metadata(found[0])
        expected = {
            "name": found[0],
            "node": found[0],
            "user": user,
            "kind": PERSONAL,
            "state": ACTIVE,
        }
        if not node or not metadata or node.get("kind") != "root":
            raise InvalidLegacyContent(f"user {user} has an incomplete Personal Root")
        exact_fields(metadata, expected, tuple(expected), f"Personal Root {found[0]}")
        return found[0]

    existing = target.personal_roots(user)
    if len(existing) > 1:
        raise InvalidLegacyContent(f"user {user} has multiple Personal Roots")
    if existing:
        node = target.nodes(existing).get(existing[0])
        metadata = target.root_metadata(existing[0])
        if not node or not metadata or node.get("kind") != "root":
            raise InvalidLegacyContent(f"user {user} has an incomplete Personal Root")
        # Ticket 27 archives a Personal root whose legacy `Users/<email>` folder
        # was Trashed, whatever the User row says (`root_pairs.py:220-226`), so
        # the stored state is accepted here. The enabled rule below applies only
        # to the root Build creates itself.
        expected = {
            "name": existing[0],
            "node": existing[0],
            "user": user,
            "kind": PERSONAL,
        }
        exact_fields(metadata, expected, tuple(expected), f"Personal Root {existing[0]}")
        return existing[0]

    stamp = env.now()
    name = env.new_id()
    enabled = env.content.user_enabled(user)
    node = {
        "name": name,
        "title": user,
        "parent": None,
        "root": None,
        "path": "",
        "kind": "root",
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
        "owner": user,
        "creation": stamp,
        "modified": stamp,
        "modified_by": user,
        "docstatus": 0,
        "idx": 0,
    }
    metadata = {
        "name": name,
        "node": name,
        "user": user,
        "kind": PERSONAL,
        "state": ACTIVE if enabled else ARCHIVED,
        "quota_bytes": 0,
        "used_bytes": 0,
        "acl_generation": 0,
        "owner": user,
        "creation": stamp,
        "modified": stamp,
        "modified_by": user,
        "docstatus": 0,
        "idx": 0,
    }
    grants = [_grant_row(env, name, user, MANAGE)] if enabled is not None else []
    reserve(2 + len(grants))
    target.write_root_pair(node, metadata, grants)
    return name


def _convert_content_shares(env, result, batch_size):
    target = env.content_target
    pending = {}
    after = ""
    while True:
        rows = env.content.content_shares(after, batch_size)
        if not rows:
            break
        for row in rows:
            if row.share_doctype not in ("Writer Document", "Presentation"):
                result.docshare_rows_dropped += 1
                continue
            nodes = target.content_nodes(row.share_doctype, row.share_name)
            if len(nodes) != 1:
                result.docshare_rows_dropped += 1
                continue
            role = docshare_role(row)
            if role is None:
                result.docshare_rows_dropped += 1
                continue
            principal = GENERAL if row.everyone else row.user
            if not principal or (not row.everyone and env.content.user_enabled(principal) is None):
                result.docshare_rows_dropped += 1
                continue
            key = (nodes[0]["name"], principal)
            pending[key] = merged_role(pending.get(key), role)
            if len(pending) >= batch_size:
                _flush_grants(env, pending)
                pending = {}
                env.state.put_content(result)
        after = rows[-1].name
        if len(rows) < batch_size:
            break
    _flush_grants(env, pending)


def _flush_grants(env, pending):
    target = env.content_target
    # One read for the whole batch, not one per `(node, principal)` pair and
    # not one per node: a site with 200k content shares would otherwise pay a
    # round trip for every document it shares.
    stored = target.grant_pairs(tuple(pending))
    fresh = []
    for key, role in pending.items():
        node, principal = key
        if key not in stored:
            fresh.append(_grant_row(env, node, principal, role))
            continue
        wanted = merged_role(stored[key], role)
        if wanted != stored[key]:
            target.set_grant_role(node, principal, wanted)
    target.insert_grants(fresh)
    if pending:
        target.commit()


def _grant_row(env, node, principal, role):
    stamp = env.now()
    return {
        "name": env.new_id(),
        "node": node,
        "principal": principal,
        "role": role,
        "expires_on": None,
        "password_hash": None,
        "owner": "Administrator",
        "creation": stamp,
        "modified": stamp,
        "modified_by": "Administrator",
        "docstatus": 0,
        "idx": 0,
    }


def _validate_content_node(node, row, name):
    expected = {
        "name": name,
        "kind": "document",
        "content_doctype": row.doctype,
        "content_docname": row.name,
    }
    exact_fields(node, expected, tuple(expected), f"content node {name}")


def _ports(env):
    if env.content is None or env.content_target is None:
        raise RuntimeError("Build content ports are not configured")
    return env.content, env.content_target


def _fail(env, result, source, reason):
    result.record_issue(source, reason, phase="links")
    env.state.put_content(result)
    raise BuildContentError(f"{source}: {reason}")
