"""§14.5: the rights legacy merged from several rows, kept as one grant each.

Legacy decided each right on its own. For every flag it walked up from the
item to the nearest folder holding a row that set the flag, and inside one
folder a person's own row came before their group's, then `$GENERAL`, then
the public row, with a deny before a grant among rows of one tier
(`suite/drive/utils` on `develop`: `generate_upward_path`,
`dribble_access`). So a person could hold upload from a row on a far folder
and comment from a nearer one, and keep both.

The engine is nearest-wins (§5): the nearest grant naming the person decides
the whole role. A nearer comment grant therefore hides an upload grant
further up, and a person's own comment grant hides their group's edit grant
on the same folder. A Sheet `DocShare` adds one more case: legacy took the
higher of a person's own share and the sheet's `everyone` share, while their
own READ grant now beats the `$GENERAL` EDIT grant beside it.

`rights_to_keep` compares the two for every person on every node that holds
a legacy row or Sheet share, and answers the grants that give each person
back what legacy gave them there. Three rules bound what it writes:

- A group or `$GENERAL` grant is raised only as far as every current person
  it decides had, and no further than legacy gave somebody who holds that
  principal alone. Where no deny row for a group or a person sits on the
  path, legacy gave a member of more groups at least what it gave a member
  of fewer, so that cap also holds for whoever joins the group, or signs
  up, after Build. Where such a deny row does sit on the path, legacy could
  give a member of two groups less than a member of one, so the grant is
  not raised at all (`raises_skipped`) and today's people get their own
  grants. Everyone else the raise cannot serve gets their own grant too.
- A grant it writes that would carry a person past what they had on a lower
  node is held back there by the person's own grant (a pin), at the higher
  of what legacy gave them and what Build had given them before this pass.
  A pin never denies.
- A person the engine denies is left alone. §14.5 rounds a deny up to a
  total deny on purpose, and this rule does not reopen it.

A person's own grant is nearest-wins like any other, so it does not follow
a group deny that person meets later by joining the group. Only rows on a
path that holds a deny row for a group can do that.

It does not take away what Build's per-row mapping already gave above
legacy. Those pairs are counted (`exceeded`), not pinned: §14.5 lets a
`$PUBLIC` deny bind only people with no grant of their own (§6.5). Owner
decision, 2026-11-16: count them, and decide only if a run counts any.

Reads no site. `grants.py` collects the inputs and writes the answer.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal

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

Kind = Literal["raise", "person", "pin"]
RAISE: Kind = "raise"
PERSON: Kind = "person"
PIN: Kind = "pin"


@dataclass(frozen=True)
class LegacyRow:
    """One `Drive Permission` row on a migrated node, as legacy read it."""

    node: str
    principal: str
    flags: Mapping[str, int]


@dataclass(frozen=True)
class KeptRight:
    """A grant for `principal` on `node` at `role`, written or raised.

    `raise` lifts a group or `$GENERAL` grant, `person` gives one person the
    role legacy gave them, and `pin` holds one person back on a lower node.
    """

    node: str
    principal: str
    role: int
    kind: Kind


@dataclass
class LegacyRights:
    """What legacy decided access from, gathered while step 6 walks it.

    `rows` holds every `Drive Permission` row behind a grant, one entry per
    source row, plus the public rows that deny. Legacy read duplicate rows
    one by one, so a grant row beside a deny row for the same person still
    gave the flags the deny did not set. `shares` holds the Sheet `DocShare`
    rows as `(node, principal, role)`, with an `everyone` row as `$GENERAL`.
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
    """The grants to write, and what the comparison found, in person-item pairs.

    A pair is one person on one node that holds a legacy row or share. A
    position inherited from a folder is counted again on every node below
    it that holds a row of its own. Owners and Suite Admins held everything
    in legacy, so `exceeded`, `exceeded_by_public_deny` and `share_lost`
    leave them out. The other pair counts include them.
    """

    rights: list[KeptRight] = field(default_factory=list)
    # Group or `$GENERAL` grants not raised because a deny row for a group
    # or a person sits on a path they decide. Their people got own grants.
    raises_skipped: int = 0
    # Below legacy, held there by a deny the engine keeps on purpose.
    behind_deny: int = 0
    # Above legacy after this pass. Build's own mapping put them there.
    exceeded: int = 0
    # The part of `exceeded` a public deny explains: legacy let it take a
    # right from everyone, the engine lets it bind only people with no
    # grant of their own.
    exceeded_by_public_deny: int = 0
    # Lifted by this pass from below UPLOAD to EDIT although legacy had not
    # granted upload (`_ladder`).
    upload_added: int = 0
    # Legacy granted `share` without `write`. The ladder has no role for it
    # below MANAGE, which would add edit, so it is lost (§14.5's table).
    share_lost: int = 0
    # Person grants whose role came in part from a group or `$GENERAL` row.
    # Unlike the group row, they stay when the person leaves the group.
    from_groups: int = 0
    # Pins that would have denied a person outright, not written.
    pins_refused: int = 0


@dataclass(frozen=True)
class _Entry:
    """One class of alike people on one compared node, before any write."""

    name: str
    chain: list[str]
    flags: Mapping[str, bool]
    had: int
    base: int
    denied: bool


@dataclass(frozen=True)
class _Class:
    """People the rows cannot tell apart, and what pass 1 found for them."""

    principals: Principals
    tiers: Mapping[str, int]
    members: list[str]
    entries: list[_Entry]


def rights_to_keep(
    legacy: LegacyRights,
    nodes: Mapping[str, Mapping],
    grants: Mapping[str, Iterable[tuple[str, int]]],
    people: Mapping[str, Iterable[str]],
    admins: Iterable[str] = (),
) -> KeptRightsResult:
    """Answer the grants that give everyone back what legacy merged for them.

    `nodes` holds the `Drive Node` rows to compare, each a node in
    `legacy`. `grants` holds the stored non-link grants on those nodes and
    on every ancestor. `people` maps each person to the names of their
    groups, and `admins` names the Suite Admins.

    Three passes:

    1. For each class of alike people and each node with a row that names
       them, their group, or `$GENERAL`: the role legacy gave, and the grant
       that decides their role now. A stand-in who holds one group alone,
       and one who holds nothing but `$GENERAL`, are compared too, with no
       members, so a raise cannot outrun what legacy gave a later joiner.
    2. A group or `$GENERAL` grant is raised to the lowest role legacy gave
       anyone it decides, those stand-ins included, when that is above its
       own role. A grant tied with another at the same depth and tier
       decides for its whole tie. A grant that decides a node whose path
       holds a deny row for a group or a person is not raised: the
       stand-ins hold one group each, and such a row can give a member of
       two groups less than either stand-in had.
    3. Each class, from the root down, gets its own grant where it is still
       below legacy, and a pin where a grant written above would carry it
       past `max(had, base)` on a lower node.
    """
    result = KeptRightsResult()
    chains = {name: chain_ids(node) for name, node in nodes.items()}
    working = {name: dict(rows) for name, rows in grants.items()}
    by_principal = _named_nodes(legacy)
    named_denies = _named_deny_nodes(legacy)

    classes = []
    decided: dict[tuple[str, str], int] = {}
    unsafe: set[tuple[str, str]] = set()
    for user, members, groups in _alike(people, by_principal, working):
        tiers = _tiers(user, groups)
        principals = _principals(user, tiers)
        candidates = set().union(*(by_principal.get(principal, set()) for principal in tiers))
        entries = []
        for name in sorted((n for n in candidates if n in chains), key=lambda n: (len(chains[n]), n)):
            chain = chains[name]
            flags = _legacy_flags(legacy, chain, tiers)
            had = max(_ladder(flags), _shared_role(legacy, name, tiers))
            acc = _engine(chain, working, principals)
            denied_on_path = any(node in named_denies for node in chain)
            # Only a grant that came from a legacy row: every holder of the
            # principal then meets it here, so `decided` sees every node it
            # decides for anyone. A root anchor or a creator grant has no
            # such row, and raising one could reach a node nobody compared.
            for shared in _shared_winners(chain, working, principals, acc):
                if shared[0] in by_principal.get(shared[1], ()):
                    decided[shared] = min(decided.get(shared, had), had)
                    if denied_on_path:
                        unsafe.add(shared)
            entries.append(_Entry(name, chain, flags, had, acc.answer(), acc.own == NONE))
        classes.append(_Class(principals, tiers, members, entries))

    raised = set()
    for (name, principal), floor in sorted(decided.items()):
        if floor <= working[name][principal]:
            continue
        if (name, principal) in unsafe:
            result.raises_skipped += 1
            continue
        working[name][principal] = floor
        raised.add(name)
        result.rights.append(KeptRight(name, principal, floor, RAISE))

    held_everything = frozenset(admins)
    for alike in classes:
        _keep_for_class(
            result, alike, legacy=legacy, nodes=nodes, working=working, raised=raised, admins=held_everything
        )
    return result


def _keep_for_class(
    result: KeptRightsResult,
    alike: _Class,
    *,
    legacy: LegacyRights,
    nodes: Mapping[str, Mapping],
    working: Mapping[str, Mapping[str, int]],
    raised: set[str],
    admins: frozenset[str],
) -> None:
    """Pass 3 for one class: own grants and pins, root first, and the counts."""
    principals, members = alike.principals, alike.members
    own: dict[str, int] = {}
    for entry in alike.entries:
        holds, denied = entry.base, entry.denied
        if any(node in raised or node in own for node in entry.chain):
            acc = _engine(entry.chain, working, principals, own)
            holds, denied = acc.answer(), acc.own == NONE
        kind: Kind | None = None
        if holds < entry.had and denied:
            result.behind_deny += len(members)
        elif holds < entry.had:
            own[entry.name], kind = entry.had, PERSON
        elif holds > max(entry.had, entry.base) > NONE:
            own[entry.name], kind = max(entry.had, entry.base), PIN
        elif holds > max(entry.had, entry.base):
            # A pin at NONE would be a total deny on a person who holds no
            # deny row there, so no pin denies, wherever it would sit. Build's
            # own grants never ask for one; the person keeps `holds` and is
            # counted.
            result.pins_refused += len(members)
        final = own[entry.name] if kind else holds
        if kind:
            result.rights.extend(KeptRight(entry.name, member, final, kind) for member in members)
        if kind == PERSON and _user_only_role(legacy, entry, principals.user) < final:
            result.from_groups += len(members)
        if final >= EDIT and entry.base < UPLOAD and not entry.flags.get("upload"):
            result.upload_added += len(members)

        owner = nodes[entry.name].get("owner")
        counted = sum(1 for member in members if member != owner and member not in admins)
        if not counted:
            continue
        if entry.flags.get("read") and entry.flags.get("share") and not entry.flags.get("write"):
            result.share_lost += counted
        if final > entry.had:
            result.exceeded += counted
            unshadowed = {
                principal: tier for principal, tier in alike.tiers.items() if principal != ANONYMOUS
            }
            if final <= _ladder(_legacy_flags(legacy, entry.chain, unshadowed)):
                result.exceeded_by_public_deny += counted


def resolve(
    chain: list[str], grants: Mapping[str, Mapping[str, int]], user: str, groups: Iterable[str]
) -> int:
    """The role this pass reads for a signed-in `user` from `grants` on `chain`.

    The same answer as `access.effective_role` for a person with no link
    and no expiring grant; `test_grants` holds the two together.
    """
    return _engine(chain, grants, _principals(user, _tiers(user, groups))).answer()


def _named_nodes(legacy: LegacyRights) -> dict[str, set[str]]:
    """Each principal, and the nodes whose rows or shares name it."""
    by_principal: dict[str, set[str]] = {}
    for name, rows in legacy.rows.items():
        for row in rows:
            by_principal.setdefault(row.principal, set()).add(name)
    for name, shares in legacy.shares.items():
        for principal, _role in shares:
            by_principal.setdefault(principal, set()).add(name)
    return by_principal


def _named_deny_nodes(legacy: LegacyRights) -> set[str]:
    """The nodes holding a deny row for a group or a person.

    A `$GENERAL` or public deny binds everyone alike, so the one-group
    stand-ins already meet it. A deny for a group or a person binds only
    some, and a person can hold it beside the group a raise serves.
    """
    return {
        name
        for name, rows in legacy.rows.items()
        if any(row.flags["deny"] and row.principal not in (GENERAL, ANONYMOUS) for row in rows)
    }


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

    Every named group, and no group at all, also gets a class, with no
    members when nobody holds exactly that today. It stands for whoever
    joins the group, or the site, after Build.
    """
    named = set(by_principal) | {principal for rows in grants.values() for principal in rows}
    classes: dict[tuple[str, ...], list[str]] = {(): []}
    for principal in named:
        if principal.startswith(GROUP_PREFIX):
            classes[(principal[len(GROUP_PREFIX) :],)] = []
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


def _principals(user: str, tiers: Mapping[str, int]) -> Principals:
    return Principals(user=user, own=tuple(p for p in tiers if p != ANONYMOUS), open=(PUBLIC,))


def _legacy_flags(legacy: LegacyRights, chain: list[str], tiers: Mapping[str, int]) -> dict[str, bool]:
    """Each flag from the nearest row that sets it: True granted, False denied."""
    decided: dict[str, bool] = {}
    for name in reversed(chain):
        here = legacy.rows.get(name)
        if not here:
            continue
        rows = [row for row in here if row.principal in tiers]
        if len(rows) > 1:
            rows.sort(key=lambda row: (tiers[row.principal], not row.flags["deny"]))
        for row in rows:
            for flag in FLAGS:
                if row.flags[flag] and flag not in decided:
                    decided[flag] = not row.flags["deny"]
        if len(decided) == len(FLAGS):
            break
    return decided


def _ladder(decided: Mapping[str, bool]) -> int:
    """Legacy showed nothing without read, and shared only alongside write.

    Legacy could grant `write` without `upload`: a person edited files in a
    folder they could not add to, and the ladder has no role for that. Owner
    decision, 2026-11-16: that person keeps EDIT and so gains upload, the
    way §14.5's per-row mapping already turns `write` into EDIT. Each pair
    this pass lifts that way is counted in `upload_added`.
    """
    if not decided.get("read"):
        return NONE
    if decided.get("write"):
        return MANAGE if decided.get("share") else EDIT
    if decided.get("upload"):
        return UPLOAD
    if decided.get("comment"):
        return COMMENT
    return READ


def _user_only_role(legacy: LegacyRights, entry: _Entry, user: str) -> int:
    """What the person's own rows and shares gave on their own, with no group's."""
    tiers = {user: USER_TIER}
    return max(_ladder(_legacy_flags(legacy, entry.chain, tiers)), _shared_role(legacy, entry.name, tiers))


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
        here = grants.get(name)
        if here:
            # A busy folder holds grants for many people; ask only for this
            # person's own principals rather than offering every row.
            for principal in principals.all():
                role = here.get(principal)
                if role is not None:
                    acc.offer(principal, role, depth, principals)
        if own and name in own:
            acc.offer(principals.user, own[name], depth, principals)
    return acc


def _shared_winners(
    chain: list[str], grants: Mapping[str, Mapping[str, int]], principals: Principals, acc: Acc
) -> list[tuple[str, str]]:
    """The group or `$GENERAL` grants that decide this person, ties included.

    Grants tied at one depth and tier merge (§5): the person gets the
    highest of them, so raising any one of them reaches the whole tie.
    """
    if not acc.own or acc.own_tier == USER_TIER:
        return []
    name = chain[acc.own_depth]
    return [
        (name, principal)
        for principal in grants.get(name, {})
        if principal in principals.own and own_tier(principal, principals.user) == acc.own_tier
    ]
