import frappe

from suite.mail.doctype.user_account.user_account import get_user_personal_jmap_account


def execute() -> None:
    """Number the accounts linked before User Account carried one (see number_accounts).

    0 for each user's personal account, the rest from 1 in the order they were linked.
    """

    for user in frappe.db.get_all("User Account", distinct=True, pluck="user"):
        personal = get_user_personal_jmap_account(user)
        links = frappe.db.get_all(
            "User Account", {"user": user}, ["name", "account"], order_by="creation asc, name asc"
        )

        last = 0
        for link in links:
            number = 0
            if link.account != personal:
                last += 1
                number = last
            frappe.db.set_value("User Account", link.name, "number", number, update_modified=False)

        frappe.db.set_value(
            "User Settings", {"user": user}, "last_account_number", last, update_modified=False
        )
