"""The §11.3 node shape, the §11.4 page, and query-string coercion.

One serialiser answers both a list row and a detail fetch, so the two cannot
drift. It publishes sixteen fields and deliberately drops five that `_core`
rows carry: `path`, `trash_root`, `trashed_at`, `blob`, and `modified_by`. The
first three are tree bookkeeping a client never addresses, `blob` is a storage
id no client may name (§8.4), and `modified_by` is the framework's row author,
not Drive's.

`root` is the effective root node id (§3.1): a root node stores NULL and
reports its own id. `nodes.root_id` is the one place that rule lives.

Coercion is here rather than on the handler signatures because every value in a
query string is a string, and Frappe's own annotation checking answers a bad
one with 417 from outside the handler body, where the Drive error mapping
cannot reach it. These helpers raise `frappe.ValidationError`, which the route
boundary maps to 400.
"""

from collections.abc import Mapping
from datetime import date, datetime

import frappe
from frappe import _

from suite.drive._core import nodes

EXPANSIONS = ("access", "breadcrumbs", "preview")

# §11.5 gives no bound of its own. One gesture is one request, and a page is
# capped at 200 rows, so a batch is capped at the same number: a client cannot
# ask one request to do more work than it can ask one listing to report.
MAX_BATCH_NODES = nodes.MAX_PAGE_SIZE

_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")


def node_shape(row: Mapping) -> dict:
    """Return one stored node row as §11.3's shape."""
    return {
        "name": row.get("name"),
        "title": row.get("title"),
        "kind": row.get("kind"),
        "parent": row.get("parent"),
        "root": nodes.root_id(row),
        "state": row.get("state"),
        "size": int(row.get("size") or 0),
        "mime": row.get("mime"),
        "url": row.get("url"),
        "content_doctype": row.get("content_doctype"),
        "content_docname": row.get("content_docname"),
        "is_template": int(row.get("is_template") or 0),
        "owner": row.get("owner"),
        "creation": stamp(row.get("creation")),
        "modified": stamp(row.get("modified")),
        "content_modified": stamp(row.get("content_modified")),
    }


def version_shape(row: Mapping) -> dict:
    """Return one stored version row as the shape `GET .../versions` publishes.

    `blob` is dropped for the reason `node_shape` drops it: a storage id is not
    a client's to name, and the only way to the bytes is
    `GET /nodes/<id>/versions/<seq>/content`, which mints a signature after a
    READ check (§8.4, §6.8).
    """
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "seq": int(row.get("seq") or 0),
        "kind": row.get("kind"),
        "label": row.get("label"),
        "pinned": int(row.get("pinned") or 0),
        "actor": row.get("actor"),
        "size": int(row.get("size") or 0),
        "creation": stamp(row.get("creation")),
    }


def activity_shape(row: Mapping) -> dict:
    """Return one activity row as §9.4's columns, times formatted."""
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "action": row.get("action"),
        "actor": row.get("actor"),
        "at": stamp(row.get("at")),
        "via_link": row.get("via_link"),
        "client": row.get("client"),
        "detail": row.get("detail") or {},
    }


def notification_shape(row: Mapping) -> dict:
    """Return one notification pointer with the activity it renders from.

    `to_user` is withheld: §11.2 scopes this route to the caller, so the only
    value it could ever carry is the caller's own address.
    """
    return {
        "name": row.get("name"),
        "read": int(row.get("read") or 0),
        "creation": stamp(row.get("creation")),
        "activity": activity_shape(row.get("activity") or {}),
    }


def grant_shape(row: Mapping) -> dict:
    """Return one grant row as §11.2 publishes it, with its expiry formatted."""
    answer = {
        "name": row.get("name"),
        "node": row.get("node"),
        "principal": row.get("principal"),
        "role": row.get("role"),
        "expires_on": stamp(row.get("expires_on")),
        "has_password": bool(row.get("has_password")),
    }
    if row.get("url"):
        answer["url"] = row["url"]
    return answer


def explain_shape(result: Mapping) -> dict:
    """Return §5.8's explanation with its row times formatted.

    The keys are §5.8's exactly - `role`, `source`, and one row per candidate
    carrying `node`, `depth`, `principal`, `role`, `expires_on`, `pass`,
    `held`, and `winner`. `node` and `principal` are the provenance: which node
    a row sits on, and which principal it names. Nothing is added, because the
    accepted decision cites §5.8 for the shape a client may rely on.
    """
    return {
        "role": result.get("role"),
        "source": result.get("source"),
        "rows": [
            {
                "node": row.get("node"),
                "depth": row.get("depth"),
                "principal": row.get("principal"),
                "role": row.get("role"),
                "expires_on": stamp(row.get("expires_on")),
                "pass": row.get("pass"),
                "held": bool(row.get("held")),
                "winner": bool(row.get("winner")),
            }
            for row in result.get("rows") or ()
        ],
    }


def thread_shape(row: Mapping) -> dict:
    """Return one comment thread and its comments, times formatted."""
    return {
        "name": row.get("name"),
        "node": row.get("node"),
        "anchor": row.get("anchor"),
        "resolved": bool(row.get("resolved")),
        "resolved_by": row.get("resolved_by"),
        "resolved_at": stamp(row.get("resolved_at")),
        "creation": stamp(row.get("creation")),
        "comments": [comment_shape(comment) for comment in row.get("comments") or ()],
    }


def comment_shape(row: Mapping) -> dict:
    """Return one comment row, times formatted."""
    return {
        "name": row.get("name"),
        "thread": row.get("thread"),
        "node": row.get("node"),
        "content": row.get("content"),
        "author": row.get("author"),
        "author_name": row.get("author_name"),
        "mentions": list(row.get("mentions") or ()),
        "creation": stamp(row.get("creation")),
        "modified": stamp(row.get("modified")),
    }


def stamp(value) -> str | None:
    """Format one row time to the second, the shape §11.3 publishes."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d 00:00:00")
    return str(value)


def page(result: Mapping, rows: list) -> dict:
    """Wrap already-shaped rows in §11.4's opaque-cursor page."""
    return {"rows": rows, "next_cursor": result.get("next_cursor")}


def text(value, name: str) -> str | None:
    """Accept an absent or string argument, and refuse any other type."""
    if value is None:
        return None
    if not isinstance(value, str):
        _refuse(name)
    return value


def required_text(value, name: str) -> str:
    """Accept a non-blank string argument."""
    answer = text(value, name)
    if not answer or not answer.strip():
        _refuse(name)
    return answer


def whole(value, name: str, default: int) -> int:
    """Accept an absent, integer, or all-digit argument as a whole number.

    One rule for both spellings. A query string can only deliver digits, so a
    JSON body may not deliver a negative where `?limit=-1` is already refused:
    every argument this coerces is a size, an offset, a page bound, or a quota,
    and none of them has a meaning below zero.
    """
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        _refuse(name)
    if isinstance(value, int):
        if value < 0:
            _refuse(name)
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    _refuse(name)


def flag(value, name: str, default: bool) -> bool:
    """Accept an absent, boolean, or spelled-out truth argument."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.lower() in _TRUE:
            return True
        if value.lower() in _FALSE:
            return False
    _refuse(name)


def expansions(value, name: str = "expand") -> frozenset:
    """Accept the comma-separated subset of §11.3's three expansions."""
    if value is None or value == "":
        return frozenset()
    if not isinstance(value, str):
        _refuse(name)
    asked = tuple(item.strip() for item in value.split(",") if item.strip())
    unknown = sorted(set(asked) - set(EXPANSIONS))
    if unknown:
        frappe.throw(
            _("Drive expansion {0} is not supported").format(", ".join(unknown)),
            frappe.ValidationError,
        )
    return frozenset(asked)


def sequence(value, name: str) -> int:
    """Accept a version sequence: a whole number above zero, never absent."""
    if value is None or value == "":
        _refuse(name)
    answer = whole(value, name, 0)
    if answer < 1:
        _refuse(name)
    return answer


def name_list(value, name: str) -> tuple[str, ...]:
    """Accept a bounded, possibly empty list of distinct non-blank row ids.

    `identifiers` refuses an empty list because a batch that names no node is a
    malformed gesture. Marking no notifications read is not: it is the answer
    `{"read": 0}`, and a client clearing an already-empty badge should not get
    a 400 for it.
    """
    if not isinstance(value, list | tuple):
        _refuse(name)
    if len(value) > MAX_BATCH_NODES:
        frappe.throw(
            _("A Drive request may name at most {0} rows").format(MAX_BATCH_NODES),
            frappe.ValidationError,
        )
    answer = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            _refuse(name)
        if item not in answer:
            answer.append(item)
    return tuple(answer)


def identifiers(value, name: str) -> tuple[str, ...]:
    """Accept a bounded list of distinct non-blank node ids, in the order given."""
    if not isinstance(value, list | tuple) or not value:
        _refuse(name)
    if len(value) > MAX_BATCH_NODES:
        frappe.throw(
            _("A Drive batch may name at most {0} nodes").format(MAX_BATCH_NODES),
            frappe.ValidationError,
        )
    answer = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            _refuse(name)
        if item not in answer:
            answer.append(item)
    return tuple(answer)


def patch(value, name: str) -> dict:
    """Accept a non-empty mapping of the fields `PATCH /nodes/<id>` takes.

    §11.5: "`patch` takes the same fields as `PATCH /nodes/<id>`", which §11.2
    gives five whole bodies. Bytes are not among them on either route.
    """
    if not isinstance(value, Mapping) or not value:
        _refuse(name)
    allowed = ("title", "parent", "state", "content_modified")
    unknown = sorted(set(value) - set(allowed))
    if unknown:
        frappe.throw(
            _("A Drive patch does not take {0}").format(", ".join(unknown)),
            frappe.ValidationError,
        )
    return dict(value)


def _refuse(name: str) -> None:
    frappe.throw(_("Drive argument {0} is invalid").format(name), frappe.ValidationError)
