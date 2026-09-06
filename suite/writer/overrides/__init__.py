import frappe

from suite.drive.api.permissions import user_has_permission
from suite.drive.overrides.file import File, content_has_permission, content_query_conditions

READ_PTYPES = frozenset({"read", "report", "export", "email", "print", "select"})

DOCTYPE = "Writer Document"
NODE_FIELD = "node"

# Adoption is staged (§10.3, README execution rules). `Writer Document` carries
# a `node` Link from ticket 17, but `drive_content_types` stays empty and these
# two hooks stay here until ticket 29 has Build's links. So every guard below
# reads the node column and answers on one of two sides:
#
#   node set    Drive-native. `Drive Grant` is the only authority (§1), and
#               this module cannot read it: the entries that can live in
#               `suite.drive.framework` and arrive with the registry. Refused
#               here, never answered from the legacy `File`, because that
#               would be a way around Drive.
#   no node     A legacy row Build has not linked. Unchanged File-backed
#               behaviour until §14.6/§14.7 copy it and Cleanup removes it.
#
# `Writer Template` and `Writer Version` rows are legacy only by construction:
# nothing writes a version for a linked document, and templates are Drive nodes
# from ticket 17 on.


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


def document_has_permission(doc, ptype="read", user=None, debug=False):
    """Answer one `Writer Document` row check while adoption is staged.

    A linked row is refused: only `Drive Grant` may open it, and the hook that
    reads grants (`suite.drive.framework.doc_has_permission`) is installed with
    the registry at ticket 29. A hook may only deny, so this costs a legacy row
    nothing and an Administrator nothing — `frappe.has_permission` answers
    before any controller hook for them (`frappe/permissions.py:108-110`).
    """
    if doc.get(NODE_FIELD):
        return False
    return content_has_permission(doc, ptype, user)


def document_query_conditions(user=None, doctype=None):
    """`permission_query_conditions` for `Writer Document`, staged the same way.

    The legacy predicate is owner-or-directly-shared through the backing
    `File`, and a Drive-native row has neither, so `owner = <user>` alone would
    list one. The node column is what excludes it, until ticket 29 replaces
    this whole predicate with the node-based one.
    """
    legacy = content_query_conditions(DOCTYPE, user)
    if not legacy:
        return legacy
    return f"`tab{DOCTYPE}`.`{NODE_FIELD}` IS NULL AND ({legacy})"


def version_has_permission(doc, ptype="read", user=None):
    """A Writer Version is readable/writable iff the backing Drive File of its
    parent document is.

    A version of a linked document has no backing File and is refused. Nothing
    writes one: `WriterDocument.new_version` refuses a linked row, and §14.6
    migrates these rows into `Drive Node Version`.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    parent = doc.get("doc")
    if not parent:
        return False
    file = File.get_for_doc(DOCTYPE, parent)
    if not file:
        return False
    return bool(user_has_permission(file, "read" if ptype in READ_PTYPES else "write", user))


def version_query_conditions(user):
    """`permission_query_conditions` for Writer Version — scope rows to versions
    whose parent document the caller can read (owned or directly shared).

    It reuses `document_query_conditions`, so the list and the row check agree
    on a linked document: both refuse it. Left apart, the row check denied
    every non-admin while the list still returned the owner's rows.
    """
    if user == "Administrator":
        return ""
    doc_predicate = document_query_conditions(user)
    if not doc_predicate:
        return ""
    return (
        f"`tabWriter Version`.doc IN (SELECT `tab{DOCTYPE}`.name FROM `tab{DOCTYPE}` WHERE {doc_predicate})"
    )
