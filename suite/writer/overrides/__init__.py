import frappe

from suite.drive.api.permissions import user_has_permission
from suite.drive.overrides.file import File, content_query_conditions

READ_PTYPES = frozenset({"read", "report", "export", "email", "print", "select"})


# Writer Document is not here. Drive governs it through
# `suite.drive.framework.doc_has_permission` and `doc_query_conditions`
# (§10.4). What stays below guards the two legacy tables Build has not copied
# yet: `Writer Template` rows become template documents (§14.7) and
# `Writer Version` rows become `Drive Node Version` rows (§14.6). Both are read
# through the legacy Drive File they were written under, and both go with the
# doctypes at Cleanup.


def filter_templates(user):
    # Templates are site-wide readable; guests get nothing.
    if (user or frappe.session.user) == "Guest":
        return "1=0"
    return ""


def template_has_permission(doc, ptype="read", user=None):
    user = user or frappe.session.user
    if ptype == "create" or user == "Administrator":
        return True
    if ptype in READ_PTYPES:
        return user != "Guest"
    return doc.get("owner") == user


def version_has_permission(doc, ptype="read", user=None):
    """A Writer Version is readable/writable iff the backing Drive File of its
    parent document is."""
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    parent = doc.get("doc")
    if not parent:
        return False
    file = File.get_for_doc("Writer Document", parent)
    if not file:
        return False
    return bool(user_has_permission(file, "read" if ptype in READ_PTYPES else "write", user))


def version_query_conditions(user):
    """`permission_query_conditions` for Writer Version — scope rows to versions
    whose parent document the caller can read (owned or directly shared)."""
    if user == "Administrator":
        return ""
    doc_predicate = content_query_conditions("Writer Document", user)
    if not doc_predicate:
        return ""
    return (
        "`tabWriter Version`.doc IN ("
        "SELECT `tabWriter Document`.name FROM `tabWriter Document` "
        f"WHERE {doc_predicate})"
    )
