"""Contracts for Mail's paged administration readers."""

from typing import Literal, NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.mail.api import admin
from suite.mail.http.shapes import Flag


class PageInput(TypedDict):
    start: NotRequired[int]
    page_length: NotRequired[int]


class SearchPage(PageInput):
    search: NotRequired[str | None]


class DomainPageInput(PageInput):
    txt: NotRequired[str | None]
    status: NotRequired[Literal["Active", "Pending Verification", "Disabled"] | None]


class MemberPageInput(SearchPage):
    is_admin: NotRequired[bool | None]
    is_enabled: NotRequired[bool | None]


class InvitePageInput(SearchPage):
    status: NotRequired[Literal["All", "Pending", "Accepted", "Expired"]]


class RecipientPageInput(SearchPage):
    list_id: str


class ReportPageInput(PageInput):
    txt: NotRequired[str | None]
    domain_id: NotRequired[str | None]
    days: NotRequired[int]


class DomainRow(TypedDict):
    id: str
    name: str
    description: str
    status: Literal["Active", "Pending Verification", "Disabled"]
    is_enabled: bool
    catch_all_address: str
    sub_addressing: bool
    allow_relaying: bool
    is_verified: bool
    last_verified_at: str | None
    created_at: str | None


class MemberRow(TypedDict):
    name: str
    full_name: str
    user_image: str
    last_active: str | None
    enabled: bool
    account: str | None
    is_admin: bool
    quota_gb: float | None
    used_bytes: int | None


class InviteRow(TypedDict):
    name: str
    account: str
    is_admin: Flag
    backup_email: str | None
    invited_by: str
    is_verified: Flag
    status: Literal["Pending", "Accepted", "Expired"]


class GroupRow(TypedDict):
    id: str
    name: str
    email: str
    description: str | None
    quota_gb: float
    used_bytes: int | None
    created_at: str | None


class MailingListRow(TypedDict):
    id: str
    name: str
    email: str
    description: str | None
    recipient_count: int


class RecipientRow(TypedDict):
    email: str
    enabled: bool


class ReportRow(TypedDict):
    id: str
    domain: str | None
    reporter: str | None
    reporter_email: str | None
    report_id: str | None
    subject: str | None
    to: list[str]
    date_range_begin: str | None
    date_range_end: str | None
    received_at: str | None
    reports: int


class DmarcPolicy(TypedDict, total=False):
    domain: str
    testing_mode: bool
    adkim: str | None
    aspf: str | None
    p: str | None
    sp: str | None
    pct: int
    fo: str


class DmarcRow(ReportRow):
    version: float | None
    policy: DmarcPolicy
    errors: str | None
    pass_rate: int | None
    messages: int
    passed: int
    failed: int
    dkim_passed: int
    spf_passed: int


class TlsRow(ReportRow):
    contact_info: str | None
    policy_types: list[str]
    successful: int
    failed: int
    sessions: int
    success_rate: int | None


class DomainPage(TypedDict):
    items: list[DomainRow]
    total: int


class MemberPage(TypedDict):
    items: list[MemberRow]
    total: int


class InvitePage(TypedDict):
    items: list[InviteRow]
    total: int


class GroupPage(TypedDict):
    items: list[GroupRow]
    total: int


class MailingListPage(TypedDict):
    items: list[MailingListRow]
    total: int


class RecipientPage(TypedDict):
    items: list[RecipientRow]
    total: int


class DmarcPage(TypedDict):
    items: list[DmarcRow]
    total: int


class TlsPage(TypedDict):
    items: list[TlsRow]
    total: int


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        f"/api/method/suite.mail.api.admin.{handler.__name__}",
        handler.__name__,
        id=handler.__name__,
        kind="query",
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        page={"offset": "start", "rows": "items", "total": "total"},
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for handler, public_name, body, output in (
        (admin.get_domains, "admin.domains.list", DomainPageInput, DomainPage),
        (admin.get_members, "admin.members.list", MemberPageInput, MemberPage),
        (admin.get_account_requests, "admin.invites.list", InvitePageInput, InvitePage),
        (admin.get_groups, "admin.groups.list", SearchPage, GroupPage),
        (admin.get_mailing_lists, "admin.mailingLists.list", SearchPage, MailingListPage),
        (admin.get_mailing_list_recipients, "admin.recipients.list", RecipientPageInput, RecipientPage),
        (admin.get_dmarc_reports, "admin.dmarc.list", ReportPageInput, DmarcPage),
        (admin.get_tls_reports, "admin.tls.list", ReportPageInput, TlsPage),
    )
)
