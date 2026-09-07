"""RFC 4918 §10.4 If header parser and evaluator.

Pure module — no frappe imports — so the grammar is unit-testable without a
site. Two deliberately distinct uses:

- evaluate() is the conditional-request gate: false means 412, checked before
  any lock enforcement;
- all_tokens() feeds lock satisfaction under the lenient "mere submission"
  rule — a token counts as submitted wherever it appears, negated or not
  (the reading Apache mod_dav uses and litmus expects).
"""

import re
from collections.abc import Callable
from dataclasses import dataclass


class BadIfHeader(ValueError):
    pass


@dataclass(frozen=True)
class Condition:
    negated: bool
    token: str | None
    etag: str | None


@dataclass(frozen=True)
class ConditionList:
    conditions: tuple[Condition, ...]  # AND


@dataclass(frozen=True)
class TaggedList:
    resource_href: str | None  # None = the request-URI (No-tag-list)
    lists: tuple[ConditionList, ...]  # OR


@dataclass(frozen=True)
class IfHeader:
    tagged: tuple[TaggedList, ...]

    def all_tokens(self) -> frozenset[str]:
        return frozenset(
            condition.token
            for group in self.tagged
            for condition_list in group.lists
            for condition in condition_list.conditions
            if condition.token
        )

    def evaluate(
        self,
        resolve_href: Callable[[str | None], str | None],
        get_etag: Callable[[str], str | None],
        get_active_tokens: Callable[[str], frozenset[str]],
    ) -> bool:
        """True when any list, evaluated against its bound resource, holds.

        An unknown token (DAV:no-lock included) is simply never active, which
        makes `(Not <DAV:no-lock>)` the standard always-true production.
        """
        if not self.tagged:
            return True
        for group in self.tagged:
            entity = resolve_href(group.resource_href)
            tokens = get_active_tokens(entity) if entity else frozenset()
            etag = get_etag(entity) if entity else None
            for condition_list in group.lists:
                if all(_condition_holds(condition, tokens, etag) for condition in condition_list.conditions):
                    return True
        return False


def _condition_holds(condition: Condition, active_tokens: frozenset[str], etag: str | None) -> bool:
    if condition.token is not None:
        result = condition.token in active_tokens
    else:
        result = etag is not None and condition.etag == etag
    return not result if condition.negated else result


EMPTY_IF = IfHeader(())

_TOKENIZER = re.compile(
    r"""
    \s*(?:
        (?P<open>\() | (?P<close>\)) |
        (?P<not>Not\b) |
        <(?P<token>[^>]*)> |
        \[(?P<etag>[^\]]*)\]
    )
    """,
    re.VERBOSE | re.IGNORECASE,
)


def parse_if_header(value: str | None) -> IfHeader:
    if not value or not value.strip():
        return EMPTY_IF

    groups: list[TaggedList] = []
    current_href: str | None = None
    current_lists: list[ConditionList] = []
    conditions: list[Condition] | None = None
    negate = False
    position = 0

    def flush_group():
        """Close the group a Resource-Tag opened, or refuse a tag with no list.

        `Tagged-list = Resource-Tag 1*List` (§10.4.2), so a tag standing alone
        is not the grammar. Dropping it silently is how a header cut off after
        a complete list still evaluated: `(<token> [etag]) </dav/other>` read
        as the first list on its own, and the write it guards happened on the
        half that arrived.
        """
        nonlocal current_lists
        if current_href is not None and not current_lists:
            raise BadIfHeader("Resource-Tag with no state list in If header.")
        if current_lists:
            groups.append(TaggedList(current_href, tuple(current_lists)))
            current_lists = []

    while position < len(value):
        match = _TOKENIZER.match(value, position)
        if not match:
            if value[position:].strip():
                raise BadIfHeader(f"Unparsable If header at: {value[position:]!r}")
            break
        position = match.end()

        if match.group("open"):
            if conditions is not None:
                raise BadIfHeader("Nested list in If header.")
            conditions = []
        elif match.group("close"):
            if conditions is None or negate:
                raise BadIfHeader("Unbalanced If header list.")
            if not conditions:
                raise BadIfHeader("Empty If header list.")
            current_lists.append(ConditionList(tuple(conditions)))
            conditions = None
        elif match.group("not"):
            if conditions is None:
                raise BadIfHeader("Not outside a list.")
            if negate:
                # `Condition = ["Not"] (State-token | "[" entity-tag "]")`:
                # one at most. A second was absorbed by the first, so
                # `Not Not <t>` read as `Not <t>` — the opposite of what it
                # says, decided in the gate that admits a write.
                raise BadIfHeader("Repeated Not in If header condition.")
            negate = True
        elif match.group("token") is not None:
            content = match.group("token")
            if conditions is None:
                # a Resource-Tag starts a new tagged group
                flush_group()
                current_href = content
            else:
                conditions.append(Condition(negate, content, None))
                negate = False
        elif match.group("etag") is not None:
            if conditions is None:
                raise BadIfHeader("Entity-tag outside a list.")
            conditions.append(Condition(negate, None, match.group("etag").strip()))
            negate = False

    if conditions is not None:
        raise BadIfHeader("Unterminated If header list.")
    flush_group()
    if not groups:
        raise BadIfHeader("If header contains no lists.")
    return IfHeader(tuple(groups))
