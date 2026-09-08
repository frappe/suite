import io

import frappe
import markdown
import mimemapper
from markdown.extensions.wikilinks import WikiLinkExtension

from suite import drive
from suite.drive.api.permissions import (
    get_entity_with_permissions,
    user_has_permission,
)
from suite.drive.utils.files import FileManager

# To be moved to mimemapper
QUICK_MAP = {
    "video/quicktime": "mov",
    "image/gif": "gif",
}

DEFAULT_TITLE = "Untitled Document"

# The response this endpoint has always answered is the legacy `File` field
# names, because the frontend contract (`prettyData`, `DocumentList.vue`) was
# never updated to read a `Drive Node` row. This is the same rename `suite.
# drive.http.shims._legacy_row` does for the read side; docs.py keeps its own
# copy rather than reaching into that module, which Cleanup deletes (§14.10).
_NODE_RESPONSE_FIELDS = (
    "name",
    "parent",
    "title",
    "size",
    "mime",
    "content_doctype",
    "content_docname",
    "creation",
    "content_modified",
    "modified",
    "owner",
)


@frappe.whitelist()
def create_document(title: str | None = None, parent: str | None = None, template: str | None = None):
    """Create one Writer document, Drive-native from the first insert.

    `Writer Document` is registered in `drive_content_types`, so
    `DriveContent.before_insert` refuses any row with no node (§10.2's expand
    phase is over for this doctype). `suite.drive.create_document` is the one
    workflow that can still write one: it inserts the node, calls Writer's
    `create_empty` factory, links the two names together, charges the owning
    root for the byte accounting, and rolls every step back on any refusal
    (one savepoint, §8.3). Authorization is the workflow's own UPLOAD check on
    `parent`, not a check made here.

    `parent` defaults to the caller's personal root node, the same default
    `suite.drive.http.shims._home` uses. A `parent` a caller does pass must
    already be a Drive Node id; one that only a legacy `File` still holds is
    refused by the workflow (`DriveNotFound`), the same way every other
    Drive-native create already behaves for an unadopted destination.
    """
    user = frappe.session.user
    parent = parent or drive.personal_root_for(user) or drive.ensure_personal_root(user)
    if not parent:
        frappe.throw("A personal Drive folder is required", frappe.ValidationError)

    node = drive.create_document(parent, title or DEFAULT_TITLE, content_doctype="Writer Document")
    row = frappe.db.get_value("Drive Node", node, _NODE_RESPONSE_FIELDS, as_dict=True)

    if template:
        frappe.db.set_value(
            "Writer Document",
            row.content_docname,
            "settings",
            frappe.as_json({"collab": True, "template": template}),
            update_modified=False,
        )

    return {
        "name": row.name,
        "file_name": row.title,
        "folder": row.parent,
        "file_size": int(row.size or 0),
        "file_type": "Document",
        "mime_type": row.mime,
        "is_folder": 0,
        "content_doctype": row.content_doctype,
        "content_docname": row.content_docname,
        "creation": row.creation,
        "modified": row.content_modified or row.modified,
        "owner": row.owner,
    }


@frappe.whitelist(allow_guest=True)
def get_document(file_id: str):
    return_obj = get_entity_with_permissions(file_id)
    entity = frappe._dict(return_obj)

    # Non-Writer-backed files (e.g. markdown) are read straight off disk.
    if entity.content_doctype != "Writer Document":
        return get_markdown_file(entity, return_obj)

    writer_doc = frappe.get_doc("Writer Document", entity.content_docname).as_dict()
    writer_doc.pop("name")
    writer_doc.pop("owner")
    writer_doc.pop("versions", None)

    return_obj |= writer_doc | {"modified": entity.modified}
    frappe.response["data"] = return_obj


def get_markdown_file(entity, return_obj):
    manager = FileManager()
    wrapper = io.TextIOWrapper(manager.get_file(entity))
    url_builder = lambda label, base, end: f"/api/method/suite.writer.api.docs.get_wiki_link?title={label}"
    with wrapper as r:
        content = r.read()
        md = markdown.Markdown(
            extensions=["extra", "meta", WikiLinkExtension(build_url=url_builder)],
        )
        content = clean_content_for_obsidian(content)
        md.set_output_format("html")
        return_obj["file_content"] = md.convert(content)
        return_obj["properties"] = md.Meta

    frappe.response["data"] = return_obj


def clean_content_for_obsidian(content):
    property_end = content[3:].find("---")
    if content.startswith("---") and property_end != -1:
        content = content[:property_end].replace("\n  ", " " * 4) + content[property_end:]
    content = content[:property_end] + content[property_end:].replace("\n", "\n\n")
    content = content[:property_end] + content[property_end:].replace("\n\n\n", "\n<p></p>")
    return content


@frappe.whitelist(allow_guest=True)
def save_comments(doc: str, data: str):
    file = frappe.get_doc("File", {"content_docname": doc, "content_doctype": "Writer Document"})
    if not user_has_permission(file, "comment"):
        frappe.throw("You cannot comment on this file.")

    frappe.get_doc("Writer Document", doc).save_comments(data, file)


@frappe.whitelist()
def get_extension(entity_name: str):
    mime_type = frappe.get_value("File", entity_name, "mime_type")
    try:
        return mimemapper.get_extension(mime_type)
    except:
        return QUICK_MAP.get(mime_type, "")


@frappe.whitelist()
def create_blog(entity_name: str, html: str, attachments: str | None = None):
    """
    If the blog app is installed, creates a blog
    """
    file = frappe.get_doc("File", entity_name)
    if not user_has_permission(file, "read"):
        frappe.throw("You don't have access to this file.", frappe.PermissionError)
    blogger = frappe.db.exists("Blogger", {"user": frappe.session.user})
    if not blogger:
        frappe.throw("Please create a Blogger for your user first.")

    if not frappe.db.exists("Blog Category", {"name": "writer-export"}):
        category = frappe.get_doc({"doctype": "Blog Category", "title": "Writer Export"})
        category.insert()
        print("insrted", category, category.name)
    else:
        category = frappe.get_doc("Blog Category", "writer-export")

    blog = frappe.get_doc(
        {
            "doctype": "Blog Post",
            "title": file.file_name,
            "content_type": "HTML",
            "blog_category": category.name,
            "blogger": blogger,
            "content_html": html,
        }
    )
    blog.insert()
    return blog.name


@frappe.whitelist(allow_guest=True)
def get_wiki_link(title: str):
    title = title.strip("/")
    possible_titles = [title, title + ".md", title + ".txt"]
    names = (frappe.get_value("File", {"file_name": k, "is_folder": 0}, "name") for k in possible_titles)
    try:
        name = next(k for k in names if k and user_has_permission(k, "read"))
    except StopIteration:
        frappe.throw("Cannot get this wikilink.", frappe.NotFound)

    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = "/drive/f/" + name
    return title
