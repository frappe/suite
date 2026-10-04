import frappe
import mimemapper

from suite import drive
from suite.writer import comments
from suite.writer.drive import DOCTYPE

# To be moved to mimemapper
QUICK_MAP = {
    "video/quicktime": "mov",
    "image/gif": "gif",
}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def save_comments(doc: str, data: str):
    """Store the inline comment threads of one Writer document.

    Inline comments are a Yjs document of their own, anchored to positions in
    the body that only Writer can read, so they are body data Writer keeps in
    `ycomments`, not Drive comments. Adding a comment or resolving a thread
    needs COMMENT on the node (`suite/drive/CONTEXT.md`, Rules), and a trashed
    node refuses it like any other write above READ.

    A comment that gained a mention is reported to Drive, which records the
    activity and notifies the people it names, as a Drive comment's mention
    does. `drive.record_comment` carries the COMMENT check for that path, so
    the save and its report are refused together, before the blob is written.

    `allow_guest` lets a link holder with Comment reach the route; Drive's
    check decides whether they may act.
    """
    document = frappe.get_doc(DOCTYPE, doc)
    document.drive_check(drive.COMMENT)
    for mentioned in comments.new_mentions(document.ycomments, data):
        drive.record_comment(
            document.node,
            thread=mentioned.thread,
            comment=mentioned.comment,
            resolved=mentioned.resolved,
            mentions=mentioned.users,
        )
    frappe.db.set_value(DOCTYPE, document.name, "ycomments", data, update_modified=False)


@frappe.whitelist()
def get_extension(entity_name: str):
    """The file extension of one readable media node, for an export's file names."""
    drive.check(entity_name, drive.READ)
    mime_type = frappe.db.get_value("Drive Node", entity_name, "mime")
    try:
        return mimemapper.get_extension(mime_type)
    except Exception:
        return QUICK_MAP.get(mime_type, "")


@frappe.whitelist()
def create_blog(entity_name: str, html: str, attachments: str | None = None):
    """Publish one readable document's rendered body as a Blog Post, if the blog app is installed."""
    drive.check(entity_name, drive.READ)
    blogger = frappe.db.exists("Blogger", {"user": frappe.session.user})
    if not blogger:
        frappe.throw("Please create a Blogger for your user first.")

    if not frappe.db.exists("Blog Category", {"name": "writer-export"}):
        category = frappe.get_doc({"doctype": "Blog Category", "title": "Writer Export"})
        category.insert()
    else:
        category = frappe.get_doc("Blog Category", "writer-export")

    blog = frappe.get_doc(
        {
            "doctype": "Blog Post",
            "title": frappe.db.get_value("Drive Node", entity_name, "title"),
            "content_type": "HTML",
            "blog_category": category.name,
            "blogger": blogger,
            "content_html": html,
        }
    )
    blog.insert()
    return blog.name
