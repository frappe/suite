"""§14.5: the rights legacy merged from several rows, kept as one grant each.

Legacy decided each right on its own. For every flag it walked up from the
item to the nearest folder holding a row that set the flag, and inside one
folder a person's own row came before their group's, then `$GENERAL`, then
the public row (`suite/drive/utils` on `develop`: `generate_upward_path`,
`dribble_access`). So a person could hold upload from a row on a far folder
and comment from a nearer one, and keep both.

The engine is nearest-wins (§5): the nearest grant naming the person decides
the whole role. A nearer comment grant therefore hides an upload grant
further up, and a person's own comment grant hides their group's edit grant
on the same folder. A Sheet `DocShare` adds one more case: legacy took the
higher of a person's own share and the sheet's `everyone` share, while their
own READ grant now beats the `$GENERAL` EDIT grant beside it.

This module finds every such loss and answers the grants that undo it, at
the role legacy gave on the node whose rows decide it (`rights_to_keep`).
Nothing it writes widens access:

- Only a node's own rows can make the two models disagree. Below it, an
  item with no row of its own inherits the same thing in both.
- The public row (`user = ""`) is left out of what legacy gave. §14.5 turns
  it into `$PUBLIC` READ plus a link on purpose. Its deny is kept, because
  legacy let it take a right away.
- A person the engine denies is left alone. §14.5 rounds a deny up to a
  total deny on purpose, and this rule does not reopen it.

Reads no site. `grants.py` collects the inputs and writes the answer.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from suite.drive._core.access import Acc, chain_ids, own_tier
from suite.drive._core.principals import Principals
from suite.drive._core.roles import COMMENT, EDIT, MANAGE, NONE, READ, UPLOAD
from suite.drive.patches.build.mapping import ANONYMOUS, GENERAL, GROUP_PREFIX, PUBLIC

FLAGS = ("read", "comment", "upload", "write", "share")

# Inside one folder, legacy read a person's own row first, then their
# groups', then `$GENERAL`, then the public row.
USER_TIER, GROUP_TIER, GENERAL_TIER, ANONYMOUS_TIER = range(4)

# The user a class of alike people is resolved as. No grant can name it:
# a principal is an address or starts with `$`.
STAND_IN = "\x00alike"


@dataclass(frozen=True)
class LegacyRow:
    """One collapsed `Drive Permission` row on a migrated node."""

    node: str
    principal: str
    flags: Mapping[str, int]


@dataclass(frozen=True)
class KeptRight:
    """A grant for `principal` on `node` at `role`, written or raised."""

    node: str
    principal: str
    role: int


@dataclass
class LegacyRights:
    """What legacy decided access from, gathered while step 6 walks it.

    `rows` holds the `Drive Permission` rows that became grants, plus the
    public rows that deny. `shares` holds the Sheet `DocShare` rows as
    `(node, principal, role)`, with an `everyone` row as `$GENERAL`.
    """

    rows: dict[str, list[LegacyRow]] = field(default_factory=dict)
    shares: dict[str, list[tuple[str, int]]] = field(default_factory=dict)

    def add_row(self, node: str, principal: str, flags: Mapping[str, int]) -> None:
        kept = {flag: int(bool(flags.get(flag))) for flag in (*FLAGS, "deny")}
        self.rows.setdefault(node, []).append(LegacyRow(node, principal, kept))

    def add_share(self, node: str, principal: str, role: int) -> None:
        self.shares.setdefault(node, []).append((principal, role))

    def nodes(self) -> set[str]:
        return set(self.rows) | set(self.shares)


@dataclass
class KeptRightsResult:
    """The grants to write, and the people a deny keeps below legacy on purpose."""

    rights: list[KeptRight] = field(default_factory=list)
    behind_deny: int = 0


def rights_to_keep(
    legacy: LegacyRights,
    nodes: Mapping[str, Mapping],
    grants: Mapping[str, Iterable[tuple[str, int]]],
    people: Mapping[str, Iterable[str]],
) -> KeptRightsResult:
    """Answer the grants that give everyone back what legacy merged for them.

    `nodes` holds every node in `legacy`, as `Drive Node` rows. `grants`
    holds the stored non-link grants on those nodes and on every ancestor.
    `people` maps each person to the names of their groups.

    Three passes:

    1. For each person and each node with a row that names them, their
       group, or `$GENERAL`: the role legacy gave, and the grant that
       decides their role now.
    2. A group or `$GENERAL` grant is raised to the lowest role legacy gave
       anyone it decides, when that is above its own. One row then serves
       everyone, and nobody it decides ends above what legacy gave them.
    3. Each person, from the root down, gets their own grant where they are
       still below legacy. Where a grant written above them would carry them
       past what they held on a lower node (a public deny there, say), they
       get their own grant at that lower node too, at what they held.
    """
    result = KeptRightsResult()
    chains = {name: chain_ids(node) for name, node in nodes.items()}
    working = {name: dict(rows) for name, rows in grants.items()}
    by_principal: dict[str, set[str]] = {}
    for name, rows in legacy.rows.items():
        for row in rows:
            by_principal.setdefault(row.principal, set()).add(name)
    for name, shares in legacy.shares.items():
        for principal, _role in shares:
            by_principal.setdefault(principal, set()).add(name)

    views = []
    decided: dict[tuple[str, str], int] = {}
    for user, members, groups in _alike(people, by_principal, working):
        tiers = _tiers(user, groups)
        principals = Principals(user=user, own=tuple(p for p in tiers if p != ANONYMOUS), open=(PUBLIC,))
        candidates = set().union(*(by_principal.get(principal, set()) for principal in tiers))
        entries = []
        for name in sorted((n for n in candidates if n in chains), key=lambda n: (len(chains[n]), n)):
            chain = chains[name]
            had = max(_legacy_role(legacy, chain, tiers), _shared_role(legacy, name, tiers))
            acc = _engine(chain, working, principals)
            shared = _shared_winner(chain, working, principals, acc)
            # Only a grant that came from a legacy row: every holder of the
            # principal then meets it here, so `decided` sees every node it
            # decides for anyone. A root anchor or a creator grant has no
            # such row, and raising one could reach a node nobody compared.
            if shared is not None and shared[0] in by_principal.get(shared[1], ()):
                decided[shared] = min(decided.get(shared, had), had)
            entries.append((name, chain, had, acc.answer()))
        views.append((principals, members, entries))

    for (name, principal), floor in sorted(decided.items()):
        if floor > working[name][principal]:
            working[name][principal] = floor
            result.rights.append(KeptRight(name, principal, floor))

    for principals, members, entries in views:
        own: dict[str, int] = {}
        for name, chain, had, base in entries:
            acc = _engine(chain, working, principals, own)
            holds = acc.answer()
            if holds < had and acc.own == NONE:
                result.behind_deny += len(members)
                continue
            if holds < had:
                own[name] = had
            elif holds > max(had, base):
                own[name] = max(had, base)
            else:
                continue
            result.rights.extend(KeptRight(name, member, own[name]) for member in members)
    return result


def _alike(
    people: Mapping[str, Iterable[str]],
    by_principal: Mapping[str, set[str]],
    grants: Mapping[str, Mapping[str, int]],
) -> list[tuple[str, list[str], tuple[str, ...]]]:
    """People in classes that the rows and grants cannot tell apart.

    A person no row or grant names is decided by their groups and
    `$GENERAL` alone, so everyone with the same named groups gets the same
    answer. Each class is resolved once, for a stand-in user no grant
    names. On a site where most people hold nothing of their own, this is
    most of the work saved.
    """
    named = set(by_principal) | {principal for rows in grants.values() for principal in rows}
    classes: dict[tuple[str, ...], list[str]] = {}
    alone = []
    for person, groups in sorted(people.items()):
        relevant = tuple(sorted(g for g in groups if f"{GROUP_PREFIX}{g}" in named))
        if person in named:
            alone.append((person, [person], relevant))
        else:
            classes.setdefault(relevant, []).append(person)
    return alone + [(STAND_IN, members, groups) for groups, members in sorted(classes.items())]


def _tiers(user: str, groups: Iterable[str]) -> dict[str, int]:
    tiers = {user: USER_TIER}
    for group in groups:
        tiers[f"{GROUP_PREFIX}{group}"] = GROUP_TIER
    tiers[GENERAL] = GENERAL_TIER
    tiers[ANONYMOUS] = ANONYMOUS_TIER
    return tiers


def _legacy_role(legacy: LegacyRights, chain: list[str], tiers: Mapping[str, int]) -> int:
    """Each flag from the nearest row that sets it, then the legacy ladder."""
    decided: dict[str, bool] = {}
    for name in reversed(chain):
        rows = [row for row in legacy.rows.get(name, ()) if row.principal in tiers]
        rows.sort(key=lambda row: (tiers[row.principal], not row.flags["deny"]))
        for row in rows:
            for flag in FLAGS:
                if row.flags[flag] and flag not in decided:
                    decided[flag] = not row.flags["deny"]
        if len(decided) == len(FLAGS):
            break
    return _ladder(decided)


def _ladder(decided: Mapping[str, bool]) -> int:
    """Legacy showed nothing without read, and shared only alongside write."""
    if not decided.get("read"):
        return NONE
    if decided.get("write"):
        return MANAGE if decided.get("share") else EDIT
    if decided.get("upload"):
        return UPLOAD
    if decided.get("comment"):
        return COMMENT
    return READ


def _shared_role(legacy: LegacyRights, node: str, tiers: Mapping[str, int]) -> int:
    """A Sheet share gave its role on top of Drive's, never below it."""
    roles = [role for principal, role in legacy.shares.get(node, ()) if principal in tiers]
    return max(roles, default=NONE)


def _engine(
    chain: list[str],
    grants: Mapping[str, Mapping[str, int]],
    principals: Principals,
    own: Mapping[str, int] | None = None,
) -> Acc:
    """The engine's nearest-wins pass (§5), with `own` as the person's extra grants."""
    acc = Acc()
    for depth, name in enumerate(chain):
        for principal, role in grants.get(name, {}).items():
            acc.offer(principal, role, depth, principals)
        if own and name in own:
            acc.offer(principals.user, own[name], depth, principals)
    return acc


def _shared_winner(
    chain: list[str], grants: Mapping[str, Mapping[str, int]], principals: Principals, acc: Acc
) -> tuple[str, str] | None:
    """The one group or `$GENERAL` grant that decides this person, if one does."""
    if not acc.own or acc.own_tier == USER_TIER:
        return None
    name = chain[acc.own_depth]
    tied = [
        principal
        for principal in grants.get(name, {})
        if principal in principals.own and own_tier(principal, principals.user) == acc.own_tier
    ]
    return (name, tied[0]) if len(tied) == 1 else None
