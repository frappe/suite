import os
from datetime import datetime
from pathlib import Path

import frappe
import mimemapper
from pypika import Field
from pypika import functions as fn

DriveFile = frappe.qb.DocType("File")

STATUS_ACTIVE = "Active"
STATUS_TRASHED = "Trashed"
STATUS_REMOVED = "Removed"

ATTACHMENT_CONTENT_DOCTYPE = "File"
WRITER_CONTENT_DOCTYPE = "Writer Document"
PRESENTATION_CONTENT_DOCTYPE = "Presentation"

# `kind` — how Drive may treat a listing row (NOT the MIME `file_kinds` filter):
#   native   — Drive-managed file. Rename / move / share allowed.
#   readonly — Shown in Drive but not managed here:
#                content_doctype == "File" → attachment ref ("Go to original")
#   virtual  — Fabricated folder for the attachments browser (not a DB row).
KIND_NATIVE = "native"
KIND_READONLY = "readonly"
KIND_VIRTUAL = "virtual"

# Drive Permission.user sentinels, from most to least specific:
#   <email>  — that user
#   $GENERAL — any logged-in user
#   ""       — anyone with the link, including guests
GENERAL_USER = "$GENERAL"
GROUP_PREFIX = "$GROUP:"

# Drive's two roots (folder-less Files, pinned by name), and the well-known
# folder inside `Drive`. There is no `Site` folder: `Drive` itself is the shared
# tree the "Site" listing shows.
ROOT_FOLDER = "Drive"
USERS_FOLDER = "Users"
PREVIOUS_TEAMS_FOLDER = "Previous Teams"
# What a user's own folder is called back to them.
HOME_LABEL = "Home"

# Framework-created folders (the site root and its attachments folder);
# uploads still sitting in them haven't been adopted into a user folder yet.
FRAMEWORK_FOLDERS = ("Home", "Home/Attachments")

# App-created buckets under the framework root, outside Drive's own tree
# (`ROOT_FOLDER` / `USERS_FOLDER`). Like the framework folders they are shared
# scaffolding rather than anyone's private space, so any user may add to them -
# but unlike those, what lands here stays put instead of being adopted into a
# user folder. Mail's compose attachments go to `Home/Frappe Mail`
# (`suite/mail/install.py`).
APP_FOLDERS = ("Home/Frappe Mail",)

PERMISSION_TYPES = ["read", "comment", "share", "upload", "write"]


def entity_kind(row):
    """Classify a real `File` listing row. See `kind` above.

    `virtual` nodes are built in `list.get_attachments` and never reach here.
    """
    if row.get("content_doctype") == ATTACHMENT_CONTENT_DOCTYPE:
        return KIND_READONLY
    return KIND_NATIVE


MIME_LIST_MAP = {
    "Image": [
        "image/png",
        "image/jpeg",
        "image/svg+xml",
        "image/heic",
        "image/heif",
        "image/avif",
        "image/webp",
        "image/tiff",
        "image/gif",
    ],
    "PDF": ["application/pdf"],
    "Text": [
        "text/plain",
    ],
    "XML Data": ["application/xml"],
    "Document": [
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.apple.pages",
        "application/x-abiword",
        "frappe_doc",
    ],
    "Frappe Document": [
        "frappe_doc",
    ],
    "Spreadsheet": [
        "frappe/sheet",
        "application/vnd.ms-excel",
        "link/googlesheets",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.oasis.opendocument.spreadsheet",
        "text/csv",
        "application/vnd.apple.numbers",
    ],
    "Presentation": [
        "frappe/slides",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.presentation",
        "application/vnd.apple.keynote",
    ],
    "Code": [
        "text/x-python",
        "text/html",
        "text/css",
        "text/javascript",
        "application/javascript",
        "text/rich-text",
        "text/x-shellscript",
        "text/markdown",
        "application/json",
        "application/x-httpd-php",
        "application/x-python-script",
        "application/x-sql",
        "text/x-perl",
        "text/x-csrc",
        "text/x-sh",
    ],
    "Audio": ["audio/mpeg", "audio/wav", "audio/x-midi", "audio/ogg", "audio/mp4", "audio/mp3"],
    "Video": ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska"],
    "Book": ["application/epub+zip", "application/x-mobipocket-ebook"],
    "Application": [
        "application/octet-stream",
        "application/x-sh",
        "application/vnd.microsoft.portable-executable",
    ],
    "Archive": [
        "application/zip",
        "application/x-rar-compressed",
        "application/x-tar",
        "application/gzip",
        "application/x-bzip2",
    ],
}


FILE_FIELDS = [
    "name",
    "file_name",
    "folder",
    "file_url",
    "file_size",
    "file_type",
    "is_folder",
    "content_doctype",
    "content_docname",
    "creation",
    fn.Coalesce(Field("file_modified"), DriveFile.modified).as_("modified"),
    "owner",
    "attached_to_doctype",
    "attached_to_name",
]


def hide_storage_key(row):
    """Blank file_url unless the client needs it as a real URL.

    For managed files it's the raw storage key, which leaks the owner's path;
    only Link/Presentation files use it client-side.
    """
    if row.get("file_type") not in ("Link", "Presentation"):
        row["file_url"] = None
    return row


def get_root_folder():
    """Shared Drive content, the tree the "Site" listing shows. Carries $GENERAL
    read; `Users` beside it stays private."""
    root = _pinned_root(ROOT_FOLDER)
    _ensure_general_read(root.name)
    return root


def _ensure_general_read(entity):
    if frappe.db.exists("Drive Permission", {"entity": entity, "user": GENERAL_USER}):
        return
    frappe.get_doc({"doctype": "Drive Permission", "entity": entity, "user": GENERAL_USER, "read": 1}).insert(
        ignore_permissions=True
    )


def get_users_folder():
    """Private user folders. A root beside `Drive`, not inside it, so nothing granted
    on the shared tree reaches in. Carries no grant."""
    return _pinned_root(USERS_FOLDER)


def _pinned_root(file_name):
    """Folder-less `File`s, siblings of frappe's `Home` rather than children, so no
    framework node sits on a Drive permission path.

    Pinned by name, never derived: a site upgraded from the old app has one
    folder-less File per team, so any "find the root" query picks a team folder.
    """
    root = frappe.db.get_value("File", file_name, ["name", "file_url"], as_dict=1)
    if not root:
        root = _create_root_folder(file_name)
    return root if root.file_url else _init_root_storage(root, file_name)


def _create_root_folder(file_name):
    root = frappe.get_doc(
        {
            "doctype": "File",
            "file_name": file_name,
            "is_folder": 1,
            "is_private": 1,
            "file_type": "Folder",
        }
    )
    # `folder` stays unset: `set_folder_name` would reparent under `Home`, but it
    # only runs on the framework's before_insert path, which file_created skips.
    root._name = file_name
    root.flags.file_created = True
    root.insert(ignore_permissions=True)
    return frappe._dict(name=root.name, file_url=root.file_url)


def _init_root_storage(root, file_name):
    """A root's prefix comes from settings, not a parent. Two logical roots, one
    storage prefix — `Users` is just a directory beside the shared tree."""
    from suite.drive.utils.files import get_s3_url

    settings = frappe.get_single("Drive Disk Settings")
    prefix = settings.root_folder or ""
    if file_name != ROOT_FOLDER:
        prefix = f"{prefix}/{file_name}" if prefix else file_name

    disk_path = Path(frappe.get_site_path("private/files")) / prefix
    disk_path.mkdir(exist_ok=True, parents=True)
    if file_name == ROOT_FOLDER:
        # scaffolding is shared, and keyed off the Drive root everywhere
        (disk_path / ".uploads").mkdir(exist_ok=True)
        (disk_path / settings.thumbnail_prefix).mkdir(exist_ok=True)

    root.file_url = get_s3_url(prefix) if settings.enabled else "/private/files/" + prefix
    frappe.db.set_value("File", root.name, "file_url", root.file_url, update_modified=False)
    return root


def get_previous_teams_folder():
    """Landing area for migrated teams, inside `Drive`. Teams were private, so this
    denies the root's inherited $GENERAL read; each team below re-grants to its own
    members from a nearer node. They reach it via "Shared with me"."""
    root = get_root_folder()
    existing = frappe.db.get_value(
        "File",
        {"folder": root.name, "file_name": PREVIOUS_TEAMS_FOLDER, "is_folder": 1},
        ["name", "file_url"],
        as_dict=1,
    )
    if existing:
        _deny_general_read(existing.name)
        return existing

    from suite.drive.utils.files import FileManager

    manager = FileManager()
    folder = create_drive_file(PREVIOUS_TEAMS_FOLDER, root.name, "Folder", lambda f: manager.create_folder(f))
    _deny_general_read(folder.name)
    return frappe._dict(name=folder.name, file_url=folder.file_url)


def drop_previous_teams_if_empty():
    """The container only earns its place once a team lands in it. Empty - nothing
    migrated, or everything was moved out since - it's a dead end in the listing."""
    container = frappe.db.get_value(
        "File", {"folder": ROOT_FOLDER, "file_name": PREVIOUS_TEAMS_FOLDER, "is_folder": 1}, "name"
    )
    if not container:
        return
    if frappe.db.exists("File", {"folder": container, "status": ("in", [STATUS_ACTIVE, STATUS_TRASHED])}):
        return
    # cascades to the removed children and to the $GENERAL deny row
    frappe.delete_doc("File", container, ignore_permissions=True, force=True)


def _deny_general_read(entity):
    if frappe.db.exists("Drive Permission", {"entity": entity, "user": GENERAL_USER}):
        return
    frappe.get_doc(
        {"doctype": "Drive Permission", "entity": entity, "user": GENERAL_USER, "deny": 1, "read": 1}
    ).insert(ignore_permissions=True)


def get_user_folder(user=None):
    """The user's private folder under the root; created on first use."""
    user = user or frappe.session.user
    name = frappe.db.get_value("Drive Settings", user, "user_folder")
    if name:
        folder = frappe.db.get_value("File", name, ["name", "file_url"], as_dict=1)
        if folder:
            return folder

    if not frappe.db.exists("Drive Settings", user):
        try:
            frappe.get_doc({"doctype": "Drive Settings", "user": user}).insert(ignore_permissions=True)
        except frappe.DuplicateEntryError:
            pass

    name = frappe.db.get_value("Drive Settings", user, "user_folder", for_update=True)
    if name:
        folder = frappe.db.get_value("File", name, ["name", "file_url"], as_dict=1)
        if folder:
            return folder

    from suite.drive.utils.files import FileManager

    manager = FileManager()
    root = get_users_folder()
    folder = create_drive_file(
        user,
        root.name,
        "Folder",
        lambda f: manager.create_folder(f),
        owner=user,
    )
    grant_owner_access(folder.name, user)

    if not frappe.db.exists("Drive Settings", user):
        frappe.get_doc({"doctype": "Drive Settings", "user": user}).insert(ignore_permissions=True)
    frappe.db.set_value("Drive Settings", user, "user_folder", folder.name, update_modified=False)
    return frappe._dict(name=folder.name, file_url=folder.file_url)


def get_ancestors_of(entity_name):
    """
    Return all parent nodes till the root node
    """
    result = frappe.db.sql(
        """
        WITH RECURSIVE generated_path as (
        SELECT
            `tabFile`.name,
            `tabFile`.folder
        FROM `tabFile`
        WHERE `tabFile`.name = %(entity_name)s

        UNION ALL

        SELECT
            t.name,
            t.folder
        FROM generated_path as gp
        JOIN `tabFile` as t ON t.name = gp.folder)
        SELECT name FROM generated_path;
    """,
        values={"entity_name": entity_name},
        as_dict=0,
    )
    flattened_list = [item for sublist in result for item in sublist]
    flattened_list.pop(0)
    return flattened_list


def grant_owner_access(entity, user):
    """Ownership of a folder is stored as a row like any other grant, so it
    inherits down the tree and a deny below can still narrow it."""
    if frappe.db.exists("Drive Permission", {"entity": entity, "user": user}):
        return
    frappe.get_doc(
        {
            "doctype": "Drive Permission",
            "entity": entity,
            "user": user,
            **dict.fromkeys(PERMISSION_TYPES, 1),
        }
    ).insert(ignore_permissions=True)


def get_principals(user=None):
    """Everything a `Drive Permission.user` row can name the caller by, most
    specific first: themselves, their user groups, any logged-in user, anyone
    with the link. Guests are only ever the last."""
    user = user or frappe.session.user
    if user == "Guest":
        return [""]

    groups = frappe.cache().hget("drive_user_groups", user, generator=lambda: _user_groups(user))
    return [user, *(GROUP_PREFIX + g for g in groups), GENERAL_USER, ""]


def _user_groups(user):
    return frappe.get_all(
        "User Group Member",
        filters={"parenttype": "User Group", "user": user},
        pluck="parent",
        distinct=True,
    )


def clear_user_group_cache(doc=None, method=None):
    frappe.cache().delete_key("drive_user_groups")


def principal_list(user=None):
    return ", ".join(frappe.db.escape(p) for p in get_principals(user))


def dribble_access(path):
    """Resolve access at the leaf of `path`: per permission type the nearest row
    decides (grant → 1, deny → 0). Nothing is granted by default. `decided`
    lists the types an explicit row settled."""
    decided = {}
    for node in path[::-1]:
        for row in node.get("perms", ()):
            for t in PERMISSION_TYPES:
                if row[t] and t not in decided:
                    decided[t] = 0 if row["deny"] else 1
    access = dict.fromkeys(PERMISSION_TYPES, 0)
    access.update(decided)
    access["decided"] = list(decided)
    return access


def generate_upward_path(entity_name, user=None):
    """
    Given an ID traverse upwards till the root node
    Stops when parent_drive_file IS NULL
    """
    if user is None:
        user = frappe.session.user
    principals = get_principals(user)
    user_lit = frappe.db.escape(user)
    perm_filter = "p.user IN ({})".format(", ".join(frappe.db.escape(p) for p in principals))

    # Nearest folder wins; within a folder the most specific principal wins, and
    # among equally specific group rows a deny beats a grant.
    groups = [p for p in principals if p.startswith(GROUP_PREFIX)]
    group_when = ""
    if groups:
        group_lit = ", ".join(frappe.db.escape(g) for g in groups)
        group_when = f"WHEN p.user IN ({group_lit}) THEN 1"
    tier = f"""CASE
			WHEN p.user = {user_lit} THEN 0
			{group_when}
			WHEN p.user = '{GENERAL_USER}' THEN 2
			ELSE 3 END"""

    result = frappe.db.sql(
        f"""WITH RECURSIVE
            generated_path as (
                SELECT
                    `tabFile`.file_name,
                    `tabFile`.name,
                    `tabFile`.folder,
                    `tabFile`.owner,
                    0 AS level
                FROM
                    `tabFile`
                WHERE
                    `tabFile`.name = %(entity_name)s
                UNION ALL
                SELECT
                    t.file_name,
                    t.name,
                    t.folder,
                    t.owner,
                    gp.level + 1
                FROM
                    generated_path as gp
                    JOIN `tabFile` as t ON t.name = gp.folder
            )
        SELECT
            gp.file_name,
            gp.name,
            gp.owner,
            gp.folder,
            p.user AS perm_user,
            p.deny,
            p.read,
            p.upload,
            p.write,
            p.comment,
            p.share
        FROM
            generated_path  as gp
        LEFT JOIN `tabDrive Permission` as p
        ON gp.name = p.entity AND {perm_filter}
        ORDER BY gp.level DESC, {tier}, p.deny DESC;
    """,
        values={"entity_name": entity_name},
        as_dict=1,
    )

    nodes = []
    for row in result:
        if not nodes or nodes[-1]["name"] != row["name"]:
            nodes.append(
                {
                    "file_name": row["file_name"],
                    "name": row["name"],
                    "owner": row["owner"],
                    "folder": row["folder"],
                    "perms": [],
                }
            )
        if row["perm_user"] is not None:
            nodes[-1]["perms"].append(row)

    return [{**node, **dribble_access(nodes[: i + 1])} for i, node in enumerate(nodes)]


def get_valid_breadcrumbs(entity_name, user_access):
    """
    Determine user access and generate upward path (breadcrumbs).
    """
    # Admins see the entire path; others get the contiguous readable suffix.
    path = generate_upward_path(entity_name)
    if user_access.get("type") not in ["admin", "user"]:
        lose_access = next((i for i, k in enumerate(path[::-1]) if not k["read"]), 0)
        path = path[-lose_access:]
    return _name_own_drive(path)


def _name_own_drive(path):
    """Your own files hang off `Users/<your id>`, which reads back to you as a
    container you have never seen and your own address as a folder. Show the one
    crumb you know it by instead."""
    if len(path) < 2 or path[0]["name"] != USERS_FOLDER:
        return path
    if path[1]["file_name"] != frappe.session.user:
        # somebody else's drive: leave it spelled out
        return path
    return [{**path[1], "file_name": HOME_LABEL}, *path[2:]]


def get_file_type(mime_type):
    try:
        return next(k for (k, v) in MIME_LIST_MAP.items() if mime_type in v)
    except StopIteration:
        return "Unknown"


def update_file_size(entity, delta):
    doc = frappe.get_doc("File", entity)
    while doc.folder:
        doc.file_size += delta
        doc.save(ignore_permissions=True)
        doc = frappe.get_doc("File", doc.folder)
    # Update root
    doc.file_size += delta
    doc.save(ignore_permissions=True)


def if_folder_exists(folder_name, parent):
    values = {
        "file_name": folder_name,
        "is_folder": 1,
        "is_private": 1,
        "status": STATUS_ACTIVE,
        "folder": parent,
    }
    existing_folder = frappe.db.get_value(
        "File", values, ["name", "file_name", "is_folder", "status"], as_dict=1
    )

    if existing_folder:
        return existing_folder.name
    else:
        d = frappe.get_doc({"doctype": "File", **values, "file_modified": frappe.utils.now_datetime()})
        d.flags.file_created = True
        d.insert()
        return d.name


def create_drive_file(
    file_name,
    parent,
    file_type,
    entity_path,
    mime_type=None,
    file_size=0,
    file_modified=None,
    content_doctype=None,
    content_docname=None,
    owner=None,
):
    values = {
        "doctype": "File",
        "is_private": 1,
        "file_name": file_name,
        "folder": parent,
        "file_size": file_size,
        "file_type": file_type,
        "mime_type": mime_type,
        "is_folder": file_type == "Folder",
        "file_modified": (datetime.fromtimestamp(file_modified) if file_modified else frappe.utils.now()),
    }
    if content_doctype:
        values["content_doctype"] = content_doctype
        values["content_docname"] = content_docname
    drive_file = frappe.get_doc(values)
    drive_file.flags.file_created = True
    drive_file.insert(ignore_permissions=True)
    path = entity_path(drive_file) if callable(entity_path) else entity_path
    drive_file.file_url = str(path) if path else ""
    drive_file.save(ignore_permissions=True)
    if owner:
        drive_file.db_set("owner", owner, update_modified=False)
    return drive_file


def get_new_file_name(file_name: str, parent_name: str, type: str = False, entity: str | None = None):
    entity_title, entity_ext = os.path.splitext(file_name)

    filters = {
        "status": STATUS_ACTIVE,
        "folder": parent_name,
        "file_name": ["like", f"{entity_title}%{entity_ext}"],
    }

    if type:
        filters["file_type"] = type

    sibling_entity_titles = frappe.db.get_list(
        "File",
        filters=filters,
        fields=["file_name", "name"],
    )
    if (
        not sibling_entity_titles
        or (sibling_entity_titles[0].name == entity)
        or not any(k["file_name"] == file_name for k in sibling_entity_titles)
    ):
        return file_name
    return f"{entity_title} ({len(sibling_entity_titles)}){entity_ext}"


def validate_filename(file_name, parent, type, error=None):
    suggested_name = get_new_file_name(file_name, parent, type)
    if suggested_name != file_name:
        if not error:
            error = f"{file_name} exists."
        frappe.throw(
            f"{error} Try {suggested_name}",
            frappe.ValidationError,
        )


def map_ff_to_drive_type(file):
    if file.is_folder:
        return "Folder"
    mime_type = mimemapper.get_mime_type(file.file_type) if file.file_type else ""
    try:
        return next(k for (k, v) in MIME_LIST_MAP.items() if mime_type in v)
    except StopIteration:
        return "Unknown"


def get_upload_path(base_path, file_name):
    uploads_path = Path(frappe.get_site_path(base_path), ".uploads")
    if not os.path.exists(uploads_path):
        uploads_path.mkdir()
    return uploads_path / file_name


def create_file(
    title="Untitled",
    parent=None,
    path=None,
    mime_type=None,
    file_type=None,
    content_doctype=None,
    content_docname=None,
):
    """Convenience wrapper for external apps (e.g. Slides, Writer) to create a Drive file."""
    if not parent:
        parent = get_user_folder().name

    return create_drive_file(
        title,
        parent,
        file_type or "Unknown",
        lambda _: path,
        mime_type=mime_type,
        content_doctype=content_doctype,
        content_docname=content_docname,
    )
