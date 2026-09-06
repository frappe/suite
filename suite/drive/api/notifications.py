import frappe
from frappe.model.document import Document
from pypika import Order

from suite.drive.http import shims


def get_link(entity):
    if entity.file_type == "Document":
        return "/writer/w/" + entity.name
    type_ = {True: "f", bool(entity.is_folder): "d"}
    return entity.file_url if entity.file_type == "Link" else f"/drive/{type_.get(True)}/{entity.name}/"


@frappe.whitelist()
def get_notifications(only_unread: bool = False):
    """Return the caller's notifications.

    §11.7 forwarder over `GET /notifications`.
    """
    return shims.get_notifications(only_unread)


@frappe.whitelist()
def get_unread_count():
    """Return how many notifications the caller has not read.

    §11.7 forwarder. It counts what the caller can still see, so a
    notification about a node they lost access to is not counted.
    """
    return shims.get_unread_count()


@frappe.whitelist()
def mark_as_read(name: str | None = None, all: bool = False):
    """Mark one notification, or all of them, read.

    §11.7 forwarder over `POST /notifications/read`. It answers nothing, as
    this name always has.
    """
    return shims.mark_as_read(name=name, all=all)


def notify_mentions(entity_name, mentions, comment=False):
    """
    Create a mention notification for each user mentioned
    :param entity_name: ID of entity
    :param document_name: ID of document containing mentions
    """
    entity = frappe.get_doc("File", entity_name)
    for mention in mentions:
        create_notification(
            frappe.session.user,
            mention,
            "Mention",
            entity,
            f"You were mentioned in a {'comment in:' if comment else 'document:'} {entity.file_name}",
        )


def notify_share(entity_name, docperm_name):
    """
    Create a share notification for each user
    :param entity_name: ID of entity
    :param document_name: ID of docshare containing share info
    """
    entity = frappe.get_doc("File", entity_name)
    docshare = frappe.get_doc("Drive Permission", docperm_name)

    author_full_name = frappe.db.get_value("User", {"name": docshare.owner}, ["full_name"])
    entity_type = "document" if entity.file_type == "Document" else "folder" if entity.is_folder else "file"
    link = get_link(entity)
    message = f'{author_full_name} shared a {entity_type} with you: "{entity.file_name}"'
    if not frappe.db.exists("User", docshare.user):
        key = frappe.get_value("Drive User Invitation", {"email": docshare.user})
        link = frappe.utils.get_url(
            f"/api/method/suite.drive.api.product.accept_invite?key={key}&redirect={link}"
        )
    else:
        create_notification(docshare.owner, docshare.user, "Share", entity, message)
    send_share_email(docshare.user, message, link, entity_type)


def create_notification(from_user: str, to_user: str, type: str, entity: str, message: str | None = None):
    from suite.drive.api.permissions import get_user_access_for_user

    user_access = get_user_access_for_user(entity.name, to_user)
    if user_access.get("read") == 0:
        return

    entity_type = "Document" if entity.file_type == "Document" else "Folder" if entity.is_folder else "File"
    details = {
        "from_user": from_user,
        "to_user": to_user,
        "type": type,
        "entity_type": entity_type,
        "notif_doctype": "File",
        "notif_doctype_name": entity.name,
        "message": message,
    }
    notif = frappe.db.exists("Drive Notification", details)
    if notif:
        return False
    try:
        frappe.get_doc({"doctype": "Drive Notification", **details}).insert()
        return True
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Frappe Drive Notification Error")
        return False


def drive_logo_inline_images():
    """The Drive wordmark logo in frappe.sendmail's `embed=` format (templates
    reference it as embed="drive-logo.png")."""

    try:
        with open(frappe.get_app_path("suite", "public", "drive", "images", "logo.png"), "rb") as f:
            return [{"filename": "drive-logo.png", "filecontent": f.read()}]
    except OSError:
        return []


def send_share_email(to, message, link, type_):
    try:
        frappe.sendmail(
            recipients=to,
            subject=f"Frappe Drive - {type_.capitalize()} Shared",
            template="drive_share",
            args={
                "message": message,
                "type": type_,
                "link": link,
            },
            inline_images=drive_logo_inline_images(),
        )
    except Exception:
        pass
