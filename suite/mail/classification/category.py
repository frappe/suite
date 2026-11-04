# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from enum import StrEnum


class Category(StrEnum):
    """The categories mail is sorted into.

    A message's category is kept on the JMAP server as one of its keywords, so it travels with the
    message and can be searched for (``hasKeyword``).
    """

    PRIMARY = "primary"
    PROMOTIONS = "promotions"
    SOCIAL = "social"
    UPDATES = "updates"
    FORUMS = "forums"

    @property
    def keyword(self) -> str:
        """The JMAP keyword that marks a message as being in this category."""

        return f"category_{self.value}"


def get_category(keywords: dict | None) -> Category | None:
    """The category among a message's `keywords`, or None for one not classified yet."""

    return next((category for category in Category if (keywords or {}).get(category.keyword)), None)


# The categories the Inbox is split into, in the order of their tabs. Mail of a category without a
# tab of its own stays in Primary.
INBOX_TABS = (Category.PRIMARY, Category.UPDATES, Category.FORUMS, Category.PROMOTIONS, Category.SOCIAL)


def tab_filter(category: Category, tabs: tuple[Category, ...] = INBOX_TABS) -> dict:
    """The JMAP filter for the mail a tab of the Inbox lists.

    A tab lists the mail carrying its keyword. Primary lists what carries no other tab's keyword: its
    own mail, mail of a category without a tab, and mail not classified yet.
    """

    if category != Category.PRIMARY:
        return {"hasKeyword": category.keyword}
    return {
        "operator": "AND",
        "conditions": [{"notKeyword": tab.keyword} for tab in tabs if tab != Category.PRIMARY],
    }
