# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from suite.mail.api.contacts import (
    get_address_book_contact_count,
    get_address_books,
    get_contact_cards,
    get_contacts,
    get_contacts_from_cache,
)
from suite.mail.doctype.address_book.address_book import (
    add_address_book,
    delete_address_books,
    update_address_book,
)
from suite.mail.doctype.contact_card.contact_card import (
    add_contact_card,
    contact_card_add_to_address_book,
    contact_card_move_between_address_books,
    contact_card_remove_from_address_book,
    delete_contact_cards,
    update_contact_card,
)
from suite.mail.tests.base import StalwartIntegrationTestCase, unique_name


class TestMailContacts(StalwartIntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.member = cls.create_member()
        cls.account = cls.personal_account(cls.member)

    def _books(self) -> dict[str, dict]:
        with self.set_user(self.member.email):
            return {b["_name"]: b for b in get_address_books(self.account)}

    def _default_book(self) -> str:
        # With several books present the server may stop flagging any as default;
        # fall back to the first book so later tests stay order-independent.
        books = list(self._books().values())
        return next((b["id"] for b in books if b["default"]), books[0]["id"])

    def test_address_books(self):
        self.assertTrue(any(b["default"] for b in self._books().values()))

        name = unique_name("book")
        with self.set_user(self.member.email):
            book_id = add_address_book(self.account, name, description="Test book")
        self.assertIn(name, self._books())

        renamed = f"{name}-renamed"
        with self.set_user(self.member.email):
            update_address_book(self.account, book_id, renamed)
        self.assertIn(renamed, self._books())
        self.assertNotIn(name, self._books())

        with self.set_user(self.member.email):
            delete_address_books(self.account, [book_id])
        self.assertNotIn(renamed, self._books())

    def test_contact_cards(self):
        default_book = self._default_book()
        contact_name = f"Contact {unique_name('person')}"
        contact_email = f"{unique_name('person')}@elsewhere.example.org"

        with self.set_user(self.member.email):
            card_id = add_contact_card(
                self.account,
                [default_book],
                full_name=contact_name,
                emails=[{"address": contact_email, "type": "Personal"}],
            )

            cards = self.wait_until(
                lambda: (
                    [c for c in get_contact_cards(self.account, {"text": contact_name})["rows"] or []] or None
                ),
                message="Created contact card not found.",
            )
            self.assertEqual(cards[0]["id"], card_id)
            self.assertEqual(cards[0]["full_name"], contact_name)

            contacts = get_contacts(self.account, {"text": contact_name})
            self.assertIn(contact_email, [c["email"] for c in contacts])

            # Rename.
            update_contact_card(
                self.account,
                card_id,
                [default_book],
                full_name=f"{contact_name} Jr",
                emails=[{"address": contact_email, "type": "Personal"}],
            )
            self.wait_until(
                lambda: any(
                    c["full_name"] == f"{contact_name} Jr"
                    for c in get_contact_cards(self.account, {"text": contact_name})["rows"]
                ),
                message="Contact rename did not stick.",
            )

            # Move it through a second address book.
            other_book = add_address_book(self.account, unique_name("book"))
            count_before = get_address_book_contact_count(self.account, other_book)

            contact_card_add_to_address_book(self.account, [card_id], other_book)
            self.wait_until(
                lambda: get_address_book_contact_count(self.account, other_book) == count_before + 1,
                message="Contact did not join the second address book.",
            )
            contact_card_remove_from_address_book(self.account, [card_id], other_book)
            self.wait_until(
                lambda: get_address_book_contact_count(self.account, other_book) == count_before,
                message="Contact did not leave the second address book.",
            )
            contact_card_move_between_address_books(self.account, [card_id], default_book, other_book)
            self.wait_until(
                lambda: get_address_book_contact_count(self.account, other_book) == count_before + 1,
                message="Contact did not move between address books.",
            )

            self.assertIsInstance(get_contacts_from_cache(self.account), list)

            delete_contact_cards(self.account, [card_id])
            self.wait_until(
                lambda: not get_contact_cards(self.account, {"text": contact_name})["rows"],
                message="Deleted contact card still listed.",
            )
            delete_address_books(self.account, [other_book])

    def test_bulk_add_and_move_to(self):
        from suite.mail.doctype.contact_card.contact_card import (
            bulk_add_contact_cards,
            contact_card_move_to_address_book,
        )

        with self.set_user(self.member.email):
            default_book = self._default_book()
            names = [f"Bulk {unique_name('person')}" for _ in range(2)]
            bulk_add_contact_cards(
                self.account,
                [
                    {
                        "address_book_ids": [default_book],
                        "full_name": name,
                        "kind": "individual",
                        "emails": [
                            {"address": f"{unique_name('bulk')}@elsewhere.example.org", "type": "Personal"}
                        ],
                    }
                    for name in names
                ],
            )
            cards = self.wait_until(
                lambda: (
                    [
                        c
                        for c in get_contact_cards(self.account, {"text": "Bulk "})["rows"] or []
                        if c["full_name"] in names
                    ]
                    or None
                ),
                message="Bulk-added contact cards not found.",
            )
            self.assertEqual(len(cards), 2)

            # move_to replaces the card's whole address-book membership.
            target_book = add_address_book(self.account, unique_name("book"))
            contact_card_move_to_address_book(self.account, [c["id"] for c in cards], target_book)
            self.wait_until(
                lambda: get_address_book_contact_count(self.account, target_book) == 2,
                message="move_to did not land the cards in the target book.",
            )

    def test_auto_create_contact_on_send(self):
        with self.set_user(self.member.email):
            doc = frappe.get_doc("JMAP Account", self.account)
            doc.create_contacts_after_email_submit = 1
            doc.save(ignore_permissions=True)

        stranger = f"{unique_name('fresh')}@elsewhere.example.org"
        self.send_mail(self.member, stranger)

        with self.set_user(self.member.email):
            self.wait_until(
                lambda: stranger in [c["email"] for c in get_contacts(self.account, {"email": stranger})],
                message="Sending did not auto-create a contact card for the recipient.",
            )
