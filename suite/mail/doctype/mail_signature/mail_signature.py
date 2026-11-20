# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from collections import defaultdict

import frappe
from frappe.model.document import Document

from suite.utils.permissions import OwnerFromUser


class MailSignature(OwnerFromUser, Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        from suite.mail.doctype.mail_signature_identity.mail_signature_identity import (
            MailSignatureIdentity,
        )

        html_body: DF.Code | None
        identities: DF.Table[MailSignatureIdentity]
        signature_name: DF.Data
        user: DF.Link
    # end: auto-generated types

    def before_save(self) -> None:
        before = self.get_doc_before_save()
        # The JMAP calls act as the session user, so only the owner's own edit is carried.
        if frappe.session.user != self.user or not before or not self.identities:
            return
        if not same_signature(before.html_body, self.html_body):
            self.carry_edit(before.html_body)

    def carry_edit(self, old_html: str | None) -> None:
        """Give the edited signature to the identities linked to it.

        Choosing a saved signature for an identity copies it there, and the composer reads the copy,
        so an edit reaches no mail until the copies follow it. A linked identity that no longer
        carries the old signature was changed some other way: it is left alone and unlinked. A
        failed copy is logged and does not undo the edit.
        """

        from suite.mail.doctype.identity.identity import update_identity
        from suite.mail.jmap import get_cached_identities, invalidate_jmap_identities_cache
        from suite.mail.utils.html_to_text import html_to_text

        links_by_account = defaultdict(list)
        for link in self.identities:
            account, _, identity_id = link.identity.partition("|")
            links_by_account[account].append((link, identity_id))

        kept = []
        for account, links in links_by_account.items():
            invalidate_jmap_identities_cache(account)
            current = {identity["id"]: identity for identity in get_cached_identities(account)}
            for link, identity_id in links:
                identity = current.get(identity_id)
                if not identity or not same_signature(identity.get("htmlSignature"), old_html):
                    continue
                kept.append(link)
                try:
                    update_identity(
                        account,
                        identity_id,
                        identity.get("name"),
                        identity.get("replyTo"),
                        identity.get("bcc"),
                        html_to_text(self.html_body or "") or None,
                        self.html_body,
                    )
                except Exception:
                    frappe.log_error(f"Could not update the signature of identity {link.identity}")
            invalidate_jmap_identities_cache(account)
        self.set("identities", kept)


def link_identity(identity: str, signature: str | None, html_signature: str | None) -> None:
    """Record which of the session user's saved signatures the identity now uses, if any.

    The link is kept only when the identity's signature is that saved signature's words.
    """

    linked = frappe.get_all(
        "Mail Signature Identity",
        filters={"parenttype": "Mail Signature", "identity": identity},
        pluck="parent",
    )
    # A signature deleted meanwhile, or someone else's, is no link to keep or make
    names = frappe.get_all(
        "Mail Signature",
        filters={"name": ["in", [*linked, *([signature] if signature else [])]], "user": frappe.session.user},
        pluck="name",
    )
    for name in names:
        doc = frappe.get_doc("Mail Signature", name)
        wanted = name == signature and same_signature(doc.html_body, html_signature)
        if wanted == any(row.identity == identity for row in doc.identities):
            continue
        if wanted:
            doc.append("identities", {"identity": identity})
        else:
            doc.set("identities", [row for row in doc.identities if row.identity != identity])
        doc.save()


def linked_identities(signatures: list[str]) -> dict[str, list[str]]:
    by_signature = defaultdict(list)
    for row in frappe.get_all(
        "Mail Signature Identity",
        filters={"parenttype": "Mail Signature", "parent": ["in", signatures]},
        fields=["parent", "identity"],
        order_by="idx asc",
    ):
        by_signature[row.parent].append(row.identity)
    return by_signature


def same_signature(a: str | None, b: str | None) -> bool:
    return (a or "").strip() == (b or "").strip()
