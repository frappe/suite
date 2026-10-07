"""Self-service User preferences with normal document validation."""

from typing import Literal, TypedDict, cast

import frappe
from frappe import _


class Preferences(TypedDict):
    name: str
    email: str
    first_name: str | None
    last_name: str | None
    user_image: str | None
    language: str | None
    time_zone: str | None
    desk_theme: str | None


class PreferenceChanges(TypedDict, total=False):
    first_name: str
    last_name: str
    user_image: str | None
    language: str
    time_zone: str


class ThemeChange(TypedDict):
    theme: Literal["Light", "Dark", "Automatic"]


class Language(TypedDict):
    name: str
    language_name: str


@frappe.whitelist(methods=["GET"])
def get_preferences() -> Preferences:
    doc = frappe.get_doc("User", frappe.session.user)
    doc.check_permission("read")
    return cast(Preferences, {field: doc.get(field) for field in Preferences.__annotations__})


@frappe.whitelist(methods=["PATCH"])
def update_preferences(**changes: object) -> Preferences:
    allowed = PreferenceChanges.__annotations__
    if not changes or any(
        field not in allowed or not (isinstance(value, str) or (field == "user_image" and value is None))
        for field, value in changes.items()
    ):
        frappe.throw(_("Invalid preference field"), frappe.ValidationError)
    doc = frappe.get_doc("User", frappe.session.user)
    doc.check_permission("write")
    doc.update(changes)
    doc.save()
    return get_preferences()


@frappe.whitelist(methods=["GET"])
def languages() -> list[Language]:
    return frappe.get_list(
        "Language",
        filters={"enabled": 1},
        fields=["name", "language_name"],
        order_by="language_name asc",
        limit_page_length=0,
    )
