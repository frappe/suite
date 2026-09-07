"""§14.2 step 5 and §14.4: the node trees, walked from each root by depth.

The walk goes down, one level at a time. Depth order is not a preference:
a node's `path` is built from its parent's, and its trash stamp is
inherited from the nearest Trashed ancestor, so the parent has to be
decided before the child can be.

Three things are decided per row, and all three are decided from the
**source** rows alone:

- **place** — `parent`, `root`, and the root-relative `path` (§14.3, §14.4).
  A direct child of a root carries `parent = root_node_id` and `path = ""`;
  everything deeper stores the ids of its ancestors below the root.
- **trash** — a Trashed row is its own trash root; an Active row under one
  copies the stamp of the *nearest* Trashed ancestor (§14.4). A row trashed
  earlier under a later-trashed folder keeps its own earlier stamp, which is
  what makes restore put back only what one act took away (§8.8).
- **title** — Active siblings sharing a title are deduped, oldest first.
  Trashed siblings are left alone.

Deciding from the source is what makes a rerun safe. Nothing reads back a
title Build already wrote, so an interrupted run resumes to the same answer
it would have reached in one pass, and the §14.9 counters a rerun prints
are the state of the migration rather than the diary of one attempt.

What the walk cannot see, a read-only census picks up afterwards. The walk
only meets rows it can reach; §14.4 also has to report the rows it cannot
("Broken chains are skipped and reported") and the Removed subtrees it
refused. `take_census` walks those rows' `folder` chains upward instead,
which is the only direction that can tell a dangling link from a row that
simply belongs to frappe.
"""

from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import (
    ACTIVE,
    DRIVE_ROOT_ROW,
    REMOVED,
    TRASHED,
    USERS_ROW,
    TreeRow,
)
from suite.drive.patches.build.root_pairs import RootPlan
from suite.drive.patches.build.state import SkippedRow, TitleRename, TreeConversion
from suite.drive.patches.build.titles import SiblingTitles, order_key

# §3.1, and the literal in `DriveNode._validate_tree_position`,
# `nodes._validate_move_depth`, and `nodes._validate_purge_root`. There is no
# named constant in the engine to import.
DEPTH_CAP = 40

# `Drive Node.path` is `varchar(500)` (§3.1). The spec's own estimate is 441
# characters at depth 40 with 10-char ids and asks for the real maximum to be
# validated on the target database, which is what `max_path_length` records.
PATH_CAPACITY = 500

# `Drive Node.url` is `varchar(500)`. `File.file_url` is a `Code` field, so
# the legacy column is unbounded and is the one source column wider than its
# target.
URL_CAPACITY = 500

# Containers, per `DriveNode._validate_tree_position`: "A Drive node parent
# must be a container". A `document` node may hold children (§3.1); a `file`
# or a `link` may not.
CONTAINER_KINDS = ("root", "folder", "document")

# §14.4: a row that names one of these content doctypes becomes a `document`
# node carrying the reference. `File` is the adopted library attachment
# (`suite/drive/utils/__init__.py:16`), and its link is dropped instead.
DOCUMENT_DOCTYPES = ("Writer Document", "Presentation", "Sheet")
ATTACHMENT_DOCTYPE = "File"

# How many parents one children query names at once. `folder IN (...)` with
# a whole level in it is a query no planner enjoys and some backends refuse.
PARENT_CHUNK = 200


class _Context:
    """What a parent hands its children: place, trash, and depth."""

    __slots__ = ("child_path", "depth", "kind", "node", "root", "trash_root", "trashed_at")

    def __init__(self, node, root, child_path, depth, kind, trash_root=None, trashed_at=None):
        self.node = node
        self.root = root
        self.child_path = child_path
        self.depth = depth
        self.kind = kind
        self.trash_root = trash_root
        self.trashed_at = trashed_at


def convert_trees(env, tree: TreeConversion, plans, *, batch_size: int = BUILD_BATCH_SIZE) -> None:
    """Walk every root by depth and write its nodes. Resumable per batch."""
    refuse_incomplete(env, plans)
    for plan in plans:
        _walk_root(env, tree, plan, batch_size)
    take_census(env, tree, batch_size=batch_size)


def _walk_root(env, tree: TreeConversion, plan: RootPlan, batch_size: int) -> None:
    """Breadth-first from one root node, one level per pass."""
    # A root node contributes no id to `path` (§3.1: "The root id stays
    # outside `path`"), so its children start at depth 1 with an empty path.
    level = {plan.node: _Context(plan.node, plan.node, "", 0, "root")}
    batch = _Batch(env, tree, batch_size)
    while level:
        level = _convert_level(env, tree, level, batch)
    batch.flush()


def _convert_level(env, tree: TreeConversion, level: dict, batch) -> dict:
    """Convert every child of one level; answer the next level's contexts."""
    contexts: dict[str, _Context] = {}
    parents = sorted(level)
    for start in range(0, len(parents), PARENT_CHUNK):
        chunk = tuple(parents[start : start + PARENT_CHUNK])
        for folder, rows in _sibling_groups(env, chunk, batch.size):
            contexts.update(_convert_siblings(env, tree, level[folder], rows, batch))
    return contexts


def _sibling_groups(env, parents: tuple[str, ...], batch_size: int):
    """Page children of `parents`, yielding one whole sibling group at a time.

    Ordering by `(folder, name)` is what makes a group arrive together, and
    a group has to be whole before it can be deduped: the oldest sibling
    keeps the plain title, and "oldest" is not knowable from half a page.

    The open group is carried across pages rather than re-queried, so the
    only thing held in memory is one folder's children.
    """
    after = ("", "")
    previous_page = None
    open_folder = None
    open_rows: list[TreeRow] = []
    while True:
        rows = env.tree.children(parents, after, batch_size)
        if not rows:
            break
        # Keyset paging already rules out a repeated page; this catches a
        # `LegacyTree` that ignores `after`, where the loop would never end.
        if (rows[0].folder, rows[0].name) == previous_page:
            raise RuntimeError(f"the File cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = (rows[0].folder, rows[0].name)
        for row in rows:
            if row.folder != open_folder:
                if open_rows:
                    yield open_folder, open_rows
                open_folder, open_rows = row.folder, []
            open_rows.append(row)
        after = (rows[-1].folder or "", rows[-1].name)
        if len(rows) < batch_size:
            break
    if open_rows:
        yield open_folder, open_rows


def _convert_siblings(env, tree: TreeConversion, parent: _Context, rows: list[TreeRow], batch) -> dict:
    """Convert one whole sibling group and answer the contexts it produces."""
    if parent.kind not in CONTAINER_KINDS:
        # A legacy row named a file or a link as its `folder`. The engine
        # refuses that parent, so the subtree cannot be represented at all.
        for row in rows:
            tree.invalid_parent_skipped += 1
            tree.record_skip(
                SkippedRow(row.name, f"parent {parent.node} is a {parent.kind}, not a container")
            )
        return {}

    contexts: dict[str, _Context] = {}
    taken = SiblingTitles()
    # Trashed siblings hold no title (§14.4), so they are decided first and
    # take no name out of the Active group's pool.
    ordered = sorted(rows, key=order_key)
    decided = [(row, _trash_stamp(row, parent)) for row in ordered]

    for row, stamp in decided:
        if row.status == REMOVED:
            # §14.4: Removed rows and everything below them are not
            # migrated. The census counts the subtree; descending here to
            # count it would read the same rows twice.
            continue
        if not _within_capacity(tree, parent, row):
            continue
        if not _representable(tree, row):
            continue

        title = (row.file_name or "").strip() or row.name
        if stamp is None:
            claimed = taken.claim(title)
            if claimed != title:
                tree.record_rename(TitleRename(row.name, title, claimed))
            title = claimed

        node = _node_row(row, parent, title, stamp)
        _measure(tree, node)
        if node["kind"] == "file" and not node["blob"]:
            # §14.1: a row whose bytes could not be reached becomes a node
            # with no blob. Counted from the row rather than from the write,
            # so a rerun over an already-migrated site answers the same.
            tree.blobless_nodes += 1
        batch.add(node)
        contexts[row.name] = _Context(
            row.name,
            parent.root,
            f"{parent.child_path or '/'}{row.name}/",
            parent.depth + 1,
            node["kind"],
            node["trash_root"],
            node["trashed_at"],
        )
    return contexts


def _trash_stamp(row: TreeRow, parent: _Context):
    """§14.4's trash rule, for one row: its own stamp, or its ancestor's.

    A Trashed row is always its own trash root, even under a Trashed
    ancestor. That is what "the nearest independently trashed ancestor"
    buys: restoring the outer folder is anchored on `(trash_root,
    trashed_at)` (§8.8), so the inner folder somebody trashed a month
    earlier stays in the trash instead of coming back with it.
    """
    if row.status == TRASHED:
        # `file_modified` is the Drive mtime and the moment the trash button
        # was pressed; `modified` is the fallback the legacy read path uses
        # too (`Coalesce(file_modified, modified)`). One of them must be
        # there: a Trashed node with no stamp is a row the engine refuses.
        return (row.name, row.file_modified or row.modified or row.creation)
    if parent.trash_root:
        return (parent.trash_root, parent.trashed_at)
    return None


def _within_capacity(tree: TreeConversion, parent: _Context, row: TreeRow) -> bool:
    """Refuse a node the target column and the depth cap could not hold.

    §3.1 fixes both limits and asks for them to be validated against real
    migrated ids; it names no behaviour for a tree that exceeds them.
    Writing the row anyway would either truncate `path` — silently moving a
    subtree to a different place — or leave a node every later `save` on it
    refuses. Skipping the subtree and counting it is the only option that
    loses nothing quietly.
    """
    depth = parent.depth + 1
    # Measured before the refusal, not after. §3.1 asks for the real
    # maximum on the target database, and a report that only ever said
    # "at most 40" would never tell an operator that the site needed 44.
    tree.max_depth = max(tree.max_depth, depth)
    tree.max_path_length = max(tree.max_path_length, len(parent.child_path))
    if depth > DEPTH_CAP:
        tree.over_capacity_skipped += 1
        tree.record_skip(SkippedRow(row.name, f"depth {depth} is past the cap of {DEPTH_CAP}"))
        return False
    # `path` holds the ancestors below the root, not the node, so a node's
    # own path is exactly what its parent hands down. The row that overflows
    # is therefore the first child of the folder whose path grew too long.
    if len(parent.child_path) > PATH_CAPACITY:
        tree.over_capacity_skipped += 1
        tree.record_skip(
            SkippedRow(row.name, f"path is {len(parent.child_path)} characters, past {PATH_CAPACITY}")
        )
        return False
    return True


def _representable(tree: TreeConversion, row: TreeRow) -> bool:
    """Refuse a row whose target shape the engine would not accept.

    One kind fails this, and it fails it two ways. `_validate_kind_shape`
    refuses a link node with no `url`, and `Drive Node.url` is
    `varchar(500)` while `File.file_url` is a `Code` column with no bound.
    A share URL carrying a query string passes 500 characters without being
    unusual.

    Truncating is not an option: half a URL is a link to somewhere else.
    Writing the row anyway either fails the whole 1000-row batch on the
    insert or leaves a node every later `save` refuses. Skipping it and
    saying so is what loses nothing quietly.
    """
    if _kind(row) != "link":
        return True
    url = row.file_url or ""
    if not url:
        tree.unsaveable_skipped += 1
        tree.record_skip(SkippedRow(row.name, "a link row carries no file_url"))
        return False
    if len(url) > URL_CAPACITY:
        tree.unsaveable_skipped += 1
        tree.record_skip(SkippedRow(row.name, f"url is {len(url)} characters, past {URL_CAPACITY}"))
        return False
    return True


def _measure(tree: TreeConversion, node: dict) -> None:
    """Record the id width the target database has to hold (§3.1).

    Depth and path are measured in `_within_capacity`, where the rows Build
    refused are still in hand.
    """
    tree.max_id_length = max(tree.max_id_length, len(node["name"]))


def _kind(row: TreeRow) -> str:
    """§14.4's kind rules, in the order the spec states them."""
    if row.is_folder:
        return "folder"
    if row.file_type == "Link":
        return "link"
    if row.content_doctype in DOCUMENT_DOCTYPES and row.content_docname:
        return "document"
    return "file"


def _node_row(row: TreeRow, parent: _Context, title: str, stamp) -> dict:
    """§14.4's column map, as one row ready for a bulk insert."""
    kind = _kind(row)
    is_file = kind == "file"
    blob = row.blob if is_file else None
    trash_root, trashed_at = stamp if stamp else (None, None)
    return {
        "name": row.name,
        "title": title,
        # §14.3: a direct child of a root points at the root node, and only
        # a root node has no parent at all.
        "parent": parent.node,
        "root": parent.root,
        # `DriveNode._validate_tree_position` computes the same string as
        # `parent.path + parent.name + "/"`, and "" under a root. That is
        # what the parent's context already holds.
        "path": parent.child_path,
        "kind": kind,
        "blob": blob,
        # §14.4: `file_size` for files, 0 for folders. A folder's legacy
        # `file_size` is the rolled-up total its ancestors kept
        # (`apply_file_size_delta`), and charging it again would double every
        # byte under it in the §14.2 step 12 recompute.
        # `_validate_kind_shape` refuses a file node with no blob that still
        # carries a size or a MIME. §14.1 says a row whose bytes Build could
        # not reach becomes a node with no blob, so those two columns have to
        # go with the blob. Charging a size for bytes that are not there
        # would also double-count them in the §14.2 step 12 recompute.
        "size": int(row.file_size or 0) if (is_file and blob) else 0,
        # `_validate_kind_shape` refuses a file node that has a blob and no
        # MIME. A legacy row can carry bytes and an empty `mime_type`, so
        # the octet-stream fallback keeps the row valid rather than
        # unsaveable.
        "mime": (row.mime_type or "application/octet-stream") if blob else None,
        "url": row.file_url if kind == "link" else None,
        # §14.4: a row with `content_doctype = "File"` is an adopted library
        # attachment. "becomes a plain file node from its own blob; the
        # content link is dropped."
        "content_doctype": row.content_doctype if kind == "document" else None,
        "content_docname": row.content_docname if kind == "document" else None,
        "state": TRASHED if stamp else ACTIVE,
        "trashed_at": trashed_at,
        "trash_root": trash_root,
        "content_modified": row.file_modified or row.modified,
        # §14.7 and [012] §6 own templates. Nothing in the legacy `File`
        # table says a row is one.
        "is_template": 0,
        "owner": row.owner,
        "creation": row.creation,
        "modified": row.modified,
        "modified_by": row.modified_by or row.owner,
        "docstatus": 0,
        "idx": 0,
    }


class _Batch:
    """Node rows on their way to one bulk insert, committed per 1000 (§14.2).

    Rows that already exist are dropped here rather than at the call site,
    so the resume check runs once per batch instead of once per row.
    """

    def __init__(self, env, tree: TreeConversion, size: int):
        self.env = env
        self.tree = tree
        self.size = size
        self.rows: list[dict] = []

    def add(self, row: dict) -> None:
        self.rows.append(row)
        if len(self.rows) >= self.size:
            self.flush()

    def flush(self) -> None:
        if not self.rows:
            return
        existing = self.env.drive.nodes(tuple(row["name"] for row in self.rows))
        fresh = [row for row in self.rows if row["name"] not in existing]
        self.tree.nodes_already_present += len(self.rows) - len(fresh)
        self.env.drive.insert_nodes(fresh)
        self.tree.nodes_written += len(fresh)
        self.rows = []
        # Commit first, then the record. A kill between the two loses one
        # batch of counters and never a row; the other order would report
        # work that rolled back.
        self.env.drive.commit()
        self.env.state.put_tree(self.tree)


def take_census(env, tree: TreeConversion, *, batch_size: int = BUILD_BATCH_SIZE) -> None:
    """Classify every `File` row the walk left without a node. Reads only.

    The walk goes down and therefore never meets an unreachable row, but
    §14.4 has to report two kinds of them: rows whose `folder` chain is
    broken, and rows under something Removed. Both are found by walking the
    chain *upward*, which is the only direction that can tell a dangling
    link from a row that belongs to frappe rather than to Drive.

    Four outcomes, and only the first three are Drive's:

    - the chain dangles or cycles: a broken chain (§14.4);
    - the chain reaches a Drive root and something on it is Removed;
    - the chain reaches a Drive root and nothing explains the absence: a
      subtree the walk refused for depth, an impossible parent, or a shape
      the engine would not hold, and, if none of those apply, a defect the
      report must not hide;
    - the chain terminates cleanly somewhere else: frappe's `Home`, or a
      folder-less row left by an older version of the app. Not Drive's
      tree, so §14.4 does not migrate it and does not count it either.

    A whole page climbs together, one level per round. Walking each row's
    chain on its own would be two single-id queries per hop, and on a site
    where most `File` rows are framework attachments that is a round trip
    for every attachment to conclude it is not Drive's.
    """
    memo: dict[str, tuple[str, bool]] = {}
    after = ""
    previous_page = None
    while True:
        rows = env.tree.unreached(after, batch_size)
        if not rows:
            return
        if rows[0].name == previous_page:
            raise RuntimeError(f"the census cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = rows[0].name
        for row, (kind, removed) in _classify_page(env, rows, memo).items():
            _record(tree, row, kind, removed)
        after = rows[-1].name
        env.state.put_tree(tree)
        if len(rows) < batch_size:
            return


def _record(tree: TreeConversion, name: str, kind: str, removed: bool) -> None:
    if name == USERS_ROW:
        # §14.3 drops the `Users` row itself: it is Drive's index of
        # namespaces, not a folder in one. It has no node on any site, so
        # counting it would put a phantom defect in every report.
        return
    if kind == "broken":
        tree.broken_chains_skipped += 1
        tree.record_skip(SkippedRow(name, "the folder chain does not terminate"))
    elif kind == "drive":
        if removed:
            tree.removed_rows_skipped += 1
        else:
            tree.unmigrated_reachable += 1
            tree.record_skip(SkippedRow(name, "reachable from a Drive root and still has no node"))
    # kind == "outside": frappe's own rows. Not migrated, not counted.


def _classify_page(env, rows, memo: dict) -> dict[str, tuple[str, bool]]:
    """Climb every chain in one page together, two queries per round."""
    # `trail[name]` is the ids this row has passed through, its own first
    # and the nearest ancestor last, each with its own Removed flag. The
    # flags are kept per step rather than as one running boolean because
    # the memo needs "Removed at or above *this* id", not "Removed
    # anywhere on the chain that happened to reach it".
    walking = {row.name: row for row in rows}
    trail = {row.name: [(row.name, row.status == REMOVED)] for row in rows}
    answer: dict[str, tuple[str, bool]] = {}

    while walking:
        _settle(walking, trail, answer, memo)
        if not walking:
            break
        parents = tuple(sorted({row.folder for row in walking.values() if row.folder}))
        migrated = env.drive.nodes(parents) if parents else {}
        unknown = tuple(name for name in parents if name not in migrated)
        found = env.tree.chain(unknown) if unknown else {}
        _advance(walking, trail, answer, memo, migrated, found)
    return answer


def _settle(walking: dict, trail: dict, answer: dict, memo: dict) -> None:
    """Finish every row whose current position already has an answer."""
    for name in list(walking):
        row = walking[name]
        if row.name in memo:
            kind, above = memo[row.name]
            _finish(name, trail, answer, memo, kind, above)
        elif not row.folder:
            # A folder-less row terminates the chain. `Drive` and `Users`
            # are Drive's two; `Home` and anything an older version of the
            # app left behind are not.
            kind = "drive" if row.name in (DRIVE_ROOT_ROW, USERS_ROW) else "outside"
            _finish(name, trail, answer, memo, kind, False)
        else:
            continue
        del walking[name]


def _advance(walking: dict, trail: dict, answer: dict, memo: dict, migrated, found) -> None:
    """Step every unfinished row up one level."""
    for name in list(walking):
        parent_id = walking[name].folder
        if parent_id in migrated:
            # The parent was migrated, so this chain reaches a Drive root.
            # Asked before the `File` read: a migrated ancestor settles the
            # question, and a migrated row is never Removed.
            _finish(name, trail, answer, memo, "drive", False)
        elif parent_id not in found:
            # `folder` names a row that is gone. This is the broken chain
            # §14.4 reports.
            _finish(name, trail, answer, memo, "broken", False)
        elif any(step == parent_id for step, _ in trail[name]):
            # A cycle. `folder` is a plain Link with nothing stopping it.
            _finish(name, trail, answer, memo, "broken", False)
        else:
            parent = found[parent_id]
            walking[name] = parent
            trail[name].append((parent_id, parent.status == REMOVED))
            continue
        del walking[name]


def _finish(name: str, trail: dict, answer: dict, memo: dict, kind: str, above: bool) -> None:
    """Answer one row and memoise every id its chain passed through.

    The memo carries the Removed flag, not just the terminus kind. A
    sibling that meets this chain half way up inherits everything above the
    meeting point, and "is anything at or above me Removed" is exactly what
    §14.4 counts. Dropping it would report a Removed subtree two levels
    down as an unexplained defect instead.

    The trail folds from the far end back, so each id records what was
    Removed at or above itself and nothing below it.
    """
    carry = above
    for step, step_removed in reversed(trail[name]):
        carry = carry or step_removed
        memo.setdefault(step, (kind, carry))
    answer[name] = (kind, carry)


def refuse_incomplete(env, plans) -> None:
    """Prove both halves of every pair before descendants are written (§14.2).

    `root_pairs` already refuses a pair that contradicts what Build means.
    This is the other half of the same sentence: a pair whose node or
    metadata is missing at the moment step 5 starts. Hanging a tree off a
    node with no `Drive Root` row would publish a namespace the engine
    cannot describe, and every later `save` on that root would refuse it
    (`DriveNode._validate_root_shape`).

    Read through `env.drive`, not through `roots.validate_root_pair`. The
    engine's own check reads `frappe.db`, which would put a site inside the
    one module that is supposed to run without one.
    """
    from suite.drive.patches.build.root_pairs import BuildPairError

    for plan in plans:
        node = env.drive.nodes((plan.node,)).get(plan.node)
        metadata = env.drive.root_metadata(plan.node)
        if not node or not metadata:
            missing = "node" if not node else "metadata"
            raise BuildPairError(
                f"Drive root pair {plan.node!r} has no {missing} row. "
                "Build must not migrate descendants of an incomplete pair (§14.2)."
            )
        if node.get("kind") != "root":
            raise BuildPairError(f"Drive Node {plan.node!r} is a {node.get('kind')!r}, not a root node.")
