"""PROPPATCH: atomic per RFC 4918 §9.2 — validate every instruction first, and
on any failure apply nothing, reporting the failing property's real status and
424 Failed Dependency for the rest.

Windows Explorer PROPPATCHes urn:schemas-microsoft-com: Win32* properties
after every copy and errors loudly if they are refused; they are stored as
ordinary dead properties, and Win32LastModifiedTime additionally lands in
Drive's real mtime field.
"""

from dataclasses import dataclass

import frappe
from lxml import etree
from werkzeug.http import parse_date
from werkzeug.wrappers import Response

from suite.drive._core import nodes as node_core
from suite.drive._core.access import require
from suite.drive._core.roles import EDIT
from suite.drive.webdav import deadprops, pathmap
from suite.drive.webdav.conditional import evaluate_preconditions
from suite.drive.webdav.context import DavContext
from suite.drive.webdav.errors import BadRequest, Forbidden, NotFoundError
from suite.drive.webdav.xmlutil import XML_BODY_CAP, MultistatusBuilder, dav, parse_xml

# the live DAV: set this server computes — never client-writable
PROTECTED = frozenset(
    dav(name)
    for name in (
        "displayname",
        "resourcetype",
        "getcontentlength",
        "getcontenttype",
        "getetag",
        "getlastmodified",
        "creationdate",
        "lockdiscovery",
        "supportedlock",
        "quota-used-bytes",
        "quota-available-bytes",
    )
)

WIN32_MTIME = "{urn:schemas-microsoft-com:}Win32LastModifiedTime"


@dataclass
class Instruction:
    action: str  # "set" | "remove"
    tag: str
    element: etree._Element | None  # for sets
    status: int = 200
    condition: str | None = None


def handle(ctx: DavContext) -> Response:
    resolved = pathmap.resolve(ctx.segments, ctx.user)
    if resolved.is_mount:
        raise Forbidden("Cannot modify the WebDAV namespace root's properties.")
    if not resolved.exists:
        raise NotFoundError("Resource not found.")

    row = resolved.node
    # §12.1: EDIT on the node. Below READ `require` raises DriveNotFound, so
    # an unreadable resource is 404 and never 403 - indistinguishable from
    # absent, matching GET and PROPFIND, so a write verb leaks no existence.
    require(row, EDIT, ctx.principals)
    evaluate_preconditions(ctx.request, row)

    from suite.drive.webdav import locks

    locks.enforce(ctx, entity=row.name)

    instructions = _parse_body(ctx)
    _validate(row, instructions)

    failed = any(instruction.status != 200 for instruction in instructions)
    if not failed:
        _apply(ctx, row, instructions)

    return _multistatus(ctx, resolved, instructions, failed)


def _parse_body(ctx: DavContext) -> list[Instruction]:
    root = parse_xml(ctx.body.read_all(XML_BODY_CAP))
    if root is None or root.tag != dav("propertyupdate"):
        raise BadRequest("Expected a DAV:propertyupdate request body.")

    instructions: list[Instruction] = []
    for directive in root:
        if not isinstance(directive.tag, str) or directive.tag not in (dav("set"), dav("remove")):
            continue
        action = "set" if directive.tag == dav("set") else "remove"
        prop = directive.find(dav("prop"))
        if prop is None:
            raise BadRequest("Malformed propertyupdate: missing DAV:prop.")
        for element in prop:
            if not isinstance(element.tag, str):
                continue
            instructions.append(Instruction(action, element.tag, element if action == "set" else None))
    if not instructions:
        raise BadRequest("Empty propertyupdate.")
    return instructions


def _validate(row: frappe._dict, instructions: list[Instruction]) -> None:
    additions = 0
    for instruction in instructions:
        if instruction.tag in PROTECTED:
            instruction.status = 403
            instruction.condition = "cannot-modify-protected-property"
        elif instruction.action == "set":
            if deadprops.value_size(instruction.element) > deadprops.MAX_VALUE_BYTES:
                instruction.status = 507
            elif instruction.tag == WIN32_MTIME and not parse_date(instruction.element.text or ""):
                instruction.status = 409
            else:
                additions += 1

    if additions and deadprops.count(row.name) + additions > deadprops.MAX_PROPS_PER_ENTITY:
        for instruction in instructions:
            if instruction.action == "set" and instruction.status == 200:
                instruction.status = 507


def _apply(ctx: DavContext, row: frappe._dict, instructions: list[Instruction]) -> None:
    for instruction in instructions:
        if instruction.action == "set":
            deadprops.upsert(row.name, instruction.element)
            if instruction.tag == WIN32_MTIME:
                from suite.drive.webdav.properties import to_site_naive

                # §8.11: Win32LastModifiedTime is a client mtime, so it lands
                # in `content_modified` through the workflow that owns it -
                # one indexed update, no version, no charge, no activity row.
                node_core.update(
                    ctx.principals,
                    row.name,
                    content_modified=to_site_naive(parse_date(instruction.element.text)),
                )
        else:
            deadprops.remove(row.name, instruction.tag)


def _multistatus(ctx: DavContext, resolved, instructions: list[Instruction], failed: bool) -> Response:
    builder = MultistatusBuilder()
    response = builder.add_response(pathmap.href_for(ctx.segments, resolved.is_collection))

    by_status: dict[int, list[etree._Element]] = {}
    for instruction in instructions:
        # on any failure, untouched instructions report 424 Failed Dependency
        status = 424 if failed and instruction.status == 200 else instruction.status
        by_status.setdefault(status, []).append(etree.Element(instruction.tag))

    for status, props in sorted(by_status.items()):
        response.propstat(status, props)
    return builder.build()
