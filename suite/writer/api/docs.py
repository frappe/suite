import io

import frappe
import markdown
import mimemapper
from frappe import _
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


# `Untitled Document` is the one title nobody chose, so Drive's sibling refusal
# (§8.6) must not surface as an error the user cannot act on. An explicit title
# is still refused on collision, because there the UI can ask for another one.
UNTITLED = "Untitled Document"
UNTITLED_ATTEMPTS = 20


@frappe.whitelist(methods=["POST"])
def create_document(title: str | None = None, parent: str | None = None, template: str | None = None):
    """Create one Writer document, or a copy of a template, through Drive.

    `parent` is a Drive node id and defaults to the caller's Personal root.
    `template` is the node id of a Writer document to start from, which is how
    §8.10 spells new-from-template: there is no template verb.
    """
    parent = parent or drive.ensure_personal_root(frappe.session.user)
    if not parent:
        frappe.throw(_("You have no Drive of your own to create a document in"))

    if title:
        node = drive.create_document(parent, title, content_doctype="Writer Document", from_node=template)
        return _created(node, title)

    # Every Drive refusal is a `frappe.ValidationError` and the sibling one
    # carries no code of its own, so a refusal that is not a collision is
    # retried too. The loop is bounded and the last refusal is what the caller
    # sees, so a forbidden parent still reports itself rather than a collision.
    refusal = None
    for attempt in range(1, UNTITLED_ATTEMPTS + 1):
        candidate = UNTITLED if attempt == 1 else f"{UNTITLED} ({attempt})"
        try:
            node = drive.create_document(
                parent, candidate, content_doctype="Writer Document", from_node=template
            )
        except frappe.ValidationError as refused:
            refusal = refused
            continue
        return _created(node, candidate)
    raise refusal


def _created(node: str, title: str) -> dict:
    return {"name": node, "title": title}


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
