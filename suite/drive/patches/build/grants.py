"""§14.2 step 6 and §14.5: legacy permissions become `Drive Grant` rows.

Two sources feed one table. `Drive Permission` carries Drive's own sharing,
and Sheet `DocShare` carries the sharing Sheets did through the framework
before Drive owned it. Both land on `(node, principal)`, which is unique, so
the two can meet on one row and the higher of them wins (§14.5).

The order of the two things Build does per pair matters:

1. **Collapse, then map.** A `(entity, user)` pair can hold several rows.
   `dedupe_drive_permissions.py` unions their flags and Build reproduces
   that. Mapping first and taking the highest answer is a different result:
   a `read + share` row maps to READ and a `write` row maps to EDIT, so
   mapping first gives EDIT, while the union is `share + write`, which is
   MANAGE. The site's own patch would have produced MANAGE.
2. **Map, then hold to the guardrails.** Build writes with SQL, so no
   refusal in §5.9 fires by itself. Refusals 7, 8, and 11 bind a Suite
   Admin, which means a migration may not write past them either. Every row
   they catch is dropped and counted under `root_guardrail`.

Anonymous rows are the only ones that become two grants. §14.5: a `user =
""` row above read becomes a `$PUBLIC` READ grant *plus* a `$LINK:<token>`
grant at the mapped level. That is a real change for the owner, whose old
"anyone with the link" URL no longer works, which is why `links_minted` is
the one counter §14.9 calls out as something owners must be told about.

Nothing here deletes a legacy row. `LegacyTree` has no method that could.
"""

from suite.drive._core.roles import NONE, READ
from suite.drive.patches.build.environment import BUILD_BATCH_SIZE
from suite.drive.patches.build.mapping import (
    GENERAL,
    GROUP_PREFIX,
    LINK_PREFIX,
    PRINCIPAL_LENGTH,
    PUBLIC,
    clamp_link,
    clamp_public,
    collapse,
    docshare_role,
    merged_role,
    principal_kind,
    role_for_flags,
)
from suite.drive.patches.build.ports import ACTIVE
from suite.drive.patches.build.root_pairs import PERSONAL, SHARED
from suite.drive.patches.build.state import GrantConversion

# §14.5's drop reasons, which are also §14.9's report keys.
DEAD_PRINCIPAL = "dead_principal"
UNMIGRATED_ENTITY = "unmigrated_entity"
NO_FLAGS = "no_flags"
ROOT_GUARDRAIL = "root_guardrail"

GRANT_OWNER = "Administrator"


def convert_grants(env, grants: GrantConversion, plans, *, batch_size: int = BUILD_BATCH_SIZE) -> None:
    """Map every legacy permission row, then hold the §3.2 Shared floor."""
    _recover_link_intents(env, grants)
    nodes = _NodeFacts(env)
    batch = _Batch(env, grants, batch_size)
    _convert_permissions(env, grants, nodes, batch, batch_size)
    _convert_docshares(env, grants, nodes, batch, batch_size)
    batch.flush()
    if grants.pending_link_nodes:
        raise RuntimeError(
            "unresolved Build link intents remain after the source walk: "
            + ", ".join(sorted(grants.pending_link_nodes))
        )
    _shared_floor(env, grants, plans)


def _recover_link_intents(env, grants: GrantConversion) -> None:
    """Finish counters for a grant batch committed just before a kill.

    The state file is the write-ahead side of the database transaction. If
    an intended link exists, the commit landed and only the cumulative
    count still needs advancing. If it does not, the source walk stages the
    same node again and the ordinary flush finishes it.
    """
    committed = [node for node in grants.pending_link_nodes if env.drive.has_link_grant(node)]
    if not committed:
        return
    grants.finish_links(committed)
    env.state.put_grants(grants)


# ---------------------------------------------------------------- permissions


def _convert_permissions(env, grants: GrantConversion, nodes, batch, batch_size: int) -> None:
    """Page `Drive Permission` and convert one `(entity, user)` pair at a time.

    Rows arrive ordered by `(entity, user, name)`, so the duplicates of one
    pair are contiguous and collapse before anything is mapped. The open
    pair is carried across the page boundary rather than re-queried: a pair
    cut in half by a page would collapse twice and map the wrong keeper.
    """
    for pair in _permission_pairs(env, grants, batch_size):
        grants.permission_pairs += 1
        _convert_pair(env, grants, nodes, batch, pair)


def _permission_pairs(env, grants: GrantConversion, batch_size: int):
    after = ("", "", "")
    previous_page = None
    open_key = None
    open_rows: list = []
    while True:
        rows = env.tree.permissions(after, batch_size)
        if not rows:
            break
        cursor = (rows[0].entity, rows[0].user, rows[0].name)
        if cursor == previous_page:
            raise RuntimeError(f"the Drive Permission cursor stalled at {cursor!r}; refusing to loop")
        previous_page = cursor
        for row in rows:
            grants.permission_rows_seen += 1
            key = (row.entity, row.user)
            if key != open_key:
                if open_rows:
                    yield open_key, open_rows
                open_key, open_rows = key, []
            open_rows.append(row)
        after = (rows[-1].entity, rows[-1].user, rows[-1].name)
        if len(rows) < batch_size:
            break
    if open_rows:
        yield open_key, open_rows


def _convert_pair(env, grants: GrantConversion, nodes, batch, pair) -> None:
    (entity, user), rows = pair
    node = nodes.get(entity)
    if node is None:
        # §14.5: "rows on an unmigrated entity" are dropped. The entity is
        # Removed, unreachable, or over capacity; step 5 already said so.
        grants.drop(UNMIGRATED_ENTITY)
        return

    flags = collapse([row.flags() for row in rows])
    role = role_for_flags(flags)
    if role is None:
        grants.drop(NO_FLAGS)
        return

    kind = principal_kind(user)
    if kind == "anonymous":
        _convert_anonymous(env, grants, nodes, batch, node, role)
        return

    principal = _principal_for(nodes, grants, user, kind)
    if principal is None:
        return
    if role == NONE and _is_own_personal_root(nodes, node, user):
        # §5.9 refusal 11. A deny that locks a user out of their own
        # Personal root is refused for everyone, Suite Admin included, so
        # Build may not write it either. The legacy row could not have
        # meant much: Drive's own read path let the owner in regardless.
        grants.drop(ROOT_GUARDRAIL)
        return
    batch.add(node["name"], principal, role)


def _convert_anonymous(env, grants: GrantConversion, nodes, batch, node, role: int) -> None:
    """§14.5's `user = ""` table: `$PUBLIC`, and a link when it was above read."""
    if node["kind"] == "root":
        # §5.9 refusals 7 and 8: no `$PUBLIC` and no `$LINK:` on a root
        # node. A public Personal root would publish somebody's whole
        # namespace, and no legacy UI could have asked for it.
        grants.drop(ROOT_GUARDRAIL)
        return
    if role == READ and nodes.is_composite(node["name"]):
        # [011 amendment]: `presentation.py:98-113` writes a forced-public
        # row whenever a deck is composite. It records a property of the
        # deck, not a decision somebody made, so mapping it would publish
        # decks nobody chose to publish.
        #
        # It writes exactly one shape: it looks the row up with `deny = 0`
        # and sets `read = 1`. So only a plain read grant can be the forced
        # row. A deny is provably not it, and dropping one would take away
        # the §6.5 refusal that keeps an inherited `$PUBLIC` grant on an
        # ancestor folder from publishing the deck. A row above read is
        # somebody's own decision and is mapped like any other.
        grants.composite_rows_dropped += 1
        return

    if role == NONE:
        # A deny for anonymous readers stays one deny. Nothing to mint: a
        # link at role 0 would hand out a URL that opens nothing.
        batch.add(node["name"], PUBLIC, NONE)
        grants.public_grants_written += 1
        return

    batch.add(node["name"], PUBLIC, clamp_public(role))
    grants.public_grants_written += 1
    if role <= READ:
        return

    if env.drive.has_link_grant(node["name"]):
        # Also reconcile here in case a row appeared after the step's first
        # recovery read. This is idempotent because finish_links consumes
        # the write-ahead intent as it advances the counter.
        if node["name"] in grants.pending_link_nodes:
            grants.finish_links((node["name"],))
            env.state.put_grants(grants)
        return
    if batch.has_link(node["name"]):
        # This batch already staged one for the node. Minting again would
        # leave two live tokens for one row and count the owner twice.
        return
    minted = clamp_link(role)
    if minted != role:
        grants.links_clamped += 1
    batch.add(node["name"], _link_principal(env), minted, link=True)


def _principal_for(nodes, grants: GrantConversion, user: str, kind: str) -> str | None:
    """One legacy `user` value as a §4.4 principal, or None when it is dead."""
    if kind == "general":
        return GENERAL
    if kind == "unknown":
        # A `$`-prefixed value Drive never wrote. `_principal_kind` in the
        # engine would refuse to classify it, so the grant would decide
        # nothing for anybody.
        grants.drop(DEAD_PRINCIPAL)
        return None
    if kind == "group":
        name = user[len(GROUP_PREFIX) :]
        if not name or not nodes.group_exists(name):
            grants.drop(DEAD_PRINCIPAL)
            return None
        return _within_column(grants, user, grants.drop)
    # A disabled User still exists, so §14.5 keeps the row: "rows naming a
    # User or User Group that no longer exists" is the drop rule, and
    # re-enabling an account must not silently lose what it could reach.
    if nodes.user_enabled(user) is None:
        grants.drop(DEAD_PRINCIPAL)
        return None
    return _within_column(grants, user, grants.drop)


def _within_column(grants: GrantConversion, principal: str, count) -> str | None:
    """`Drive Grant.principal` is `varchar(200)` (§3.3). Truncation is not an option.

    A cut principal is a different principal: `$GROUP:` plus a 200-character
    name would land on whichever group shares the first 193 characters.

    The caller passes its own counter. §14.9 prints `grant_rows_dropped`
    and `docshare_rows_dropped` as separate numbers, so a DocShare row
    counted here as well would inflate the permission total.
    """
    if len(principal) > PRINCIPAL_LENGTH:
        count(DEAD_PRINCIPAL)
        return None
    return principal


def _link_principal(env) -> str:
    return f"{LINK_PREFIX}{env.new_token()}"


def _is_own_personal_root(nodes, node, user: str) -> bool:
    """Whether `user` owns the Personal root this node sits in (§5.9 refusal 11).

    "the root itself included": a deny on the root node counts, and so does
    one on anything below it.
    """
    metadata = nodes.root_of(node)
    return bool(metadata and metadata.get("kind") == PERSONAL and metadata.get("user") == user)


# ----------------------------------------------------------------- docshares


def _convert_docshares(env, grants: GrantConversion, nodes, batch, batch_size: int) -> None:
    """Sheet `DocShare` rows become grants on the sheet's node (§14.5)."""
    after = ""
    previous_page = None
    while True:
        rows = env.tree.docshares(after, batch_size)
        if not rows:
            return
        if rows[0].name == previous_page:
            raise RuntimeError(f"the DocShare cursor stalled at {rows[0].name!r}; refusing to loop")
        previous_page = rows[0].name
        for row in rows:
            grants.docshare_rows_seen += 1
            _convert_docshare(env, grants, nodes, batch, row)
        after = rows[-1].name
        if len(rows) < batch_size:
            return


def _convert_docshare(env, grants: GrantConversion, nodes, batch, row) -> None:
    entity = nodes.sheet_entity(row.share_name)
    node = nodes.get(entity) if entity else None
    if node is None:
        # The sheet has no `File` row, or its row did not migrate. Either
        # way there is nothing to hang the grant on.
        grants.drop_docshare(UNMIGRATED_ENTITY)
        return

    role = docshare_role({"read": row.read, "write": row.write})
    if role is None:
        grants.drop_docshare(NO_FLAGS)
        return

    if row.everyone:
        # §14.5: "the `everyone` row to `$GENERAL` at the same level".
        # `$GENERAL` is every signed-in user, which is what the framework's
        # `everyone` meant on a site with no guest access.
        batch.add(node["name"], GENERAL, role)
        return
    if not row.user or nodes.user_enabled(row.user) is None:
        grants.drop_docshare(DEAD_PRINCIPAL)
        return
    principal = _within_column(grants, row.user, grants.drop_docshare)
    if principal is None:
        return
    batch.add(node["name"], principal, role)


# --------------------------------------------------------------- shared floor


def _shared_floor(env, grants: GrantConversion, plans) -> None:
    """§3.2: an Active Shared root pair carries a `$GENERAL` anchor grant.

    §14.5 keeps whatever a migrated site's own `$GENERAL` row on `Drive`
    mapped to, and forces nothing on top of it: "the fresh-site `$GENERAL`
    UPLOAD anchor is not forced on them". This only fills the case where
    the legacy row was missing or mapped to nothing, so the root is not
    left with no anchor at all.
    """
    for plan in plans:
        if plan.kind != SHARED or plan.state != ACTIVE:
            continue
        if env.drive.grant_roles(plan.node, (GENERAL,)):
            continue
        env.drive.insert_grants([_grant_row(env, plan.node, GENERAL, READ)])
        grants.shared_anchors_written += 1
        env.drive.commit()
        env.state.put_grants(grants)


# ---------------------------------------------------------------- node facts


class _NodeFacts:
    """What a grant decision needs about a node, a user, a group, a sheet.

    Every one of these is a single-row lookup, and every one of them
    repeats. A permission table names the same twenty colleagues on ten
    thousand nodes; without a cache that is ten thousand `User` reads for
    each of them. Caching them is the difference between a migration that
    finishes overnight and one that does not.

    Permission rows arrive grouped by entity and DocShare rows do not, so a
    plain "remember the last one" cache would miss on every sheet. The node
    cache is capped so a site with a million nodes does not turn it into a
    second copy of the table. Users, groups, and roots are bounded by the
    site's own counts, so they are held without one.
    """

    LIMIT = 20000

    def __init__(self, env):
        self.env = env
        self.nodes: dict[str, dict | None] = {}
        self.roots: dict[str, dict | None] = {}
        self.users: dict[str, bool | None] = {}
        self.groups: dict[str, bool] = {}
        self.sheets: dict[str, str | None] = {}
        self.composites: dict[str, bool] = {}

    def get(self, entity: str) -> dict | None:
        if entity not in self.nodes:
            if len(self.nodes) >= self.LIMIT:
                # Dropped wholesale rather than one entry at a time.
                # Permission rows arrive grouped by entity, so the entry in
                # use is refilled on the next read and nothing is re-walked.
                self.nodes.clear()
            self.nodes[entity] = self.env.drive.nodes((entity,)).get(entity)
        return self.nodes[entity]

    def root_of(self, node: dict) -> dict | None:
        """The `Drive Root` metadata for the root this node sits in.

        A root node's own `root` column points at itself (§3.1), so the
        lookup is the same one either way.
        """
        root = node.get("root") or node.get("name")
        if root not in self.roots:
            self.roots[root] = self.env.drive.root_metadata(root)
        return self.roots[root]

    def user_enabled(self, email: str) -> bool | None:
        if email not in self.users:
            self.users[email] = self.env.tree.user_enabled(email)
        return self.users[email]

    def group_exists(self, name: str) -> bool:
        if name not in self.groups:
            self.groups[name] = self.env.tree.group_exists(name)
        return self.groups[name]

    def sheet_entity(self, sheet: str) -> str | None:
        if sheet not in self.sheets:
            self.sheets[sheet] = self.env.tree.sheet_entity(sheet)
        return self.sheets[sheet]

    def is_composite(self, entity: str) -> bool:
        if entity not in self.composites:
            self.composites[entity] = self.env.tree.is_composite_deck(entity)
        return self.composites[entity]


# --------------------------------------------------------------------- batch


def _grant_row(env, node: str, principal: str, role: int) -> dict:
    """§3.3's columns, as one row ready for a bulk insert.

    §14.5: "Every grant gets `expires_on = NULL`." A legacy row carries no
    expiry, and inventing one would take away access on a date nobody set.
    `password_hash` is NULL for the same reason: a minted link is not
    password-protected until somebody sets one.
    """
    stamp = env.now()
    return {
        "name": env.new_id(),
        "node": node,
        "principal": principal,
        "role": role,
        "expires_on": None,
        "password_hash": None,
        "owner": GRANT_OWNER,
        "creation": stamp,
        "modified": stamp,
        "modified_by": GRANT_OWNER,
        "docstatus": 0,
        "idx": 0,
    }


class _Batch:
    """Pending `(node, principal)` decisions, written per 1000 rows (§14.2).

    `(node, principal)` is unique, so the batch is a dict rather than a
    list: two sources naming one pair have to meet here, before the insert,
    or the second one is a duplicate-key error instead of a merge.
    """

    def __init__(self, env, grants: GrantConversion, size: int):
        self.env = env
        self.grants = grants
        self.size = size
        self.pending: dict[tuple[str, str], int] = {}
        self.links: set[str] = set()

    def has_link(self, node: str) -> bool:
        """Whether this run already minted for `node` and has not flushed yet."""
        return node in self.links

    def add(self, node: str, principal: str, role: int, *, link: bool = False) -> None:
        key = (node, principal)
        self.pending[key] = merged_role(self.pending.get(key), role)
        if link:
            self.links.add(node)
        if len(self.pending) >= self.size:
            self.flush()

    def flush(self) -> None:
        if not self.pending:
            return
        link_nodes = sorted(self.links)
        if link_nodes:
            # Write-ahead ordering closes both interruption windows: before
            # the DB commit an intent makes a rerun retry; after it the same
            # intent makes a rerun finish the cumulative counter.
            self.grants.prepare_links(link_nodes)
            self.env.state.put_grants(self.grants)

        fresh = []
        by_node: dict[str, dict[str, int]] = {}
        for (node, principal), role in self.pending.items():
            by_node.setdefault(node, {})[principal] = role

        for node, wanted in by_node.items():
            stored = self.env.drive.grant_roles(node, tuple(wanted))
            for principal, role in wanted.items():
                if principal not in stored:
                    fresh.append(_grant_row(self.env, node, principal, role))
                    continue
                self.grants.grants_already_present += 1
                merged = merged_role(stored[principal], role)
                if merged != stored[principal]:
                    # Usually a rerun finishing a row an earlier run wrote
                    # low. A stored deny never moves, because `merged_role`
                    # answers NONE for it; a deny arriving from a second
                    # source does move a stored grant down to NONE, which
                    # is §14.5's "deny wins" and the only case that lowers.
                    self.env.drive.raise_grant(node, principal, merged)

        self.env.drive.insert_grants(fresh)
        self.grants.grants_written += len(fresh)
        self.env.drive.commit()
        if link_nodes:
            self.grants.finish_links(link_nodes)
        self.env.state.put_grants(self.grants)
        self.pending = {}
        self.links = set()
