# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite.utils.permissions import OwnerFromUser


class MailSignature(OwnerFromUser, Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

        html_body: DF.Code | None
        signature_name: DF.Data
        user: DF.Link
    # end: auto-generated types

    def on_update(self) -> None:
        before = self.get_doc_before_save()
        # The JMAP calls act as the session user, so only the owner's own edit is carried.
        if frappe.session.user != self.user:
            return
        if before and before.html_body and before.html_body != self.html_body:
            carry_edit_to_identities(self.user, before.html_body, self.html_body)


def carry_edit_to_identities(user: str, old_html: str, new_html: str | None) -> None:
    """Give the edited signature to the user's identities that still carry the old one.

    Choosing a saved signature for an identity copies it there, and the composer reads the copy.
    So an edit reaches no mail until the copies follow it. An identity whose signature was
    written another way is left alone. A failed copy is logged and does not undo the edit.
    """

    from suite.mail.doctype.identity.identity import update_identity
    from suite.mail.doctype.user_account.user_account import get_user_jmap_accounts
    from suite.mail.jmap import get_cached_identities, invalidate_jmap_identities_cache
    from suite.mail.utils.html_to_text import html_to_text

    for account in get_user_jmap_accounts(user):
        invalidate_jmap_identities_cache(account)
        for identity in get_cached_identities(account):
            if (identity.get("htmlSignature") or "").strip() != old_html.strip():
                continue
            try:
                update_identity(
                    account,
                    identity["id"],
                    identity.get("name"),
                    identity.get("replyTo"),
                    identity.get("bcc"),
                    html_to_text(new_html) or None,
                    new_html,
                )
            except Exception:
                frappe.log_error(f"Could not update the signature of identity {identity['id']}")
        invalidate_jmap_identities_cache(account)
