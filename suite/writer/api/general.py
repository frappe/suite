import frappe
from pypika import CustomFunction, Order
from pypika import functions as fn

from suite import drive
from suite.drive.api.permissions import get_user_access
from suite.drive.utils import FILE_FIELDS, GENERAL_USER, STATUS_ACTIVE
from suite.writer import drive as writer_drive
from suite.writer.search import WriterSearch

DriveUser = frappe.qb.DocType("User")
UserGroupMember = frappe.qb.DocType("User Group Member")
DriveFile = frappe.qb.DocType("File")
DriveNode = frappe.qb.DocType("Drive Node")
DriveGrant = frappe.qb.DocType("Drive Grant")
DrivePermission = frappe.qb.DocType("Drive Permission")
DriveFavourite = frappe.qb.DocType("Drive Favourite")
Recents = frappe.qb.DocType("Drive Recent")

Binary = CustomFunction("BINARY", ["expression"])

DOCTYPE = writer_drive.DOCTYPE

# The two site-wide principals, in the spelling `Drive Grant` stores. Legacy
# published one number for both: -2 "anyone with the link", -1 "everyone on
# this site", otherwise the count of people it is shared with.
PUBLIC_PRINCIPAL = "$PUBLIC"
GENERAL_PRINCIPAL = "$GENERAL"
LINK_PREFIX = "$LINK:"


@frappe.whitelist()
def get_document_list(
    start: int = 0,
    limit: int = 20,
):
    """The caller's documents, newest interaction first, off whichever store holds them.

    Ticket 29 registered `Writer Document` in `drive_content_types`, so every
    document written since then is a `Drive Node` with no `File` row, and the
    legacy query alone answered a list with the caller's newest documents
    missing from it. Both halves are read: node rows, and the `File` rows no
    node holds. §14.3 gives a migrated document the same id in both stores, so
    a row is taken from the node half whenever the node half has it, and the
    legacy half shrinks to nothing once Build has run.

    Both halves are read whole and merged in Python, the way
    `suite.drive.http.shims._merged_folder_page` answers the same problem: a
    page cannot be merged on its own, because the second page would restart
    the order. The list is bounded by what one person owns or has opened.
    """
    user = frappe.session.user
    rows = _node_documents(user)
    seen = {row["name"] for row in rows}
    rows += [row for row in _legacy_documents(user) if row["name"] not in seen]
    rows.sort(key=_recency, reverse=True)

    offset = max(int(start or 0), 0)
    window = max(int(limit or 0), 0)
    page = rows[offset : offset + window] if window else rows[offset:]
    has_next_page = offset + len(page) < len(rows)

    accessible = []
    for row in page:
        access = get_user_access(row["name"])
        # A stale "recently opened" entry can outlive the caller's access.
        if not access.get("read"):
            continue
        accessible.append(row)
        row["html"] = frappe.get_cached_value(DOCTYPE, row["content_docname"], "html")
        row |= access

    # Return in the format useList expects
    frappe.response["data"] = accessible
    frappe.response["has_next_page"] = has_next_page


def _recency(row) -> str:
    """Sort key: the interaction the list orders by, as a comparable string.

    `accessed` and `modified` arrive as `datetime` from one store and can
    arrive as `str` from the cache in the other, and a row that was never
    opened carries `None`. One string keeps the merge total without asking the
    two stores to agree on a type.
    """
    return str(row.get("recent") or "")


def _node_documents(user: str) -> list[dict]:
    """Every Writer document node the caller owns or has opened, in legacy field names."""
    opened = frappe.qb.from_(Recents).select(Recents.node).where(Recents.user == user)
    recent_field = fn.Coalesce(Recents.opened_at, DriveNode.content_modified, DriveNode.modified)
    query = (
        frappe.qb.from_(DriveNode)
        .left_join(Recents)
        .on((Recents.node == DriveNode.name) & (Recents.user == user))
        .left_join(DriveFavourite)
        .on((DriveFavourite.entity == DriveNode.name) & (DriveFavourite.user == user))
        .select(
            DriveNode.name,
            DriveNode.title,
            DriveNode.parent,
            DriveNode.size,
            DriveNode.mime,
            DriveNode.content_doctype,
            DriveNode.content_docname,
            DriveNode.creation,
            DriveNode.content_modified,
            DriveNode.modified,
            DriveNode.owner,
            DriveFavourite.name.as_("is_favourite"),
            Recents.opened_at.as_("accessed"),
            recent_field.as_("recent"),
        )
        .where(
            (DriveNode.content_doctype == DOCTYPE)
            & (DriveNode.state == "Active")
            & (DriveNode.is_template == 0)
        )
        .where((DriveNode.owner == user) | (DriveNode.name.isin(opened)))
    )
    rows = query.run(as_dict=True)
    if not rows:
        return []
    markers = _node_share_markers([row["name"] for row in rows])
    return [
        {
            "name": row["name"],
            "file_name": row["title"],
            "folder": row["parent"],
            # `hide_storage_key` blanked this on the old surface too, and a
            # node publishes no `file_url` for anything but a link (§11.4).
            "file_url": None,
            "file_size": int(row["size"] or 0),
            "file_type": "Document",
            "is_folder": 0,
            "content_doctype": row["content_doctype"],
            "content_docname": row["content_docname"],
            "creation": row["creation"],
            "modified": row["content_modified"] or row["modified"],
            "owner": row["owner"],
            # §14.4 drops the attachment join; published as None, never guessed.
            "attached_to_doctype": None,
            "attached_to_name": None,
            "mime_type": row["mime"],
            "recent": row["recent"],
            "is_favourite": row["is_favourite"],
            "accessed": row["accessed"],
            # A content document node is a leaf in every listing (§8.10). Its
            # child nodes are the media inside it, which the old count of
            # `File.folder` children never included either.
            "children": 0,
            "share_count": markers.get(row["name"], 0),
        }
        for row in rows
    ]


def _node_share_markers(names: list[str]) -> dict[str, int]:
    """Legacy's one share number, read off `Drive Grant`: -2 public, -1 site, else count.

    A share link is not a person and was never counted; a denial is `role = 0`
    and is not a share either.
    """
    grants = (
        frappe.qb.from_(DriveGrant)
        .select(DriveGrant.node, DriveGrant.principal)
        .where(DriveGrant.node.isin(names) & (DriveGrant.role > 0))
    ).run(as_dict=True)

    markers = dict.fromkeys(names, 0)
    counts: dict[str, int] = {}
    public, general = set(), set()
    for grant in grants:
        principal = grant["principal"]
        if principal == PUBLIC_PRINCIPAL:
            public.add(grant["node"])
        elif principal == GENERAL_PRINCIPAL:
            general.add(grant["node"])
        elif not principal.startswith(LINK_PREFIX):
            counts[grant["node"]] = counts.get(grant["node"], 0) + 1
    for name in names:
        if name in public:
            markers[name] = -2
        elif name in general:
            markers[name] = -1
        else:
            markers[name] = counts.get(name, 0)
    return markers


def _legacy_documents(user: str) -> list[dict]:
    """The old query, for the `File` rows no node holds yet (§10.2, §14.6)."""
    recently_opened = frappe.qb.from_(Recents).select(Recents.node).where(Recents.user == user)

    recent_field = fn.Coalesce(Recents.opened_at, DriveFile.file_modified)
    query = (
        frappe.qb.from_(DriveFile)
        .select(
            *FILE_FIELDS,
            DriveFile.mime_type,
            recent_field.as_("recent"),
        )
        .where((DriveFile.status == STATUS_ACTIVE) & (DriveFile.mime_type == "frappe_doc"))
        .where((DriveFile.owner == user) | (DriveFile.name.isin(recently_opened)))
    )

    query = (
        query.left_join(DriveFavourite)
        .on((DriveFavourite.entity == DriveFile.name) & (DriveFavourite.user == user))
        .select(DriveFavourite.name.as_("is_favourite"))
    )

    query = query.left_join(Recents).on(
        (Recents.node == DriveFile.name) & (Recents.user == frappe.session.user)
    )

    query = query.select(Recents.opened_at.as_("accessed"))
    res = query.run(as_dict=True)
    if not res:
        return []

    child_count_query = (
        frappe.qb.from_(DriveFile)
        .where(DriveFile.status == STATUS_ACTIVE)
        .select(DriveFile.folder, fn.Count("*").as_("child_count"))
        .groupby(DriveFile.folder)
    )
    share_query = (
        frappe.qb.from_(DriveFile)
        .right_join(DrivePermission)
        .on(DrivePermission.entity == DriveFile.name)
        .where((DrivePermission.user.notin(["", GENERAL_USER])) & (DrivePermission.deny == 0))
        .select(DriveFile.name, fn.Count("*").as_("share_count"))
        .groupby(DriveFile.name)
    )
    public_files_query = (
        frappe.qb.from_(DrivePermission)
        .where((DrivePermission.user == "") & (DrivePermission.deny == 0))
        .select(DrivePermission.entity)
    )
    general_files_query = (
        frappe.qb.from_(DrivePermission)
        .where((DrivePermission.user == GENERAL_USER) & (DrivePermission.deny == 0))
        .select(DrivePermission.entity)
    )
    public_files = set(k[0] for k in public_files_query.run())
    general_files = set(k[0] for k in general_files_query.run())

    children_count = dict(child_count_query.run())
    share_count = dict(share_query.run())

    for r in res:
        r["children"] = children_count.get(r["name"], 0)
        if r["name"] in public_files:
            r["share_count"] = -2
        elif r["name"] in general_files:
            r["share_count"] = -1
        else:
            r["share_count"] = share_count.get(r["name"], 0)
    return res


@frappe.whitelist()
def get_versions(id: str):
    """One document's history, off whichever store holds it.

    A linked document's history is `Drive Node Version` (§9.1): every version
    is one `writer-document/1` envelope Writer wrote itself, so Writer reads
    the HTML back out of it. Answering the legacy `Writer Version` query for a
    linked document said "this document has no history", which is a wrong
    answer rather than a missing one - the rows are simply in the other store.

    The published shape is the legacy one the sidebar reads, oldest first.
    """
    if not get_user_access(id).get("write"):
        frappe.throw("You don't have write access.", frappe.PermissionError)

    node = _node_of(id)
    if node:
        return _drive_versions(node)

    doc_name = frappe.db.get_value("File", id, "content_docname")

    versions = frappe.get_all(
        "Writer Version",
        filters={"doc": doc_name},
        fields=["name", "snapshot", "title", "manual", "creation"],
        order_by="creation asc",
    )

    return versions


def _node_of(entity: str) -> str | None:
    """The Drive node behind one document id, or None for a legacy `File`."""
    if not entity:
        return None
    if frappe.db.get_value("Drive Node", entity, "content_doctype") == DOCTYPE:
        return entity
    return None


def _drive_versions(node: str) -> list[dict]:
    """Publish a linked document's Drive history in the legacy row shape."""
    rows = []
    cursor = None
    while True:
        page = drive.list_versions(node, cursor=cursor)
        rows.extend(page["rows"])
        cursor = page.get("next_cursor")
        if not cursor:
            break

    versions = []
    for row in sorted(rows, key=lambda version: version["seq"]):
        with drive.read_version(node, row["seq"]) as stream:
            snapshot = writer_drive.version_html(stream)
        versions.append(
            {
                "name": row["name"],
                "snapshot": snapshot,
                # Legacy titled an automatic version with the minute it was
                # taken and a manual one with the name its author gave it.
                "title": row["label"]
                or frappe.utils.get_datetime(row["creation"]).strftime("%Y-%m-%d %H:%M"),
                "manual": int(row["kind"] != "auto"),
                "creation": row["creation"],
            }
        )
    return versions


@frappe.whitelist()
def search(query: str, filters: str | None = None):
    client = WriterSearch()
    search = client.search(query, filters=filters)
    metadata = get_drive_file_meta([k["name"] for k in search["results"]])
    cleaned_results = []
    for k in search["results"]:
        meta = metadata.get(k["name"])
        # The index is unscoped; only surface documents the caller can read.
        if not meta or not get_user_access(meta["name"]).get("read"):
            continue
        k.update(meta)
        cleaned_results.append(k)
    search["results"] = cleaned_results

    # The index is unscoped, so summary stats and spelling corrections are
    # computed against every document on the site, not just what the caller
    # can read. Recompute counts from the filtered set and drop corrections
    # outright, since validating them against readable content isn't worth
    # the cost the UI doesn't use them.
    match_count = len(cleaned_results)
    search["summary"]["total_matches"] = match_count
    search["summary"]["returned_matches"] = match_count
    search["summary"]["filtered_matches"] = match_count
    search["summary"]["corrected_words"] = None
    search["summary"]["corrected_query"] = None
    return search


def get_drive_file_meta(names, ttl=3600):
    """
    Fetch {name: {title, file_id}} using Redis first, DB as fallback.
    """
    if not names:
        return {}

    cache = frappe.cache()

    keys = {name: f"search:drive_file:{name}" for name in names}
    cached = {k: cache.get_value(k) for k in keys.values()}

    result = {}
    missing = []
    for name, key in keys.items():
        value = cached.get(key)
        if value:
            result[name] = value
        else:
            missing.append(name)

    if missing:
        # The node half first: a document written since activation has no
        # `File` row, and the old query alone dropped every search hit on one.
        # §14.3 gives a migrated document the same id in both stores, so a
        # `File` row is only read for a docname the node half did not answer.
        rows = frappe.get_all(
            "Drive Node",
            filters={"content_docname": ["in", missing], "content_doctype": DOCTYPE},
            fields=["name", "title as file_name", "content_docname"],
        )
        found = {r["content_docname"] for r in rows}
        unlinked = [name for name in missing if name not in found]
        if unlinked:
            rows += frappe.get_all(
                "File",
                filters={"content_docname": ["in", unlinked], "content_doctype": DOCTYPE},
                fields=["name", "file_name", "content_docname"],
            )

        for r in rows:
            meta = {
                "title": r["file_name"],
                "name": r["name"],
            }
            key = f"search:drive_file:{r['content_docname']}"
            cache.set_value(key, meta, expires_in_sec=ttl)
            result[r["content_docname"]] = meta

    return result
