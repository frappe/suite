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
