import json
from urllib.parse import urlparse

import frappe

GENERATED_THUMBNAIL_PREFIX = "thumbnail-"
FILE_URL_PREFIXES = ("/private/files/", "/files/")


def get_url_variants(file_url):
    if not file_url:
        return set()

    path = urlparse(file_url).path or file_url
    variants = {file_url, path}

    if path.startswith("/private/files/"):
        variants.add(path.replace("/private/files/", "/files/", 1))
    elif path.startswith("/files/"):
        variants.add(path.replace("/files/", "/private/files/", 1))

    return variants


def get_file_url_path(file_url):
    return urlparse(file_url or "").path


def add_referenced_url(referenced_urls, file_url):
    if isinstance(file_url, str) and file_url and not file_url.startswith("/assets"):
        referenced_urls.update(get_url_variants(file_url))


def is_generated_thumbnail_file(file):
    if not file.file_name.startswith(GENERATED_THUMBNAIL_PREFIX):
        return False

    path = urlparse(file.file_url or "").path
    if not path.startswith(FILE_URL_PREFIXES):
        return False

    file_url_name = path.rsplit("/", 1)[-1]
    return file_url_name.startswith(GENERATED_THUMBNAIL_PREFIX)


def get_referenced_file_urls():
    referenced_urls = set()

    # move_slide_thumbnail_to_presentation runs before this patch and lifts the first
    # slide's thumbnail onto the deck, so the deck is the only holder of that URL,
    # and with the field gone from the DocType (Q19') its column, where one is left, is read by SQL
    if frappe.db.has_column("Presentation", "thumbnail"):
        for thumbnail in frappe.db.sql_list("SELECT `thumbnail` FROM `tabPresentation`"):
            add_referenced_url(referenced_urls, thumbnail)

    slides = frappe.get_all(
        "Slide",
        filters={"parenttype": "Presentation"},
        fields=["thumbnail", "elements"],
    )

    for slide in slides:
        add_referenced_url(referenced_urls, slide.thumbnail)

        try:
            elements = json.loads(slide.elements or "[]")
        except json.JSONDecodeError:
            continue

        for element in elements:
            if not isinstance(element, dict):
                continue

            add_referenced_url(referenced_urls, element.get("src"))
            add_referenced_url(referenced_urls, element.get("poster"))

    return referenced_urls


def get_thumbnail_files():
    thumbnail_files = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Presentation",
            "file_name": ["like", f"{GENERATED_THUMBNAIL_PREFIX}%"],
        },
        fields=["name", "file_name", "file_url", "attached_to_name"],
    )

    return [file for file in thumbnail_files if is_generated_thumbnail_file(file)]


def get_unused_thumbnail_files():
    referenced_urls = get_referenced_file_urls()
    thumbnail_files = get_thumbnail_files()

    unused_files = []
    for file in thumbnail_files:
        file_url_variants = get_url_variants(file.file_url)
        if not file_url_variants.intersection(referenced_urls):
            unused_files.append(file)

    print(f"Found {len(unused_files)} unused thumbnail files.")
    return unused_files


def cleanup_unused_thumbnail_files(dry_run=False):
    unused_thumbnail_files = get_unused_thumbnail_files()

    for file in unused_thumbnail_files:
        if dry_run:
            continue

        try:
            frappe.delete_doc("File", file.name)
        except Exception as e:
            frappe.log_error(
                title="Failed to delete unused Presentation thumbnail",
                message=f"File: {file.name}\nURL: {file.file_url}\nError: {e}",
            )

    return unused_thumbnail_files


def execute():
    cleanup_unused_thumbnail_files()
