import json
from collections import Counter

import frappe
from pypika import Criterion, CustomFunction, Order
from pypika import functions as fn

from suite.drive.utils import (
    FILE_FIELDS,
    GENERAL_USER,
    KIND_VIRTUAL,
    MIME_LIST_MAP,
    PREVIOUS_TEAMS_FOLDER,
    ROOT_FOLDER,
    STATUS_ACTIVE,
    STATUS_TRASHED,
    USERS_FOLDER,
    entity_kind,
    get_principals,
    get_user_folder,
    hide_storage_key,
    principal_list,
)
from suite.drive.utils.api import get_default_access

from .permissions import get_user_access, user_has_permission

DriveUser = frappe.qb.DocType("User")
UserGroupMember = frappe.qb.DocType("User Group Member")
DriveFile = frappe.qb.DocType("File")
DrivePermission = frappe.qb.DocType("Drive Permission")
DriveFavourite = frappe.qb.DocType("Drive Favourite")
Recents = frappe.qb.DocType("Drive Entity Log")

Binary = CustomFunction("BINARY", ["expression"])


# Helper Functions for Filters
def _apply_shared_filter(query, shared_type):
    """
    Filters query to show shared files based on shared_type parameter.
    - "with": files explicitly shared with the current user
    - "public": publicly shared files
    - False/None: no share join
    """
    if not shared_type:
        return query

    user = frappe.session.user if frappe.session.user != "Guest" else ""
    if shared_type == "with":
        # Every principal a share can name them by except the site-wide ones: a
        # folder shared with a group is shared with them, and would otherwise be
        # reachable but findable nowhere. $GENERAL and link rows are excluded, or
        # everything shared site-wide would land here.
        principals = [p for p in get_principals(user) if p and p != GENERAL_USER]
        # Ownership is itself a permission row naming you, so without this your own
        # folder and files come back as things shared with you.
        match = DrivePermission.user.isin(principals) & (DriveFile.owner != user)
    else:
        match = DrivePermission.user == ""
    cond = (DrivePermission.entity == DriveFile.name) & match & (DrivePermission.deny == 0)
    # Structural folders are scaffolding, not something anyone shared.
    cond = cond & DriveFile.name.notin([ROOT_FOLDER, USERS_FOLDER])
    return query.right_join(DrivePermission).on(cond)


def _apply_file_kinds_filter(query, file_kinds):
    """
    Filters files by kind/mime type.
    """
    file_kinds = json.loads(file_kinds) if isinstance(file_kinds, str) else file_kinds
    if not file_kinds:
        return query

    mime_types = []
    for kind in file_kinds:
        mime_types.extend(MIME_LIST_MAP.get(kind, []))

    criterion = [DriveFile.mime_type == mime_type for mime_type in mime_types]
    if "Folder" in file_kinds:
        criterion.append(DriveFile.is_folder == 1)

    return query.where(Criterion.any(criterion))


# Data Aggregation Functions
def _get_children_count(files):
    """
    Returns a dict mapping folder names to their child count.

    Counts what the caller can actually see. Access is inherited, so a child is
    visible unless a deny row hides it and nothing nearer grants it back —
    otherwise `Previous Teams` reports all 512 migrated teams to someone who can
    open three of them.
    """
    if not files:
        return {}
    names = [k["name"] for k in files]
    principals = principal_list()
    rows = frappe.db.sql(
        f"""
		select f.folder, count(*)
		from `tabFile` f
		where f.folder in %(names)s and f.status = %(active)s
		  and (
			not exists (
				select 1 from `tabDrive Permission` d
				where d.entity = f.name and d.deny = 1 and d.`read` = 1
				  and d.user in ({principals})
			)
			or exists (
				select 1 from `tabDrive Permission` g
				where g.entity = f.name and g.deny = 0 and g.`read` = 1
				  and g.user in ({principals})
			)
		  )
		group by f.folder
		""",
        {"names": names, "active": STATUS_ACTIVE},
    )
    return dict(rows)


def _get_slide_counts(rows):
    """
    Returns a dict mapping presentation docnames to their slide count.
    """
    # Imported here as suite.slides imports from suite.drive.
    from suite.slides.doctype.presentation.presentation import get_slide_counts

    return get_slide_counts(
        [
            r["content_docname"]
            for r in rows
            if r.get("content_doctype") == "Presentation" and r.get("content_docname")
        ]
    )


def _get_share_count(names):
    """
    Returns a dict mapping file names to their share count.
    Counts shares with individual users (excludes general shares and denies).
    """
    if not names:
        return {}
    query = (
        frappe.qb.from_(DriveFile)
        .right_join(DrivePermission)
        .on(DrivePermission.entity == DriveFile.name)
        .where(
            DrivePermission.entity.isin(names)
            & (DrivePermission.user.notin(["", GENERAL_USER]))
            & (DrivePermission.deny == 0)
        )
        .select(DriveFile.name, fn.Count("*").as_("share_count"))
        .groupby(DriveFile.name)
    )
    return dict(query.run())


def _get_public_files(names):
    """
    Returns a set of file names that are publicly shared.
    """
    if not names:
        return set()
    query = (
        frappe.qb.from_(DrivePermission)
        .where(
            (DrivePermission.entity.isin(names)) & (DrivePermission.user == "") & (DrivePermission.deny == 0)
        )
        .select(DrivePermission.entity)
    )
    return set(k[0] for k in query.run())


def _get_general_files(names):
    """
    Returns a set of file names explicitly shared with all site users.
    """
    if not names:
        return set()
    query = (
        frappe.qb.from_(DrivePermission)
        .where(
            (DrivePermission.entity.isin(names))
            & (DrivePermission.user == GENERAL_USER)
            & (DrivePermission.deny == 0)
        )
        .select(DrivePermission.entity)
    )
    return set(k[0] for k in query.run())


def _get_basic_query(search):
    query = frappe.qb.from_(DriveFile).where(DriveFile.status == STATUS_ACTIVE)
    if search:
        query = query.where(DriveFile.file_name.like(f"%{search}%"))
    return query


@frappe.whitelist(allow_guest=True)
def files(
    entity_name: str | None = None,
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds: list[str] | str = [],
    search: str = None,
    start: int = 0,
    limit: int = None,
):
    """
    Returns active files in a folder. Pass `start`/`limit` to page through large
    folders. When `search` is set, results span the whole tree (not just the
    current folder).
    """
    if not entity_name:
        entity_name = get_user_folder().name

    entity = frappe.get_doc("File", entity_name)

    if not user_has_permission(entity, "read"):
        frappe.throw(
            "You don't have access.",
            frappe.exceptions.PermissionError,
        )

    query = _get_basic_query(search)
    if not search:
        # Folder browsing; search is tree-wide so it skips the folder filter.
        query = query.where(DriveFile.folder == entity_name)

    return get_query_data(
        query,
        file_kinds=file_kinds,
        entity_name=entity_name,
        order_by=order_by,
        ascending=ascending,
        start=start,
        limit=limit,
    )


@frappe.whitelist()
def shared(
    shared_type: str = "with",
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds: list[str] | str = [],
    search: str = None,
    start: int = 0,
    limit: int = None,
):
    """
    Returns shared files based on shared_type parameter.
    - "with": files shared with current user
    - "public": publicly shared files
    """
    query = _get_basic_query(search)

    return get_query_data(
        query,
        shared_type=shared_type,
        file_kinds=file_kinds,
        order_by=order_by,
        ascending=ascending,
        start=start,
        limit=limit,
    )


@frappe.whitelist()
def favourites(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds: list[str] | str = [],
    search: str = None,
    start: int = 0,
    limit: int = None,
):
    """
    Returns all files marked as favourite by the current user.
    """
    query = _get_basic_query(search)

    return get_query_data(
        query,
        favourites_only=True,
        file_kinds=file_kinds,
        order_by=order_by,
        ascending=ascending,
        start=start,
        limit=limit,
    )


@frappe.whitelist()
def recents(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds: list[str] | str = [],
    search: str = None,
    start: int = 0,
    limit: int = None,
):
    """
    Returns all files marked recently by the current user.
    """
    query = _get_basic_query(search)

    return get_query_data(
        query,
        recents_only=True,
        file_kinds=file_kinds,
        order_by=order_by,
        ascending=ascending,
        start=start,
        limit=limit,
    )


@frappe.whitelist()
def trash(
    order_by: str = "modified",
    ascending: bool = True,
    file_kinds: list[str] | str = [],
    search: str = None,
    start: int = 0,
    limit: int = None,
):
    """
    Returns all deleted files (trash) for the current user.
    """
    query = (
        frappe.qb.from_(DriveFile)
        .where(DriveFile.status == STATUS_TRASHED)
        .where(DriveFile.owner == frappe.session.user)
    )
    if search:
        query = query.where(DriveFile.file_name.like(f"%{search}%"))

    return get_query_data(
        query,
        file_kinds=file_kinds,
        order_by=order_by,
        ascending=ascending,
        start=start,
        limit=limit,
    )


ALLOWED_SORT_FIELDS = {
    "name",
    "file_name",
    "file_size",
    "file_type",
    "creation",
    "modified",
    "owner",
}


def get_query_data(
    query,
    favourites_only=False,
    recents_only=False,
    file_kinds=[],
    entity_name=None,
    shared_type=None,
    order_by="modified",
    ascending=True,
    start=0,
    limit=None,
):
    """
    Runs all the necessary commands to obtain files in the structure expected by Drive frontend.
    """
    if order_by not in ALLOWED_SORT_FIELDS:
        order_by = "modified"

    # Apply shared filter
    query = _apply_shared_filter(query, shared_type)
    query = query.select(*FILE_FIELDS)

    # Send owner display data with files so the list view doesn't need a separate users fetch
    query = (
        query.left_join(DriveUser)
        .on(DriveUser.name == DriveFile.owner)
        .select(DriveUser.full_name.as_("owner_full_name"), DriveUser.user_image.as_("owner_image"))
    )

    # Apply favourites filter
    if favourites_only:
        query = query.right_join(DriveFavourite)
    else:
        query = query.left_join(DriveFavourite)

    query = query.on(
        (DriveFavourite.entity == DriveFile.name) & (DriveFavourite.user == frappe.session.user)
    ).select(DriveFavourite.name.as_("is_favourite"))

    # Apply recents filter
    if recents_only:
        query = (
            query.right_join(Recents)
            .on((Recents.entity_name == DriveFile.name) & (Recents.user == frappe.session.user))
            .orderby(Recents.last_interaction, order=Order.desc)
        )
    else:
        query = (
            query.left_join(Recents)
            .on((Recents.entity_name == DriveFile.name) & (Recents.user == frappe.session.user))
            .orderby(DriveFile[order_by], order=Order.asc if ascending else Order.desc)
        )

    query = query.select(Recents.last_interaction.as_("accessed"))

    # Apply file kind filter
    query = _apply_file_kinds_filter(query, file_kinds)

    # Page through large result sets (aggregation below is scoped to the page).
    if limit:
        query = query.limit(int(limit)).offset(int(start or 0))

    res = query.run(as_dict=True)

    default = get_default_access(entity_name) if entity_name else 0

    # Deduplicate results
    if shared_type:
        added = set()
        filtered_list = []
        for r in res:
            if r["name"] not in added:
                filtered_list.append(r)
            added.add(r["name"])
        res = filtered_list

    # Get aggregated data, scoped to the files we're returning
    names = [r["name"] for r in res]
    children_count = _get_children_count(res)
    slide_counts = _get_slide_counts(res)
    share_count = _get_share_count(names)
    public_files = _get_public_files(names)
    general_files = _get_general_files(names)

    # Enrich results with aggregated data and permissions; access is resolved
    # per row (deny rows can hide a child of a readable folder), so filter on it.
    for r in res:
        name = r["name"]
        r["child_count"] = children_count.get(name, 0)
        if r.get("content_doctype") == "Presentation":
            r["slide_count"] = slide_counts.get(r["content_docname"], 0)
        if name in public_files:
            r["share_count"] = -2
        elif default > -1 and name in general_files:
            r["share_count"] = -1
        elif default == 0:
            r["share_count"] = share_count.get(name, default)
        else:
            r["share_count"] = default

        r["kind"] = entity_kind(r)
        hide_storage_key(r)
        r |= get_user_access(name)

    # The migration leaves one Previous Teams container at the root for everyone,
    # but each user only sees the teams they were on. With none of them visible
    # it's an empty folder they can't do anything with, so drop it from the list.
    return [
        r
        for r in res
        if r["read"]
        and not (
            r["file_name"] == PREVIOUS_TEAMS_FOLDER and r["folder"] == ROOT_FOLDER and not r["child_count"]
        )
    ]


@frappe.whitelist()
def get_attachments(doctype: str | None = None, docname: str | None = None):
    """
    Returns all files that are attached to a document.
    If either doctype or docname isn't specified, returns a list of folder-like objects
    that represents the tree Doctype > Doc > Attachments.
    """
    # filter_file scopes attachments by doctype-level read (coarse), so gate on
    # the authoritative per-file check used when files are actually served — this
    # lets a file's owner through while blocking users who only have generic read
    # on the doctype but not the specific document.
    if doctype and docname:
        files = frappe.get_list(
            "File", filters={"attached_to_doctype": doctype, "attached_to_name": docname}, pluck="name"
        )
        files = [f for f in files if user_has_permission(f, "read")]
        query = frappe.qb.from_(DriveFile).where(DriveFile.name.isin(files or [""]))
        return get_query_data(query)

    titles = {}
    if doctype:
        names = frappe.get_list(
            "File", filters={"attached_to_doctype": doctype}, fields=["name", "attached_to_name"]
        )
        doctypes_set = Counter(k["attached_to_name"] for k in names if user_has_permission(k["name"], "read"))
        # Show each document by its title field rather than its raw name (ID).
        title_field = frappe.get_meta(doctype).get_title_field()
        if title_field != "name":
            titles = dict(
                frappe.get_all(
                    doctype,
                    filters={"name": ["in", list(doctypes_set) or [""]]},
                    fields=["name", title_field],
                    as_list=True,
                )
            )
    else:
        names = frappe.get_list(
            "File",
            filters={"attached_to_doctype": ["is", "set"]},
            fields=["name", "attached_to_doctype"],
        )
        doctypes_set = Counter(
            k["attached_to_doctype"] for k in names if user_has_permission(k["name"], "read")
        )

    return [
        {
            "name": name,
            "file_name": titles.get(name) or name,
            "is_folder": 1,
            "file_type": "Folder",
            "child_count": size,
            "kind": KIND_VIRTUAL,
            "attached_to_doctype": doctype or name,
            "attached_to_name": name if doctype else None,
        }
        for name, size in doctypes_set.items()
    ]
