import frappe
from pypika import CustomFunction, Order
from pypika import functions as fn

from suite.drive.api.permissions import get_user_access
from suite.drive.utils import FILE_FIELDS, GENERAL_USER, STATUS_ACTIVE
from suite.writer.search import WriterSearch

DriveUser = frappe.qb.DocType("User")
UserGroupMember = frappe.qb.DocType("User Group Member")
DriveFile = frappe.qb.DocType("File")
DrivePermission = frappe.qb.DocType("Drive Permission")
DriveFavourite = frappe.qb.DocType("Drive Favourite")
Recents = frappe.qb.DocType("Drive Entity Log")

Binary = CustomFunction("BINARY", ["expression"])


@frappe.whitelist()
def get_document_list(
    start: int = 0,
    limit: int = 20,
):
    user = frappe.session.user

    recently_opened = frappe.qb.from_(Recents).select(Recents.entity_name).where(Recents.user == user)

    recent_field = fn.Coalesce(Recents.last_interaction, DriveFile.file_modified)
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
        (Recents.entity_name == DriveFile.name) & (Recents.user == frappe.session.user)
    )

    query = query.select(Recents.last_interaction.as_("accessed"))

    # Add ordering
    query = query.orderby(recent_field, order=Order.desc)
    # Fetch one extra record to check if there's a next page
    query = query.limit(limit + 1).offset(start)
    res = query.run(as_dict=True)

    # Check if there's a next page
    has_next_page = len(res) > limit

    # Remove the extra record if it exists
    if has_next_page:
        res = res[:limit]

    # Rest of your processing code
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

    default = 0

    accessible = []
    for r in res:
        access = get_user_access(r["name"])
        # A stale "recently opened" entry can outlive the caller's access.
        if not access.get("read"):
            continue
        accessible.append(r)
        r["children"] = children_count.get(r["name"], 0)
        r["html"] = frappe.get_cached_value("Writer Document", r["content_docname"], "html")
        if r["name"] in public_files:
            r["share_count"] = -2
        elif default > -1 and (r["name"] in general_files):
            r["share_count"] = -1
        elif default == 0:
            r["share_count"] = share_count.get(r["name"], default)
        else:
            r["share_count"] = default
        r |= access

    # Return in the format useList expects
    frappe.response["data"] = accessible
    frappe.response["has_next_page"] = has_next_page


@frappe.whitelist()
def get_versions(id: str):
    if not get_user_access(id).get("write"):
        frappe.throw("You don't have write access.", frappe.PermissionError)

    doc_name = frappe.db.get_value("File", id, "content_docname")

    versions = frappe.get_all(
        "Writer Version",
        filters={"doc": doc_name},
        fields=["name", "snapshot", "title", "manual", "creation"],
        order_by="creation asc",
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
    cached = {"name": cache.get_value(k) for k in keys.values()}

    result = {}
    missing = []
    for name, key in keys.items():
        value = cached.get(key)
        if value:
            result[name] = value
        else:
            missing.append(name)

    if missing:
        rows = frappe.get_all(
            "File",
            filters={"content_docname": ["in", missing], "content_doctype": "Writer Document"},
            fields=["name", "file_name", "content_docname"],
        )

        for r in rows:
            meta = {
                "title": r["file_name"],
                "name": r["name"],
            }
            key = f"search:drive_file:{r['name']}"
            cache.set_value(key, meta, expires_in_sec=ttl)
            result[r["content_docname"]] = meta

    return result
