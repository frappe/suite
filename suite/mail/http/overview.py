"""The nullable sections of the administration overview."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.mail.api.admin import get_overview
from suite.mail.http.shapes import Flag


class MemberCount(TypedDict):
    total: int
    disabled: int


class InviteCount(TypedDict):
    pending: int
    expiring_soon: int
    expired: int


class Limits(TypedDict, total=False):
    max_domains: int
    max_accounts: int
    max_groups: int
    max_mailing_lists: int
    max_disk_gb: float
    default_disk_quota_gb: float


class Storage(TypedDict):
    allocated_gb: float | None
    max_gb: float | None
    default_quota_gb: float | None


class Site(TypedDict):
    site: str | None
    title: str | None
    status: str | None
    cluster: str | None
    mail_hostname: str | None
    jmap_url: str | None
    contact_email: str | None


class AttentionDomain(TypedDict):
    name: str
    status: str
    last_verified_at: str | None


class DisabledAccount(TypedDict):
    name: str
    full_name: str


class RecentAccount(DisabledAccount):
    user_image: str
    enabled: bool
    joined_on: str | None


class Workspace(TypedDict):
    name: str | None
    logo: str | None


class Overview(TypedDict):
    members: MemberCount | None
    pending_invites: int | None
    domains: int | None
    groups: int | None
    mailing_lists: int | None
    limits: Limits | None
    storage: NotRequired[Storage]
    site: NotRequired[Site]
    domains_needing_attention: NotRequired[list[AttentionDomain]]
    invites: NotRequired[InviteCount]
    recent_accounts: NotRequired[list[RecentAccount]]
    disabled_accounts: NotRequired[list[DisabledAccount]]
    workspace: NotRequired[Workspace]


CONTRACT_ROUTES = (
    Route(
        "POST",
        "/api/method/suite.mail.api.admin.get_overview",
        "get_overview",
        kind="query",
        public_name="admin.overview.get",
        output=Overview,
        envelope="message",
        errors=(frappe.PermissionError,),
    ),
)
