"""The six Northwind people: the one place their names and addresses are written."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

import frappe

DOMAIN = "northwind.test"


@dataclass(frozen=True)
class Person:
    first: str
    last: str
    team: str
    job: str
    admin: bool = False

    @property
    def key(self) -> str:
        return self.first.lower()

    @property
    def name(self) -> str:
        return f"{self.first} {self.last}"

    @property
    def email(self) -> str:
        return f"{self.key}@{DOMAIN}"


PEOPLE = (
    Person("Maya", "Chen", "Product", "Product lead / Suite Admin", admin=True),
    Person("Leo", "Park", "Design", "Product designer"),
    Person("Arjun", "Rao", "Engineering", "Engineering lead"),
    Person("Nisha", "Patel", "Engineering", "Software engineer"),
    Person("Theo", "Williams", "Marketing", "Growth lead"),
    Person("Sofia", "Martinez", "Finance", "Finance and operations"),
)
PEOPLE_BY_KEY = {person.key: person for person in PEOPLE}
EVERYONE = tuple(PEOPLE_BY_KEY)


def email_of(key: str) -> str:
    return PEOPLE_BY_KEY[key].email


@contextmanager
def acting_as(user: str) -> Iterator[None]:
    """Run the block as `user`, then hand the session back to whoever held it."""
    previous = frappe.session.user
    frappe.set_user(user)
    try:
        yield
    finally:
        frappe.set_user(previous)
