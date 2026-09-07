import frappe

from suite import drive
from suite.drive.api.permissions import user_has_permission
from suite.drive.overrides.file import File, content_has_permission, content_query_conditions

READ_PTYPES = frozenset({"read", "report", "export", "email", "print", "select"})

DOCTYPE = "Writer Document"
NODE_FIELD = "node"
VERSION_DOCTYPE = "Writer Version"

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
# Refusing a linked row is not the same as answering `False` for it. Frappe
# widens both hooks with `DocShare` rows the app never sees: the row check
# falls through to `false_if_not_shared` (`frappe/permissions.py:214-216`) and
# the list ORs the shared names around the predicate
# (`frappe/database/query.py:1739-1742`). Neither can be answered from inside
# the hook, so both guards call Drive to refuse, exactly as
# `suite.drive.framework` refuses after activation.
#
# `Writer Template` rows are legacy only by construction. Build preserves old
# `Writer Version` rows after it links their parent documents, so the version
# hooks below resolve authority through that parent and refuse a surviving
# child-row share before Frappe can OR it around the answer.


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
    before any controller hook for them (`frappe/permissions.py:109-111`).

    `False` alone would not deny it. Frappe reads `False` as "no role
    permission" and then asks `false_if_not_shared`, which one `DocShare`
    answers Yes, `everyone` rows included. That is a way around `Drive Grant`
    (§1) for the whole window between Build and ticket 29, so Drive refuses the
    share first. A legacy row never reaches the call.
    """
    if doc.get(NODE_FIELD):
        drive.refuse_shared_row(doc.doctype, doc.get("name"), ptype, user)
        return False
    return content_has_permission(doc, ptype, user)


def document_query_conditions(user=None, doctype=None):
    """`permission_query_conditions` for `Writer Document`, staged the same way.

    The legacy predicate is owner-or-directly-shared through the backing
    `File`, and a Drive-native row has neither, so `owner = <user>` alone would
    list one. The node column is what excludes it, until ticket 29 replaces
    this whole predicate with the node-based one.

    No predicate can exclude a shared linked row: the shared names are ORed
    around whatever this returns. Drive refuses the list instead, scoped to a
    row that carries a node. Before Build no row carries one, so a site with
    Desk assignments lists exactly what it always listed.
    """
    drive.refuse_shared_linked_rows(DOCTYPE, NODE_FIELD, user)
    return _document_predicate(user)


def _document_predicate(user=None):
    """The staged `Writer Document` predicate on its own, with no share refusal.

    `version_query_conditions` scopes versions with it. A `DocShare` on a
    `Writer Document` does not widen a `Writer Version` list: Frappe ORs the
    shared names of the doctype being listed. Refusing there would take a
    legacy version list down for a share that could never have opened it.
    """
    legacy = content_query_conditions(DOCTYPE, user)
    if not legacy:
        return legacy
    return f"`tab{DOCTYPE}`.`{NODE_FIELD}` IS NULL AND ({legacy})"


def version_has_permission(doc, ptype="read", user=None):
    """A Writer Version is readable/writable iff the backing Drive File of its
    parent document is.

    Build preserves legacy version rows after linking their parent. A linked
    parent's history is Drive-owned, so this refuses any widening share on the
    child and never consults the surviving legacy File. An unlinked parent
    keeps the old File-backed behavior until Cleanup.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    parent = doc.get("doc")
    if not parent:
        drive.refuse_shared_row(VERSION_DOCTYPE, doc.get("name"), ptype, user)
        return False
    if frappe.db.get_value(DOCTYPE, parent, NODE_FIELD):
        drive.refuse_shared_row(VERSION_DOCTYPE, doc.get("name"), ptype, user)
        return False
    file = File.get_for_doc(DOCTYPE, parent)
    if not file:
        return False
    return bool(user_has_permission(file, "read" if ptype in READ_PTYPES else "write", user))


def version_query_conditions(user):
    """`permission_query_conditions` for Writer Version — scope rows to versions
    whose parent document the caller can read (owned or directly shared).

    It reuses the `Writer Document` predicate, so the list and the row check
    agree on a linked document: both refuse it. Left apart, the row check
    denied every non-admin while the list still returned the owner's rows.
    """
    user = user or frappe.session.user
    if user == "Administrator":
        return ""
    drive.refuse_shared_child_rows(VERSION_DOCTYPE, DOCTYPE, "doc", NODE_FIELD, user)
    doc_predicate = _document_predicate(user)
    if not doc_predicate:
        return ""
    return (
        f"`tabWriter Version`.doc IN (SELECT `tab{DOCTYPE}`.name FROM `tab{DOCTYPE}` WHERE {doc_predicate})"
    )
