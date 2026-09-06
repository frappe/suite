"""Load a composite deck's references in authorized groups (§6.2, §6.6).

A composite deck names other decks and renders them as one. Each referenced
deck is authorized on its own, and a reference the caller reaches only through
a share link needs that link's code in `X-Drive-Links`. One request carries at
most 20 codes (§4.7), so a composite with more separately shared references
than that cannot be loaded in one call. This module is how it is loaded in
several.

This is a Slides operation. Drive gains no route and no permission rule from
it: every answer below comes from `drive.check(node, drive.READ)`, the same
point check the whole-deck read path already runs.

## The two calls

    composite_manifest(name)                -> the reference list, no content
    composite_group(name, references)       -> content for one bounded group

The manifest costs one point check, on the composite itself. The group costs
one on the composite plus one per requested reference. Neither call is ever
answered from a remembered client association: the client names references, and
the server resolves each one to a deck and a node itself.

## Request

`composite_manifest`

| Field | Type | Rule |
|---|---|---|
| `name` | string | the composite deck's docname |

`composite_group`

| Field | Type | Rule |
|---|---|---|
| `name` | string | the composite deck's docname |
| `references` | list of strings, or its JSON text | 1 to `GROUP_LIMIT` ids, no repeats |

A reference id is the `Reference Presentation` row's own name, as the manifest
gave it. It is not a deck docname and not a node id, and neither is accepted in
its place: both fail the membership check.

## Response

`composite_manifest`

```json
{"presentation": "deck-7", "node": "a1b2c3d4e5",
 "modified": "2026-09-06 11:04:12.882913",
 "group_limit": 19, "reference_count": 21,
 "references": [{"reference": "b7c1…", "index": 1, "presentation": "deck-8"}]}
```

`composite_group`

```json
{"presentation": "deck-7", "node": "a1b2c3d4e5",
 "references": [
   {"reference": "b7c1…", "index": 1, "presentation": "deck-8",
    "readable": true, "node": "f9e8d7c6b5", "composite": false, "slides": [...]},
   {"reference": "c2d3…", "index": 2, "presentation": "deck-9",
    "readable": false, "node": null, "composite": null, "slides": null}]}
```

The `references` list holds exactly one entry per requested id, in the order
they were requested, never reordered and never dropped. An unreadable reference
carries `readable: false` and no content at all: no node id, because a node id
is the handle every Drive route takes (§5.4), and no slides. The client decides
whether to draw a placeholder (§6.6).

## The bound, and why it is 19

`GROUP_LIMIT` is `LINK_HEADER_LIMIT - 1`. §6.6 says to count the composite's
own code when a group needs it, so the worst honest group is one code for the
composite plus one for each of 19 references, which is the 20 the header
allows. The server bounds the group whether or not codes were sent, because it
cannot know which references the client reached through a link and must not
answer a request the client could not have authorized in full.

Supplied ids are counted before duplicates are removed, the way §4.7 counts
header items, so repeating an id cannot buy a larger group.

## Refusals

| Cause | Raised |
|---|---|
| `references` is not a list of 1+ non-empty strings | `frappe.ValidationError` |
| more than `GROUP_LIMIT` ids supplied | `frappe.ValidationError` |
| an id supplied twice | `frappe.ValidationError` |
| an id that is not one of this composite's references | `frappe.ValidationError` |
| more than 20 items in `X-Drive-Links` | `frappe.ValidationError` (from Drive) |
| the name is not a composite, is not in Drive, or is unreadable | `frappe.PermissionError`, one message |

The request-shape refusals run before the composite is resolved. They describe
the request, disclose nothing about the site, and keep a malformed call off the
database.

`REFUSED` is the whole-deck read path's message, unchanged. Both routes are
guest-reachable, so "no such deck", "not a composite", and "a composite you
cannot read" are one answer with one text (§5.4).

Membership is checked after authorization. A caller who cannot read the
composite learns nothing about which ids belong to it.

## Groups are independent

Nothing is remembered between groups. Each call re-reads the reference list and
re-runs every check, so a grant revoked between two groups makes the reference
unreadable in the second one, and a grant added between them makes it readable.
A reference id keeps its value and its place across those changes, so a
placeholder the client drew for an unreadable reference does not move.

## A reference that is itself a composite

It is answered, marked `composite: true`, with its own `slides` list, which is
empty: a composite carries no slides of its own. There is no recursion. Ticket
18 left the semantics here; the rule is that one call resolves one level, and a
client that wants the inner deck's references asks for its manifest, which runs
that deck's own checks.
"""

import json
from typing import NoReturn

import frappe
from frappe import _

from suite import drive
from suite.slides import drive as slides_drive

DOCTYPE = slides_drive.DOCTYPE
NODE_FIELD = slides_drive.NODE_FIELD

# One code for the composite plus one per reference has to fit the 20 items
# §4.7 allows in `X-Drive-Links`. `suite/drive/_core/principals.py` owns that
# 20; `test_composite_groups` pins this number to it so the two cannot drift.
GROUP_LIMIT = 19

# The whole-deck read path's refusal, word for word. A guest-reachable route
# that answered a different text for a name that is a composite would say which
# names are composites (§5.4).
REFUSED = "Presentation is not public"


@frappe.whitelist(allow_guest=True)
def composite_manifest(name: str) -> dict:
    """Answer the composite's reference list, with no reference content.

    One point check, on the composite. The references are named, not opened, so
    this call costs nothing per reference and tells the caller nothing it could
    not learn from the whole-deck read path.
    """
    docname, node = _authorized_composite(name)
    rows = slides_drive.composite_reference_rows(docname)
    return {
        "presentation": docname,
        "node": node,
        # The client's cue that a held reference list has gone stale. A save
        # that rewrites the table mints new ids, and this moves with it.
        "modified": str(frappe.db.get_value(DOCTYPE, docname, "modified")),
        "group_limit": GROUP_LIMIT,
        "reference_count": len(rows),
        "references": rows,
    }


@frappe.whitelist(allow_guest=True)
def composite_group(name: str, references=None) -> dict:
    """Answer one bounded group of this composite's references.

    The order is the request's, the count is the request's, and every entry
    states whether the caller may read it. Nothing is dropped and nothing
    unreadable carries content.
    """
    requested = _requested_references(references)
    docname, node = _authorized_composite(name)
    members = {row["reference"]: row for row in slides_drive.composite_reference_rows(docname)}
    _refuse_non_members(requested, members)
    return {
        "presentation": docname,
        "node": node,
        "references": [_answer(members[reference]) for reference in requested],
    }


def _requested_references(references) -> list[str]:
    """Read the requested ids, or refuse the request before touching the site.

    Every refusal here is about the request itself. None of them depends on the
    composite, so none of them can be used to ask a question about it.
    """
    if isinstance(references, str):
        try:
            references = json.loads(references)
        except ValueError:
            _refuse_shape()
    if not isinstance(references, list) or not references:
        _refuse_shape()
    if not all(isinstance(reference, str) and reference for reference in references):
        _refuse_shape()
    # Counted as supplied, before the duplicates come out. §4.7 counts header
    # items the same way, so that filtering cannot buy a larger set.
    if len(references) > GROUP_LIMIT:
        frappe.throw(
            _("A composite group takes at most {0} references").format(GROUP_LIMIT),
            frappe.ValidationError,
        )
    if len(set(references)) != len(references):
        frappe.throw(
            _("A composite group cannot name the same reference twice"),
            frappe.ValidationError,
        )
    return list(references)


def _refuse_shape() -> NoReturn:
    frappe.throw(
        _("A composite group is a list of reference ids"),
        frappe.ValidationError,
    )


def _authorized_composite(name: str) -> tuple[str, str]:
    """Refuse unless `name` is a linked composite this caller may read.

    The point check is not wrapped in an access-swallowing helper on purpose.
    `drive.check` raises a `DriveError` for every access answer, and anything
    else it raises is not an access answer: an oversized `X-Drive-Links` header
    is a bare `frappe.ValidationError` from `parse_link_header`, and §6.2 wants
    that refusal stated rather than turned into "you cannot read this".
    """
    row = frappe.db.get_value(DOCTYPE, name, ["name", NODE_FIELD, "is_composite"], as_dict=True)
    if not row or not row.get("is_composite") or not row.get(NODE_FIELD):
        _refuse()
    try:
        drive.check(row[NODE_FIELD], drive.READ)
    except drive.DriveError:
        _refuse()
    return row["name"], row[NODE_FIELD]


def _refuse() -> NoReturn:
    frappe.throw(REFUSED, frappe.PermissionError)


def _refuse_non_members(requested: list[str], members: dict[str, dict]) -> None:
    """Refuse a request naming anything that is not this composite's reference.

    A deck docname, a Drive node id, and a reference id from another composite
    all land here. Remembered client associations confer no authority (§6.2):
    the only handle this call accepts is one this composite's own table
    supplies, and the answer is the same for an id that never existed and one
    that belongs somewhere else.
    """
    if any(reference not in members for reference in requested):
        frappe.throw(
            _("A composite group may only name this presentation's own references"),
            frappe.ValidationError,
        )


def _answer(row: dict) -> dict:
    """Answer one reference: its content, or the fact that it has none for you."""
    node = frappe.db.get_value(DOCTYPE, row["presentation"], NODE_FIELD) if row["presentation"] else None
    answer = {
        "reference": row["reference"],
        "index": row["index"],
        "presentation": row["presentation"],
        "readable": False,
        "node": None,
        "composite": None,
        "slides": None,
    }
    if not node or not slides_drive.node_is_readable(node):
        return answer

    deck = frappe.get_cached_doc(DOCTYPE, row["presentation"])
    answer["readable"] = True
    answer["node"] = node
    answer["composite"] = bool(deck.is_composite)
    answer["slides"] = [slide.as_dict() for slide in deck.slides]
    return answer
