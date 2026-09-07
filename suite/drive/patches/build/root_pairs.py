"""§14.2 step 4 and §14.3: the root pairs, one atomic pair at a time.

Legacy Drive has two pinned `File` rows with no `folder`: `Drive`, the
shared tree, and `Users`, whose children are one folder per person
(`suite/drive/utils/__init__.py:200-232`). §14.3 turns the first into a
Shared root pair and each of the second's children into a Personal one.
The `Users` row itself is dropped: it is scaffolding, not a namespace.

Every pair keeps the `File` id on both halves, so `Drive Node.name`,
`Drive Root.name`, and `Drive Root.node` are all the id a bookmark already
points at. That is why Build needs no id map at all [011 §4].

**Why this is not `roots.create_root`.** The engine's own lifecycle
(`suite/drive/_core/roots.py:18`) is the right thing for a live site and
cannot be used here: it generates a fresh 10-char id and offers no way to
supply one, and §14.3 requires the legacy id. So the pair goes in through
bulk SQL, and every rule `DriveNode.validate`, `DriveRoot.validate`, and
`create_root` would have applied is reproduced below by hand:

- the canonical empty root shape, and `state = Active` on the node;
- `Drive Root.name == node == Drive Node.name`, both directions;
- `kind = Personal` implies a user, `kind = Shared` implies none;
- at most one Active root per `(kind[, user])`, which is code-only on a
  live site and has no database constraint to fall back on;
- the Personal anchor grant, inside the same transaction as the pair.

A rerun re-reads what exists. A pair is complete only when both halves are
there and agree; an incomplete one is repaired, and a contradictory one
stops Build before a single descendant is written, because a descendant
written under the wrong root is not something a later run can find.
"""

import frappe

from suite.drive._core.roles import MANAGE
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.ports import (
    ACTIVE,
    DRIVE_ROOT_ROW,
    REMOVED,
    TRASHED,
    USERS_ROW,
    TreeRow,
)
from suite.drive.patches.build.state import SkippedRow, TreeConversion

PERSONAL = "Personal"
SHARED = "Shared"
ARCHIVED = "Archived"

# §3.2: "The Shared root pair has `owner = Administrator`". The legacy row
# already is (`_create_root_folder` sets it), so this only matters when a
# site has been hand-edited.
SHARED_OWNER = "Administrator"


class BuildPairError(frappe.ValidationError):
    """A root pair exists and contradicts what Build would write.

    §14.2: "Repair or fail on an incomplete/mismatched pair before migrating
    descendants." Repair is the missing half; this is the other case, and it
    stops the run rather than guessing which of the two truths is real."""


class RootPlan:
    """One migrated root: the node id descendants hang off, and its kind."""

    __slots__ = ("kind", "node", "state", "title", "user")

    def __init__(self, node: str, kind: str, user: str | None, title: str, state: str):
        self.node = node
        self.kind = kind
        self.user = user
        self.title = title
        self.state = state

    def __repr__(self) -> str:
        return f"RootPlan({self.node!r}, {self.kind!r}, {self.user!r}, {self.state!r})"


def convert_root_pairs(env, tree: TreeConversion, *, batch_size: int = BUILD_BATCH_SIZE) -> list[RootPlan]:
    """Create or repair every root pair. Returns the roots step 5 walks.

    Commits per batch of target rows, never inside one pair: §14.2 forbids
    splitting a root pair across commits, and a pair split across a kill is
    exactly the half-published root §3.2 refuses to allow.
    """
    plans: list[RootPlan] = []
    written = 0
    claimed_users: set[str] = set()

    for row in _root_rows(env, batch_size):
        tree.roots_seen += 1
        reconciled = _reconcile(env, tree, row, claimed_users)
        if reconciled is None:
            continue
        plan, node, metadata, anchors = reconciled

        # §14.2's batch size counts target rows, not source roots. A new
        # Personal pair is three rows (node, metadata, anchor), while a
        # repair can be only one. End the preceding batch before a whole
        # pair would cross the limit; a pair larger than a deliberately
        # tiny test batch remains one atomic, oversized batch.
        pair_rows = bool(node) + bool(metadata) + len(anchors)
        if pair_rows and written and written + pair_rows > batch_size:
            env.drive.commit()
            env.state.put_tree(tree)
            written = 0
        if pair_rows:
            env.drive.write_root_pair(node, metadata, anchors)
            if node and metadata:
                tree.roots_created += 1
            else:
                tree.roots_repaired += 1
            written += pair_rows
        else:
            tree.roots_already_complete += 1

        if plan.kind == PERSONAL and plan.state == ACTIVE and plan.user:
            claimed_users.add(plan.user)
        plans.append(plan)

        if written >= batch_size:
            env.drive.commit()
            env.state.put_tree(tree)
            written = 0

    env.drive.commit()
    env.state.put_tree(tree)
    return plans


def _root_rows(env, batch_size: int):
    """The `Drive` row, then every `Users/<email>` folder, in a stable order."""
    shared = env.tree.row(DRIVE_ROOT_ROW)
    if shared:
        yield shared

    after = (USERS_ROW, "")
    previous_page = None
    while True:
        rows = env.tree.children((USERS_ROW,), after, batch_size)
        if not rows:
            return
        if rows[0].name == previous_page:
            raise RuntimeError(f"the Users cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = rows[0].name
        yield from rows
        after = (rows[-1].folder or USERS_ROW, rows[-1].name)
        if len(rows) < batch_size:
            return


def _reconcile(env, tree: TreeConversion, row: TreeRow, claimed_users: set[str]):
    """Decide, create, or repair one pair, and answer what step 5 should walk."""
    kind = SHARED if row.name == DRIVE_ROOT_ROW else PERSONAL
    user = None if kind == SHARED else (row.file_name or "").strip()

    if row.status == REMOVED:
        # §14.4: a Removed row and everything below it is not migrated. A
        # Removed root means the whole namespace is gone, so publishing a
        # root pair for it would resurrect a deleted space.
        tree.roots_skipped += 1
        tree.record_skip(SkippedRow(row.name, "root folder status is Removed"))
        return None
    if kind == PERSONAL and not user:
        tree.roots_skipped += 1
        tree.record_skip(SkippedRow(row.name, "a Users/<email> folder names no user"))
        return None

    state = _metadata_state(env, row, kind, user, claimed_users)
    if state == ARCHIVED:
        tree.roots_archived += 1

    node = _node_row(row, kind)
    metadata = _metadata_row(row, kind, user, state)

    existing_node = env.drive.nodes((row.name,)).get(row.name)
    existing_metadata = env.drive.root_metadata(row.name)
    _refuse_mismatch(row.name, existing_node, existing_metadata, metadata)

    tree.max_id_length = max(tree.max_id_length, len(row.name))
    missing_node = None if existing_node else node
    missing_metadata = None if existing_metadata else metadata
    anchors = (
        _anchor_grants(env, row.name, kind, user)
        if missing_node is not None or missing_metadata is not None
        else []
    )
    return RootPlan(row.name, kind, user, node["title"], state), missing_node, missing_metadata, anchors


def _metadata_state(env, row: TreeRow, kind: str, user: str | None, claimed: set[str]) -> str:
    """§14.3: "metadata Active when enabled, otherwise Archived".

    Widened, deliberately, by three cases the spec does not spell out and
    the target schema will not tolerate:

    - a `Users/<email>` folder whose `User` row is gone. [011] §5 names it:
      "Archived when the User is disabled **or the row is gone** (the email
      is stored regardless)". `DriveRoot.validate` only demands a live user
      for an Active row, so Archived is the shape that fits.
    - a Trashed root folder. A root node is Active by definition (§3.1), so
      the trash has to land on the metadata or be dropped entirely.
    - a second folder for one email. "At most one Active root per
      identity" has no database constraint behind it (§3.2), so Build has
      to keep it true itself. The first row in id order wins and the rest
      are Archived, which is stable across reruns. There is no matching
      case for the Shared root: the legacy site has exactly one `Drive`
      row, so a second Shared root cannot arise.
    """
    if row.status == TRASHED:
        return ARCHIVED
    if kind == SHARED:
        return ACTIVE
    if user in claimed:
        return ARCHIVED
    # Build is not the only writer. User.after_insert can already have
    # provisioned an Active Personal root at a fresh id before this legacy
    # folder is reached. Keep that live namespace and archive the legacy
    # pair; descendants still migrate under the original File id, while
    # §3.2's one-Active-root invariant remains true. An Active root at this
    # same id is the pair being resumed, not a conflict.
    active = env.drive.active_root(PERSONAL, user)
    if active and active != row.name:
        return ARCHIVED
    return ACTIVE if env.tree.user_enabled(user) else ARCHIVED


def _node_row(row: TreeRow, kind: str) -> dict:
    """The canonical empty root shape (§3.1), with the source row's stamps."""
    owner = SHARED_OWNER if kind == SHARED else (row.owner or SHARED_OWNER)
    return {
        "name": row.name,
        "title": (row.file_name or "").strip() or row.name,
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
        "content_modified": row.file_modified or row.modified,
        "is_template": 0,
        "owner": owner,
        "creation": row.creation,
        "modified": row.modified,
        "modified_by": owner,
        "docstatus": 0,
        "idx": 0,
    }


def _metadata_row(row: TreeRow, kind: str, user: str | None, state: str) -> dict:
    owner = SHARED_OWNER if kind == SHARED else (row.owner or SHARED_OWNER)
    return {
        # `autoname: field:node`, so the two are the same string by
        # definition. Written out rather than derived, because bulk SQL is
        # what fills `name` here and nothing else would.
        "name": row.name,
        "node": row.name,
        "user": user or None,
        "kind": kind,
        "state": state,
        # 0 means "inherit the site default for the kind" (§3.2). The legacy
        # per-user quota on `Drive Settings` is §14.8's, not this step's.
        "quota_bytes": 0,
        # §14.2 step 12 recomputes this after every node exists. Seeding it
        # with anything else would be a number nobody measured.
        "used_bytes": 0,
        "acl_generation": 0,
        "owner": owner,
        "creation": row.creation,
        "modified": row.modified,
        "modified_by": owner,
        "docstatus": 0,
        "idx": 0,
    }


def _anchor_grants(env, node: str, kind: str, user: str | None) -> list[dict]:
    """§3.2's Personal anchor, written with the pair rather than at step 6.

    "A Personal root node carries one grant: MANAGE for its metadata
    record's user", and §14.5 says the owner row on `Users/<email>` "becomes
    MANAGE for that user on the Personal root node". Legacy always writes
    that row (`grant_owner_access`), so this is the row's own mapping in
    almost every case; writing it here is what covers the site where the row
    was deleted and the user would otherwise be locked out of their own
    space with no way in, MANAGE being the only role that could grant it.

    The Shared root gets nothing here on purpose. §14.5 is explicit that a
    migrated site "keeps what its row maps to" and that the fresh-site
    `$GENERAL` UPLOAD anchor "is not forced on them", so its anchor is
    whatever step 6 maps out of the legacy `$GENERAL` row.
    """
    if kind != PERSONAL or not user:
        return []
    if env.drive.grant_roles(node, (user,)):
        # A repair run reaches a node whose anchor the first run already
        # wrote. `Drive Grant` carries a unique index on `(node,
        # principal)`, so inserting it again fails the whole pair
        # transaction and every rerun after it fails the same way.
        return []
    stamp = env.now()
    return [
        {
            "name": env.new_id(),
            "node": node,
            "principal": user,
            "role": MANAGE,
            "expires_on": None,
            "password_hash": None,
            "owner": SHARED_OWNER,
            "creation": stamp,
            "modified": stamp,
            "modified_by": SHARED_OWNER,
            "docstatus": 0,
            "idx": 0,
        }
    ]


def _refuse_mismatch(node_id: str, existing_node, existing_metadata, intended: dict) -> None:
    """Stop before descendants when what is there is not what Build means.

    Every check here is a thing a rerun cannot resolve by writing the
    missing half: the wrong kind of node, metadata pointing somewhere else,
    or a root that has changed identity between two runs. Continuing would
    hang a tree off a node that is not a root, or off a Personal root that
    now belongs to a different person.
    """
    if existing_node:
        if existing_node.get("name") != node_id:
            raise BuildPairError(
                f"Drive Node {node_id!r} was read back as {existing_node.get('name')!r}; "
                "the root identity must equal the legacy File id (§14.3)."
            )
        canonical = {
            "kind": "root",
            "parent": None,
            "root": None,
            "path": "",
            "state": ACTIVE,
            "blob": None,
            "size": 0,
            "mime": None,
            "url": None,
            "content_doctype": None,
            "content_docname": None,
            "trashed_at": None,
            "trash_root": None,
            "is_template": 0,
        }
        for field, expected in canonical.items():
            actual = existing_node.get(field)
            # Database Check/Long Int values may arrive as bool/int, so
            # ordinary equality is intentionally enough for zero fields.
            if actual != expected:
                raise BuildPairError(
                    f"Drive Node {node_id!r} has {field}={actual!r}; "
                    f"a canonical root node requires {expected!r} (§3.1)."
                )
    if not existing_metadata:
        return
    if existing_metadata.get("name") != node_id:
        # `root_metadata` looks the row up by `node`, so only `name` can
        # disagree. §14.3 makes both equal the node id, and `autoname:
        # field:node` keeps them that way for any row the ORM wrote.
        raise BuildPairError(
            f"Drive Root metadata for node {node_id!r} is named "
            f"{existing_metadata.get('name')!r}. It must equal the node id (§14.3)."
        )
    if existing_metadata.get("node") != node_id:
        raise BuildPairError(
            f"Drive Root {node_id!r} points at node {existing_metadata.get('node')!r}; "
            f"it must point at {node_id!r} (§3.2, §14.3)."
        )
    if existing_metadata.get("kind") != intended["kind"]:
        raise BuildPairError(
            f"Drive Root {node_id!r} is a {existing_metadata.get('kind')!r} root, but "
            f"the legacy row makes it {intended['kind']!r}."
        )
    if (existing_metadata.get("user") or None) != intended["user"]:
        raise BuildPairError(
            f"Drive Root {node_id!r} belongs to {existing_metadata.get('user')!r}, but "
            f"the legacy folder names {intended['user']!r}."
        )
    if existing_metadata.get("state") not in (ACTIVE, ARCHIVED):
        raise BuildPairError(
            f"Drive Root {node_id!r} has invalid state {existing_metadata.get('state')!r}; "
            f"root metadata must be {ACTIVE!r} or {ARCHIVED!r} (§3.2)."
        )
