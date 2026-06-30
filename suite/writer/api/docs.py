from pathlib import Path
import io

import frappe
import markdown
from markdown.extensions.wikilinks import WikiLinkExtension
import mimemapper

from suite.drive.utils import (
    create_drive_file,
    default_team,
    get_home_folder,
)
from suite.drive.api.files import get_new_title
from suite.drive.api.permissions import (
    user_has_permission,
    get_entity_with_permissions,
)
from suite.drive.utils.files import FileManager, storage_key

# To be moved to mimemapper
QUICK_MAP = {
    "video/quicktime": "mov",
    "image/gif": "gif",
}


@frappe.whitelist()
@default_team
def create_document(team: str, title: str | None = None, parent: str | None = None, template: str | None = None):
    home_directory = get_home_folder(team)
    parent = parent or home_directory.name
    parent_doc = frappe.get_doc("File", parent)
    team = frappe.db.get_value("File", parent, "team")
    if not title:
        title = get_new_title("Untitled Document", parent)

    if not user_has_permission(parent, "upload"):
        frappe.throw(
            "Cannot access folder due to insufficient permissions",
            frappe.PermissionError,
        )

    writer_doc = frappe.new_doc("Writer Document")
    writer_doc.settings = (
        '{"collab": true}'
        if not template
        else '{"collab": true, "template": "' + template + '"}'
    )
    writer_doc.save()

    manager = FileManager()
    path = manager.create_folder(
        frappe._dict(
            {
                "file_name": title,
                "team": team,
                "parent_path": Path(storage_key(parent_doc.file_url)),
            }
        ),
        home_directory,
    )
    manager.create_folder(
        frappe._dict(
            {
                "file_name": ".embeds",
                "team": team,
                "parent_path": Path(path) if path else None,
            }
        ),
        home_directory,
    )

    entity = create_drive_file(
        team,
        title,
        parent,
        "Document",
        path,
        mime_type="frappe_doc",
        content_doctype="Writer Document",
        content_docname=writer_doc.name,
    )
    return entity


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
    url_builder = (
        lambda label, base, end: f"/api/method/suite.writer.api.docs.get_wiki_link?team={entity.team}&title={label}"
    )
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
        content = (
            content[:property_end].replace("\n  ", " " * 4) + content[property_end:]
        )
    content = content[:property_end] + content[property_end:].replace("\n", "\n\n")
    content = content[:property_end] + content[property_end:].replace(
        "\n\n\n", "\n<p></p>"
    )
    return content


@frappe.whitelist(allow_guest=True)
def save_comments(doc: str, data: str):
    file = frappe.get_doc(
        "File", {"content_docname": doc, "content_doctype": "Writer Document"}
    )
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
    blogger = frappe.db.exists("Blogger", {"user": frappe.session.user})
    if not blogger:
        frappe.throw("Please create a Blogger for your user first.")

    if not frappe.db.exists("Blog Category", {"name": "writer-export"}):
        category = frappe.get_doc(
            {"doctype": "Blog Category", "title": "Writer Export"}
        )
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
def get_wiki_link(title: str, team: str):
    title = title.strip("/")
    possible_titles = [title, title + ".md", title + ".txt"]
    names = (
        frappe.get_value(
            "File", {"file_name": k, "team": team, "is_folder": 0}, "name"
        )
        for k in possible_titles
    )
    try:
        name = next(k for k in names if k)
    except StopIteration:
        frappe.throw("Cannot get this wikilink in this team.", frappe.NotFound)

    frappe.local.response["type"] = "redirect"
    frappe.local.response["location"] = "/drive/f/" + name
    return title
