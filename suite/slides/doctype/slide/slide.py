# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from suite.slides import drive as slides_drive


class Slide(Document):
    def save(self, *args: object, **kwargs: object) -> Slide:
        """Save this row alone, unless its deck is converted."""
        self.refuse_on_a_converted_deck()
        return super().save(*args, **kwargs)

    def insert(self, *args: object, **kwargs: object) -> Slide:
        """Insert this row alone, unless its deck is converted."""
        self.refuse_on_a_converted_deck()
        return super().insert(*args, **kwargs)

    def on_trash(self) -> None:
        """Delete this row alone, unless its deck is converted."""
        self.refuse_on_a_converted_deck()

    def refuse_on_a_converted_deck(self) -> None:
        """Refuse a row written on its own, past its deck's fence, on the deck it left or the one it joins."""
        places = [(self.parent, self.parenttype)]
        if self.name:
            places.append(frappe.db.get_value("Slide", self.name, ["parent", "parenttype"]) or (None, None))

        decks = {parent for parent, parenttype in places if parenttype == slides_drive.DOCTYPE}
        # In one order, as a deck's lock comes before its rows'
        for deck in sorted(decks):
            slides_drive.refuse_row_write(frappe.db.get_value(slides_drive.DOCTYPE, deck, "node"))
