"""Contracts for Mail administration actions and detail reads."""

from collections.abc import Callable
from typing import Literal, NotRequired, TypedDict

import frappe

from suite.composition.http import Route, RouteKind
from suite.mail.api import admin
from suite.mail.http.admin import DomainRow
from suite.mail.http.admin_details import (
    AddressRef,
    Domain,
    Group,
    MailingList,
    Member,
    Ownership,
    Verification,
)
from suite.mail.http.auth import AccountOptions


class AddDomainInput(TypedDict):
    name: str
    description: NotRequired[str | None]


class AddGroupInput(TypedDict):
    name: str
    domain: str
    description: NotRequired[str | None]
    members: NotRequired[list[str] | None]
    quota_gb: NotRequired[float | None]
    disable_receiving: NotRequired[bool]


class AddGroupEmailInput(TypedDict):
    group_id: str
    email: str
    description: NotRequired[str | None]


class AddGroupMembersInput(TypedDict):
    group_id: str
    account_ids: list[str]


class AddMailingListInput(TypedDict):
    name: str
    domain: str
    recipients: NotRequired[list[str] | None]
    description: NotRequired[str | None]


class AddMailingListEmailInput(TypedDict):
    list_id: str
    email: str
    description: NotRequired[str | None]


class AddMailingListRecipientsInput(TypedDict):
    list_id: str
    recipients: list[str]


class AddMemberInput(TypedDict):
    username: str
    domain: str
    is_admin: bool
    send_invite: bool
    backup_email: str
    first_name: NotRequired[str | None]
    last_name: NotRequired[str | None]
    password: NotRequired[str | None]
    expires_at: NotRequired[str | None]
    aliases: NotRequired[list[str] | None]
    groups: NotRequired[list[str] | None]
    mailing_lists: NotRequired[list[str] | None]
    quota_gb: NotRequired[float | None]
    locale: NotRequired[str | None]
    time_zone: NotRequired[str | None]
    disable_receiving: NotRequired[bool]


class AddMemberEmailInput(TypedDict):
    member_id: str
    email: str
    description: NotRequired[str | None]


class AddMemberToGroupsInput(TypedDict):
    member_id: str
    group_ids: list[str]


class AddMemberToMailingListsInput(TypedDict):
    member_id: str
    list_ids: list[str]


class ChangeMemberPasswordInput(TypedDict):
    member_id: str
    new_password: str


class DeleteAccountRequestsInput(TypedDict):
    names: list[str]


class DeleteDomainInput(TypedDict):
    domain_id: str


class DeleteGroupsInput(TypedDict):
    ids: list[str]


class DeleteMailingListsInput(TypedDict):
    ids: list[str]


class DeleteMembersInput(TypedDict):
    names: list[str]


class DisableMembersInput(TypedDict):
    names: list[str]


class EnableMembersInput(TypedDict):
    names: list[str]


class GetAccountsInput(TypedDict):
    search: NotRequired[str | None]
    limit: NotRequired[int]


class GetDomainInput(TypedDict):
    domain_id: str


class GetDomainDnsCsvInput(TypedDict):
    domain_id: str


class GetDomainDnsJsonInput(TypedDict):
    domain_id: str


class GetDomainDnsZoneInput(TypedDict):
    domain_id: str


class GetDomainOwnershipRecordInput(TypedDict):
    name: str


class GetGroupInput(TypedDict):
    group_id: str


class GetMailingListInput(TypedDict):
    list_id: str
    start: NotRequired[int]
    limit: NotRequired[int]
    search: NotRequired[str | None]


class GetMemberInput(TypedDict):
    member_id: str


class RemoveGroupEmailInput(TypedDict):
    group_id: str
    email: str


class RemoveGroupMemberInput(TypedDict):
    group_id: str
    account_id: str


class RemoveMailingListEmailInput(TypedDict):
    list_id: str
    email: str


class RemoveMailingListRecipientInput(TypedDict):
    list_id: str
    email: str


class RemoveMemberEmailInput(TypedDict):
    member_id: str
    email: str


class RemoveMemberFromGroupInput(TypedDict):
    member_id: str
    group_id: str


class RemoveMemberFromMailingListInput(TypedDict):
    member_id: str
    list_id: str


class SetDomainEnabledInput(TypedDict):
    domain_id: str
    enabled: bool


class SetGroupEmailEnabledInput(TypedDict):
    group_id: str
    email: str
    enabled: int


class SetGroupReceivingEnabledInput(TypedDict):
    group_id: str
    enabled: bool


class SetMailingListEmailEnabledInput(TypedDict):
    list_id: str
    email: str
    enabled: int


class SetMemberEmailEnabledInput(TypedDict):
    member_id: str
    email: str
    enabled: int


class SetMemberReceivingEnabledInput(TypedDict):
    member_id: str
    enabled: bool


class UpdateDomainInput(TypedDict):
    domain_id: str
    description: NotRequired[str | None]
    catch_all_address: NotRequired[str | None]
    sub_addressing: NotRequired[bool | None]
    allow_relaying: NotRequired[bool | None]


class UpdateGroupInput(TypedDict):
    group_id: str
    description: NotRequired[str | None]
    quota_gb: NotRequired[float | None]


class UpdateMailingListInput(TypedDict):
    list_id: str
    description: NotRequired[str | None]


class UpdateMemberInput(TypedDict):
    member_id: str
    role: NotRequired[str | None]
    description: NotRequired[str | None]
    quota_gb: NotRequired[float | None]
    locale: NotRequired[str | None]
    time_zone: NotRequired[str | None]


class VerifyDomainInput(TypedDict):
    domain_id: str


_OPERATIONS: tuple[tuple[Callable[..., object], RouteKind, str, object, object], ...] = (
    (admin.add_domain, "mutation", "admin.domains.create", AddDomainInput, str),
    (admin.add_group, "mutation", "admin.groups.create", AddGroupInput, str),
    (admin.add_group_email, "mutation", "admin.groups.addEmail", AddGroupEmailInput, type(None)),
    (admin.add_group_members, "mutation", "admin.groups.addMembers", AddGroupMembersInput, type(None)),
    (admin.add_mailing_list, "mutation", "admin.mailingLists.create", AddMailingListInput, str),
    (
        admin.add_mailing_list_email,
        "mutation",
        "admin.mailingLists.addEmail",
        AddMailingListEmailInput,
        type(None),
    ),
    (
        admin.add_mailing_list_recipients,
        "mutation",
        "admin.mailingLists.addRecipients",
        AddMailingListRecipientsInput,
        type(None),
    ),
    (admin.add_member, "mutation", "admin.members.create", AddMemberInput, type(None)),
    (admin.add_member_email, "mutation", "admin.members.addEmail", AddMemberEmailInput, type(None)),
    (
        admin.add_member_to_groups,
        "mutation",
        "admin.groups.addMemberToGroups",
        AddMemberToGroupsInput,
        type(None),
    ),
    (
        admin.add_member_to_mailing_lists,
        "mutation",
        "admin.mailingLists.addMemberToMailingLists",
        AddMemberToMailingListsInput,
        type(None),
    ),
    (
        admin.change_member_password,
        "mutation",
        "admin.members.changePassword",
        ChangeMemberPasswordInput,
        type(None),
    ),
    (
        admin.delete_account_requests,
        "mutation",
        "admin.members.deleteAccountRequests",
        DeleteAccountRequestsInput,
        type(None),
    ),
    (admin.delete_domain, "mutation", "admin.domains.delete", DeleteDomainInput, type(None)),
    (admin.delete_groups, "mutation", "admin.groups.delete", DeleteGroupsInput, type(None)),
    (
        admin.delete_mailing_lists,
        "mutation",
        "admin.mailingLists.delete",
        DeleteMailingListsInput,
        type(None),
    ),
    (admin.delete_members, "mutation", "admin.members.delete", DeleteMembersInput, type(None)),
    (admin.disable_members, "mutation", "admin.members.disable", DisableMembersInput, type(None)),
    (admin.enable_members, "mutation", "admin.members.enable", EnableMembersInput, type(None)),
    (admin.get_account_options, "query", "admin.members.options", None, AccountOptions),
    (admin.get_accounts, "query", "admin.members.accounts", GetAccountsInput, list[AddressRef]),
    (admin.get_domain, "query", "admin.domains.get", GetDomainInput, Domain),
    (admin.get_domain_dns_csv, "query", "admin.domains.dnsCsv", GetDomainDnsCsvInput, str),
    (admin.get_domain_dns_json, "query", "admin.domains.dnsJson", GetDomainDnsJsonInput, str),
    (admin.get_domain_dns_zone, "query", "admin.domains.dnsZone", GetDomainDnsZoneInput, str),
    (
        admin.get_domain_ownership_record,
        "query",
        "admin.domains.ownershipRecord",
        GetDomainOwnershipRecordInput,
        Ownership,
    ),
    (admin.get_enabled_domains, "query", "admin.domains.enabled", None, list[str]),
    (admin.get_group, "query", "admin.groups.get", GetGroupInput, Group),
    (admin.get_mailing_list, "query", "admin.mailingLists.get", GetMailingListInput, MailingList),
    (admin.get_member, "query", "admin.members.get", GetMemberInput, Member),
    (admin.remove_group_email, "mutation", "admin.groups.removeEmail", RemoveGroupEmailInput, type(None)),
    (
        admin.remove_group_member,
        "mutation",
        "admin.groups.removeMember",
        RemoveGroupMemberInput,
        type(None),
    ),
    (
        admin.remove_mailing_list_email,
        "mutation",
        "admin.mailingLists.removeEmail",
        RemoveMailingListEmailInput,
        type(None),
    ),
    (
        admin.remove_mailing_list_recipient,
        "mutation",
        "admin.mailingLists.removeRecipient",
        RemoveMailingListRecipientInput,
        type(None),
    ),
    (
        admin.remove_member_email,
        "mutation",
        "admin.members.removeEmail",
        RemoveMemberEmailInput,
        type(None),
    ),
    (
        admin.remove_member_from_group,
        "mutation",
        "admin.groups.removeMemberFromGroup",
        RemoveMemberFromGroupInput,
        type(None),
    ),
    (
        admin.remove_member_from_mailing_list,
        "mutation",
        "admin.mailingLists.removeMemberFromMailingList",
        RemoveMemberFromMailingListInput,
        type(None),
    ),
    (admin.set_domain_enabled, "mutation", "admin.domains.setEnabled", SetDomainEnabledInput, DomainRow),
    (
        admin.set_group_email_enabled,
        "mutation",
        "admin.groups.setEmailEnabled",
        SetGroupEmailEnabledInput,
        type(None),
    ),
    (
        admin.set_group_receiving_enabled,
        "mutation",
        "admin.groups.setReceivingEnabled",
        SetGroupReceivingEnabledInput,
        type(None),
    ),
    (
        admin.set_mailing_list_email_enabled,
        "mutation",
        "admin.mailingLists.setEmailEnabled",
        SetMailingListEmailEnabledInput,
        type(None),
    ),
    (
        admin.set_member_email_enabled,
        "mutation",
        "admin.members.setEmailEnabled",
        SetMemberEmailEnabledInput,
        type(None),
    ),
    (
        admin.set_member_receiving_enabled,
        "mutation",
        "admin.members.setReceivingEnabled",
        SetMemberReceivingEnabledInput,
        type(None),
    ),
    (admin.update_domain, "mutation", "admin.domains.update", UpdateDomainInput, DomainRow | Domain),
    (admin.update_group, "mutation", "admin.groups.update", UpdateGroupInput, type(None)),
    (
        admin.update_mailing_list,
        "mutation",
        "admin.mailingLists.update",
        UpdateMailingListInput,
        type(None),
    ),
    (admin.update_member, "mutation", "admin.members.update", UpdateMemberInput, type(None)),
    (admin.verify_domain, "mutation", "admin.domains.verify", VerifyDomainInput, Verification),
)


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        f"/api/method/suite.mail.api.admin.{handler.__name__}",
        handler.__name__,
        kind=kind,
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for handler, kind, public_name, body, output in _OPERATIONS
)
