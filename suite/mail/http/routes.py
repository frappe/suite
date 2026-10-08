"""REST adapters for Mail rail state."""

from typing import TypedDict

import frappe
from frappe import _

from suite.composition.http import Route
from suite.mail.api.account import (
    create_contacts_export,
    create_contacts_import,
    create_mail_export,
    create_mail_import,
    get_calendar_client_config,
    get_identities,
    get_mail_client_config,
    get_participant_identities,
    get_quota,
    get_user_info,
    set_signature,
)
from suite.mail.api.admin import (
    add_domain,
    add_group,
    add_group_email,
    add_group_members,
    add_mailing_list,
    add_mailing_list_email,
    add_mailing_list_recipients,
    add_member,
    add_member_email,
    add_member_to_groups,
    add_member_to_mailing_lists,
    change_member_password,
    delete_account_requests,
    delete_domain,
    delete_groups,
    delete_mailing_lists,
    delete_members,
    disable_members,
    enable_members,
    get_account_options,
    get_account_requests,
    get_accounts,
    get_dmarc_report,
    get_dmarc_reports,
    get_dmarc_summary,
    get_domain,
    get_domain_dns_csv,
    get_domain_dns_json,
    get_domain_dns_zone,
    get_domain_ownership_record,
    get_domains,
    get_enabled_domains,
    get_group,
    get_groups,
    get_mailing_list,
    get_mailing_list_recipients,
    get_mailing_lists,
    get_member,
    get_members,
    get_overview,
    get_tls_report,
    get_tls_reports,
    get_tls_summary,
    remove_group_email,
    remove_group_member,
    remove_mailing_list_email,
    remove_mailing_list_recipient,
    remove_member_email,
    remove_member_from_group,
    remove_member_from_mailing_list,
    set_domain_enabled,
    set_group_email_enabled,
    set_group_receiving_enabled,
    set_mailing_list_email_enabled,
    set_member_email_enabled,
    set_member_receiving_enabled,
    update_domain,
    update_group,
    update_mailing_list,
    update_member,
    verify_domain,
)
from suite.mail.api.contacts import (
    get_address_book_contact_count,
    get_address_books,
    get_contact_cards,
    get_contacts,
)
from suite.mail.api.mail import (
    add_mails_to_mailbox,
    allow_screening_senders,
    block_senders,
    create_mail,
    create_mailbox,
    delete_mail,
    delete_mailbox,
    empty_user_mailbox,
    fetch_attachment,
    fetch_attachments_as_zip,
    fetch_mail_as_eml,
    get_all_inbox_unread_count,
    get_delivery_status,
    get_email_suggestions,
    get_global_screened_addresses,
    get_mailboxes,
    get_mime_message,
    get_screened_addresses,
    get_thread,
    get_threads,
    get_unified_folders,
    get_unified_threads,
    junk_senders_inbox_mail,
    move_mails,
    remove_mails_from_mailbox,
    screen_email_address,
    screen_email_addresses,
    screen_out_senders,
    search_mails,
    set_flagged,
    set_mails_mailboxes,
    set_mails_seen,
    set_mails_spam_status,
    undo_screening_verdict,
    unscreen_email_addresses,
    update_draft_mail,
    update_mailbox,
)
from suite.mail.api.scheduled import (
    cancel_scheduled_mail,
    dismiss_failed_mail,
    get_scheduled_mail,
    get_submissions,
    reschedule_mail,
    retry_failed_mail,
    send_scheduled_mail_now,
)
from suite.mail.api.sieve import (
    create_automation_script,
    create_sieve_script,
    delete_sieve_script,
    get_sieve_scripts,
    rebuild_automation_script_for_account,
    update_sieve_script,
)
from suite.mail.doctype.address_book.address_book import add_address_book, delete_address_books
from suite.mail.doctype.contact_card.contact_card import (
    add_contact_card,
    contact_card_add_to_address_book,
    contact_card_remove_from_address_book,
    delete_contact_cards,
)
from suite.mail.doctype.vacation_response.vacation_response import (
    get_vacation_response,
    update_vacation_response,
)
from suite.mail.http.admin import CONTRACT_ROUTES as ADMIN_CONTRACT_ROUTES
from suite.mail.http.admin_actions import CONTRACT_ROUTES as ADMIN_ACTION_CONTRACT_ROUTES
from suite.mail.http.auth import CONTRACT_ROUTES as AUTH_CONTRACT_ROUTES
from suite.mail.http.auth import (
    create_account,
    get_account_request,
    get_account_setup_options,
    get_branding,
    get_signup_domains,
    get_signup_settings,
    get_user_for_reset_password_key,
    resend_otp,
    send_reset_password_link,
    signup,
    validate_email_assigned,
    verify_otp,
)
from suite.mail.http.calendar import CONTRACT_ROUTES as CALENDAR_CONTRACT_ROUTES
from suite.mail.http.calendar import (
    add_participant_identity,
    bulk_delete,
    create_calendar_export,
    create_calendar_import,
    get_value,
    update_participant_identity,
)
from suite.mail.http.contacts import CONTRACT_ROUTES as CONTACT_CONTRACT_ROUTES
from suite.mail.http.contacts import ROUTES as CONTACT_ROUTES
from suite.mail.http.contacts import book, contact, update_book, update_contact
from suite.mail.http.exchanges import CONTRACT_ROUTES as EXCHANGE_CONTRACT_ROUTES
from suite.mail.http.exchanges import ROUTES as EXCHANGE_ROUTES
from suite.mail.http.exchanges import exchange, exchange_attachment, exchange_list
from suite.mail.http.identities import CONTRACT_ROUTES as IDENTITY_CONTRACT_ROUTES
from suite.mail.http.identities import ROUTES as IDENTITY_ROUTES
from suite.mail.http.identities import (
    add_identity,
    create_signature,
    delete_identity_names,
    delete_signature,
    save_identity,
    signatures,
    update_signature,
)
from suite.mail.http.invites import ROUTES as INVITE_ROUTES
from suite.mail.http.invites import invite, send_invite, update_invite
from suite.mail.http.messages import CONTRACT_ROUTES as MESSAGE_CONTRACT_ROUTES
from suite.mail.http.messages import delete_messages
from suite.mail.http.overview import CONTRACT_ROUTES as OVERVIEW_CONTRACT_ROUTES
from suite.mail.http.preferences import ROUTES as PREFERENCE_ROUTES
from suite.mail.http.preferences import (
    account_preferences,
    credentials,
    subscribe_mailbox,
    update_account_preferences,
    update_credentials,
    update_preferences,
)
from suite.mail.http.push import CONTRACT_ROUTES as PUSH_CONTRACT_ROUTES
from suite.mail.http.push import (
    add_push_subscription,
    delete_push_subscriptions,
    fetch_push_subscriptions,
    renew_push_subscription,
)
from suite.mail.http.reports import CONTRACT_ROUTES as REPORT_CONTRACT_ROUTES
from suite.mail.http.settings import CONTRACT_ROUTES as SETTINGS_CONTRACT_ROUTES
from suite.mail.http.shapes import (
    AccountInput,
    AddressBook,
    AttachmentBytesInput,
    AttachmentsZipInput,
    CalendarClientConfig,
    EmailSuggestion,
    EmailSuggestionsInput,
    Identity,
    Mailbox,
    ParticipantIdentity,
    ScreenAddresses,
    ScreenedAddress,
    SieveScript,
    UnifiedFolder,
    UnscreenAddresses,
    UserInfo,
)


class InboxSummary(TypedDict):
    unread: int


ROUTES: tuple[Route, ...] = (
    Route(
        "GET",
        "inbox-summary",
        "inbox_summary",
        output=InboxSummary,
        kind="query",
        public_name="inbox.summary",
    ),
)


@frappe.whitelist(methods=["GET"])
def inbox_summary() -> InboxSummary:
    return {"unread": get_all_inbox_unread_count()}


@frappe.whitelist(allow_guest=True, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
def unknown() -> None:
    raise frappe.DoesNotExistError(_("That Mail address does not exist"))


CONTRACT_ROUTES: tuple[Route, ...] = (
    Route(
        "POST",
        "/api/method/suite.mail.api.account.get_user_info",
        "get_user_info",
        id="get_user_info",
        kind="query",
        public_name="account.get",
        envelope="message",
        output=UserInfo | None,
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_all_inbox_unread_count",
        "get_all_inbox_unread_count",
        id="get_all_inbox_unread_count",
        kind="query",
        public_name="inbox.unreadCount",
        envelope="message",
        output=int,
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_unified_folders",
        "get_unified_folders",
        id="get_unified_folders",
        kind="query",
        public_name="unified.folders",
        envelope="message",
        output=list[UnifiedFolder],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_mailboxes",
        "get_mailboxes",
        id="get_mailboxes",
        kind="query",
        public_name="mailboxes.list",
        envelope="message",
        body=AccountInput,
        output=list[Mailbox],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.account.get_identities",
        "get_identities",
        id="get_identities",
        kind="query",
        public_name="identities.list",
        envelope="message",
        body=AccountInput,
        output=list[Identity],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.account.get_participant_identities",
        "get_participant_identities",
        id="get_participant_identities",
        kind="query",
        public_name="participantIdentities.list",
        envelope="message",
        body=AccountInput,
        output=list[ParticipantIdentity],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.contacts.get_address_books",
        "get_address_books",
        id="get_address_books",
        kind="query",
        public_name="addressBooks.list",
        envelope="message",
        body=AccountInput,
        output=list[AddressBook],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_screened_addresses",
        "get_screened_addresses",
        id="get_screened_addresses",
        kind="query",
        public_name="screening.list",
        envelope="message",
        body=AccountInput,
        output=list[ScreenedAddress],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_global_screened_addresses",
        "get_global_screened_addresses",
        id="get_global_screened_addresses",
        kind="query",
        public_name="screening.global",
        envelope="message",
        output=list[ScreenedAddress],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.sieve.get_sieve_scripts",
        "get_sieve_scripts",
        id="get_sieve_scripts",
        kind="query",
        public_name="sieve.list",
        envelope="message",
        body=AccountInput,
        output=list[SieveScript],
        errors=(
            frappe.PermissionError,
            frappe.AuthenticationError,
        ),
    ),
)

CONTRACT_ROUTES += ADMIN_CONTRACT_ROUTES

CONTRACT_ROUTES += (
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.screen_email_addresses",
        "screen_email_addresses",
        kind="mutation",
        public_name="screening.set",
        body=ScreenAddresses,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.unscreen_email_addresses",
        "unscreen_email_addresses",
        kind="mutation",
        public_name="screening.remove",
        body=UnscreenAddresses,
        output=type(None),
        envelope="message",
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
)

CONTRACT_ROUTES += (
    Route(
        "POST",
        "/api/method/suite.mail.api.account.get_calendar_client_config",
        "get_calendar_client_config",
        kind="query",
        public_name="calendar.clientConfig",
        output=CalendarClientConfig,
        envelope="message",
        errors=(frappe.PermissionError,),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.get_email_suggestions",
        "get_email_suggestions",
        kind="query",
        public_name="contacts.suggest",
        body=EmailSuggestionsInput,
        output=list[EmailSuggestion],
        envelope="message",
        errors=(frappe.PermissionError,),
    ),
)

CONTRACT_ROUTES += CALENDAR_CONTRACT_ROUTES

CONTRACT_ROUTES += AUTH_CONTRACT_ROUTES

CONTRACT_ROUTES += (
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.fetch_attachment",
        "fetch_attachment",
        kind="query",
        public_name="attachments.download",
        body=AttachmentBytesInput,
        response_bytes=True,
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
    Route(
        "POST",
        "/api/method/suite.mail.api.mail.fetch_attachments_as_zip",
        "fetch_attachments_as_zip",
        kind="query",
        public_name="attachments.zip",
        body=AttachmentsZipInput,
        response_bytes=True,
        errors=(
            frappe.PermissionError,
            frappe.ValidationError,
        ),
    ),
)


CONTRACT_ROUTES += SETTINGS_CONTRACT_ROUTES


ROUTES += EXCHANGE_ROUTES
CONTRACT_ROUTES += EXCHANGE_CONTRACT_ROUTES


ROUTES += PREFERENCE_ROUTES


CONTRACT_ROUTES += ADMIN_ACTION_CONTRACT_ROUTES


ROUTES += IDENTITY_ROUTES
CONTRACT_ROUTES += IDENTITY_CONTRACT_ROUTES


CONTRACT_ROUTES += REPORT_CONTRACT_ROUTES + OVERVIEW_CONTRACT_ROUTES


ROUTES += INVITE_ROUTES


ROUTES += CONTACT_ROUTES
CONTRACT_ROUTES += CONTACT_CONTRACT_ROUTES


CONTRACT_ROUTES += MESSAGE_CONTRACT_ROUTES


CONTRACT_ROUTES += PUSH_CONTRACT_ROUTES
