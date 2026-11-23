"""Dead-property store (RFC 4918 §4.4) on the Drive DAV Property DocType.

Rows are keyed by entity id, so MOVE and rename carry dead properties for
free; COPY clones them. Values store the full serialized element — namespace
declarations included — so client extension XML round-trips byte-faithfully
(prefixes may be rewritten, URIs are contractual).
"""

import frappe
from lxml import etree

from suite.drive.webdav.xmlutil import parse_fragment

MAX_VALUE_BYTES = 64 * 1024
MAX_PROPS_PER_ENTITY = 200


def split_clark(tag: str) -> tuple[str, str]:
    """'{ns}local' -> (ns, local); no-namespace tags have ns ''."""
    if tag.startswith("{"):
        ns, _, local = tag[1:].partition("}")
        return ns, local
    return "", tag


def clark(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}" if ns else local


def get_dead_props(entity_names: list[str]) -> dict[str, dict[str, etree._Element]]:
    """{entity: {clark_tag: element}} for a whole listing in one query."""
    if not entity_names:
        return {}
    rows = frappe.get_all(
        "Drive DAV Property",
        filters={"entity": ["in", entity_names]},
        fields=["entity", "ns", "prop_name", "value_xml"],
    )
    result: dict[str, dict[str, etree._Element]] = {}
    for row in rows:
        element = parse_fragment(row.value_xml)
        if element is None:
            continue
        result.setdefault(row.entity, {})[clark(row.ns, row.prop_name)] = element
    return result


def upsert(entity: str, element: etree._Element) -> None:
    ns, local = split_clark(element.tag)
    serialized = etree.tostring(element, encoding="unicode")
    existing = frappe.db.get_value("Drive DAV Property", {"entity": entity, "ns": ns, "prop_name": local})
    if existing:
        frappe.db.set_value("Drive DAV Property", existing, "value_xml", serialized, update_modified=False)
    else:
        frappe.get_doc(
            {
                "doctype": "Drive DAV Property",
                "entity": entity,
                "ns": ns,
                "prop_name": local,
                "value_xml": serialized,
            }
        ).insert(ignore_permissions=True)


def remove(entity: str, tag: str) -> None:
    """Removing an absent property is a success per RFC — silently idempotent."""
    ns, local = split_clark(tag)
    name = frappe.db.get_value("Drive DAV Property", {"entity": entity, "ns": ns, "prop_name": local})
    if name:
        frappe.db.delete("Drive DAV Property", {"name": name})


def count(entity: str) -> int:
    return frappe.db.count("Drive DAV Property", {"entity": entity})


def existing_tags(entity: str, tags: set[str]) -> set[str]:
    """Which of these Clark-notation tags the entity already stores.

    `upsert` replaces a row it finds, so a `set` on a property already there
    adds nothing to the per-entity count. The cap has to be told that, or a
    client sitting at it gets 507 for overwriting its own property.
    """
    if not tags:
        return set()
    by_pair = {split_clark(tag): tag for tag in tags}
    rows = frappe.get_all(
        "Drive DAV Property",
        filters={"entity": entity, "prop_name": ["in", sorted({local for _, local in by_pair})]},
        fields=["ns", "prop_name"],
    )
    return {by_pair[pair] for row in rows if (pair := (row.ns or "", row.prop_name)) in by_pair}


def copy_props(source: str, target: str) -> None:
    for row in frappe.get_all(
        "Drive DAV Property",
        filters={"entity": source},
        fields=["ns", "prop_name", "value_xml"],
    ):
        frappe.get_doc(
            {
                "doctype": "Drive DAV Property",
                "entity": target,
                "ns": row.ns,
                "prop_name": row.prop_name,
                "value_xml": row.value_xml,
            }
        ).insert(ignore_permissions=True)


def value_size(element: etree._Element) -> int:
    return len(etree.tostring(element, encoding="utf-8"))
