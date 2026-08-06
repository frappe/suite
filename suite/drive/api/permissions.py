import frappe
from frappe.model.document import Document

from suite.drive.utils import (
    FILE_FIELDS,
    GENERAL_USER,
    GROUP_PREFIX,
    PERMISSION_TYPES,
    STATUS_ACTIVE,
    entity_kind,
    generate_upward_path,
    get_valid_breadcrumbs,
    hide_storage_key,
)

NO_ACCESS = {
    "read": 0,
    "comment": 0,
    "share": 0,
    "write": 0,
    "upload": 0,
}


def filter_access(path):
    return {k: v for k, v in path[-1].items() if k in NO_ACCESS.keys()}


def is_drive_admin(user: str | None = None):
    user = user or frappe.session.user
    return user == "Administrator" or "Suite Admin" in frappe.get_roles(user)


@frappe.whitelist(allow_guest=True)
def get_user_access(entity: str | Document | frappe._dict):
    """
    Return the user specific permissions for an entity.
    """
    return get_user_access_for_user(entity, frappe.session.user)


def get_user_access_for_user(entity: str | Document | frappe._dict, user: str):
    if isinstance(entity, str):
        entity = frappe.get_cached_doc("File", entity)

    # Admins hold everything everywhere - including the shared root, which carries
    # no grant of its own, so nothing else would let them create there.
    if is_drive_admin(user):
        return {**dict.fromkeys(PERMISSION_TYPES, 1), "type": "admin"}

    # Owners hold everything, bypassing any deny on the path.
    if user != "Guest" and entity.owner == user:
        return {**dict.fromkeys(PERMISSION_TYPES, 1), "type": "admin"}

    if entity.get("attached_to_doctype") and entity.get("attached_to_name"):
        # Attachments follow their reference document; explicit Drive rows
        # override it per type.
        path = generate_upward_path(entity.name, user)
        access = filter_access(path)
        decided = set(path[-1]["decided"])
        if decided != set(PERMISSION_TYPES):
            access = {**_ref_doc_access(entity, user), **{t: access[t] for t in decided}}
        return {**access, "type": "user" if access["write"] else "guest"}

    access = filter_access(generate_upward_path(entity.name, user))
    return {**access, "type": "user" if access["write"] else "guest"}


@frappe.whitelist(allow_guest=True)
def get_general_access(entity: str | Document | frappe._dict):
    if isinstance(entity, str):
        entity = frappe.get_cached_doc("File", entity)
    if not get_user_access_for_user(entity, frappe.session.user)["read"]:
        frappe.throw("You don't have access to this file.", frappe.PermissionError)

    for user, access_type in (("Guest", "public"), (GENERAL_USER, "site")):
        access = get_user_access_for_user(entity, user)
        if access["read"]:
            return {**access, "type": access_type}
    return {**NO_ACCESS, "type": "restricted"}


def _ref_doc_access(entity, user):
    """Framework attachment semantics: write on the reference document gives
    write, read gives read, public files are readable by anyone."""
    public = not frappe.db.get_value("File", entity.name, "is_private")
    write = read = False
    if frappe.db.exists(entity.attached_to_doctype, entity.attached_to_name):
        ref = frappe.get_doc(entity.attached_to_doctype, entity.attached_to_name)
        write = bool(frappe.has_permission(ref.doctype, "write", doc=ref, user=user))
        read = write or bool(frappe.has_permission(ref.doctype, "read", doc=ref, user=user))
    return {
        **NO_ACCESS,
        "read": int(read or public),
        "comment": int(write),
        "write": int(write),
    }


@frappe.whitelist(allow_guest=True)
def get_entity_with_permissions(entity_name: str):
    """
    Return file data with permissions
    """
    entity = frappe.get_all(
        "File",
        filters={"name": entity_name, "status": STATUS_ACTIVE},
        fields=FILE_FIELDS,
        limit=1,
    )
    if not entity:
        # Mimic API v2 points
        frappe.local.response.errors = [
            {
                "type": "PageDoesNotExistError",
                "message": "We couldn't find what you're looking for.",
            }
        ]
        frappe.throw("We couldn't find what you're looking for.", frappe.PageDoesNotExistError)
    entity = entity[0]

    user_access = get_user_access(entity)
    if not user_access.get("read"):
        frappe.local.response.errors = [
            {
                "type": "PermissionError",
                "message": "You don't have access to this file.",
            }
        ]
        frappe.throw("You don't have access to this file.", frappe.PermissionError)

    owner_info = frappe.db.get_value("User", entity.owner, ["user_image", "full_name"], as_dict=True) or {}
    breadcrumbs = {"breadcrumbs": get_valid_breadcrumbs(entity.name, user_access)}
    favourite = frappe.db.get_value(
        "Drive Favourite",
        {
            "entity": entity_name,
            "user": frappe.session.user,
        },
        ["entity as is_favourite"],
    )
    return_obj = entity | user_access | owner_info | breadcrumbs | {"is_favourite": favourite}

    # General access marker: -2 public (link), -1 site users, 0 restricted.
    default = 0
    if get_user_access_for_user(entity, "Guest")["read"]:
        default = -2
    elif generate_upward_path(entity_name, GENERAL_USER)[-1]["read"]:
        default = -1
    return_obj["share_count"] = default

    return_obj["kind"] = entity_kind(entity)
    hide_storage_key(return_obj)

    # To work with modern frappe-ui composables
    frappe.response["data"] = return_obj
    return return_obj


@frappe.whitelist()
def get_shared_with_list(entity: str):
    """
    Return the list of users with whom this file or folder has been shared

    :param entity: Document-name of this file or folder
    :raises PermissionError: If the user does not have edit permissions
    :return: List of users, with permissions and last modified datetime
    :rtype: list[frappe._dict]
    """
    if not user_has_permission(entity, "share"):
        raise frappe.PermissionError("You do not have permission to check the shares.")

    permissions = frappe.db.get_all(
        "Drive Permission",
        filters=[["entity", "=", entity], ["user", "not in", ["", GENERAL_USER]], ["deny", "=", 0]],
        order_by="user",
        fields=["user", "read", "write", "comment", "upload", "share"],
    )
    for p in permissions:
        if p.user.startswith(GROUP_PREFIX):
            p.is_group = 1
            p.full_name = p.user[len(GROUP_PREFIX) :]

    owner = frappe.db.get_value("File", entity, "owner")
    owner_info = frappe.db.get_value("User", owner, ["user_image", "full_name", "name as user"], as_dict=True)
    if owner_info:
        # the owner's User row can be gone; the file outlives them
        permissions.insert(0, owner_info)

    for p in permissions:
        if p.get("is_group"):
            continue
        user_info = frappe.db.get_value("User", p.user, ["user_image", "full_name", "email"], as_dict=True)
        if user_info:
            p.update(user_info)
    return permissions


def exceeds_grant_ceiling(entity, requested, user=None):
    """Levels in `requested` the user doesn't hold, so can't hand out."""
    user = user or frappe.session.user
    if is_drive_admin(user):
        return []
    granter = get_user_access_for_user(entity, user)
    return [t for t in PERMISSION_TYPES if requested.get(t) and not granter.get(t)]


def drive_permission_has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if is_drive_admin(user):
        return True
    if isinstance(doc, str):
        doc = frappe.get_doc("Drive Permission", doc)
    if ptype in ("read", "select"):
        return doc.owner == user or doc.user == user
    if not user_has_permission(doc.entity, "share", user):
        return False
    if ptype == "delete":
        # Ownership is a permission row, so deleting one strips the owner's inherited
        # access to descendants. `unshare` refuses it; a direct delete must too.
        return doc.user == user or frappe.db.get_value("File", doc.entity, "owner") != doc.user
    if doc.deny:
        return True
    return not exceeds_grant_ceiling(doc.entity, doc.as_dict(), user)


def drive_settings_has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if is_drive_admin(user):
        return True
    if user == "Guest":
        return False
    if isinstance(doc, str):
        doc = frappe.get_doc("Drive Settings", doc)
    return doc.user == user


def drive_invitation_has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if is_drive_admin(user):
        return True
    if isinstance(doc, str):
        doc = frappe.get_doc("Drive User Invitation", doc)
    return ptype in ("read", "select") and doc.email == user


def activity_log_has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if is_drive_admin(user):
        return True
    if isinstance(doc, str):
        doc = frappe.get_doc("Drive Entity Activity Log", doc)
    # History is as sensitive as the file: never writable from the client.
    return ptype in ("read", "select") and bool(user_has_permission(doc.entity, "read", user))


def user_has_permission(doc, ptype, user=None):
    if isinstance(doc, str):
        doc = frappe.get_doc("File", doc)
    if not user:
        user = frappe.session.user
    if user == "Administrator" or ptype == "create":
        return True
    if ptype not in PERMISSION_TYPES:
        # Should ideally deflect to Framework
        ptype = "write"
    access = get_user_access_for_user(doc, user)
    return bool(access.get(ptype))
