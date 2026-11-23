"""Typed responses for delivery reports and the administration overview."""

from typing import NotRequired, TypedDict

import frappe

from suite.composition.http import Route
from suite.mail.api import admin
from suite.mail.http.admin import DmarcRow, TlsRow


class ReportInput(TypedDict):
    report_id: str


class SummaryInput(TypedDict, total=False):
    domain_id: str | None
    days: int


class DmarcTotals(TypedDict):
    reports: int
    messages: int
    passed: int
    failed: int
    dkim_passed: int
    spf_passed: int
    pass_rate: int | None


class DmarcDomain(DmarcTotals):
    domain: str | None


class DmarcSource(DmarcTotals):
    source_ip: str | None


class DmarcReporter(DmarcTotals):
    reporter: str | None


class DmarcSummary(TypedDict):
    since: str | None
    until: str | None
    totals: DmarcTotals
    domains: list[DmarcDomain]
    sources: list[DmarcSource]
    reporters: list[DmarcReporter]


class AuthenticationResult(TypedDict, total=False):
    domain: str
    selector: str
    scope: str
    result: str


class DmarcRecord(TypedDict):
    source_ip: str | None
    count: int
    disposition: str | None
    dkim: str | None
    spf: str | None
    header_from: str | None
    envelope_from: str | None
    envelope_to: str | None
    override_reasons: str | None
    dkim_results: list[AuthenticationResult]
    spf_results: list[AuthenticationResult]


class DmarcReport(DmarcRow):
    records: list[DmarcRecord]


class TlsTotals(TypedDict):
    reports: int
    sessions: int
    successful: int
    failed: int
    success_rate: int | None


class TlsDomain(TlsTotals):
    domain: str | None


class TlsReporter(TlsTotals):
    reporter: str | None


class FailureType(TypedDict):
    result_type: str | None
    reports: int
    failed: int


class TlsSummary(TypedDict):
    since: str | None
    until: str | None
    totals: TlsTotals
    domains: list[TlsDomain]
    reporters: list[TlsReporter]
    failures: list[FailureType]


class TlsPolicy(TypedDict):
    policy_type: str | None
    policy_domain: str | None
    mx_hosts: list[str]
    policy_strings: list[str]
    successful: int
    failed: int


class TlsFailure(TypedDict):
    result_type: str | None
    count: int
    policy_type: str | None
    policy_domain: str | None
    sending_mta_ip: str | None
    receiving_mx_hostname: str | None
    receiving_mx_helo: str | None
    receiving_ip: str | None
    failure_reason_code: str | None
    additional_information: str | None


class TlsReport(TlsRow):
    policies: list[TlsPolicy]
    failures: list[TlsFailure]


CONTRACT_ROUTES = tuple(
    Route(
        "POST",
        f"/api/method/suite.mail.api.admin.{handler.__name__}",
        handler.__name__,
        kind="query",
        public_name=public_name,
        body=body,
        output=output,
        envelope="message",
        errors=(frappe.PermissionError, frappe.ValidationError),
    )
    for handler, public_name, body, output in (
        (admin.get_dmarc_report, "admin.dmarc.get", ReportInput, DmarcReport),
        (admin.get_dmarc_summary, "admin.dmarc.summary", SummaryInput, DmarcSummary),
        (admin.get_tls_report, "admin.tls.get", ReportInput, TlsReport),
        (admin.get_tls_summary, "admin.tls.summary", SummaryInput, TlsSummary),
    )
)
