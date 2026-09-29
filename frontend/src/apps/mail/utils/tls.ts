// What the TLS report pages share: the shapes Suite's admin API answers and how a result reads.

export type TlsTotals = {
	reports: number
	sessions: number
	successful: number
	failed: number
	success_rate: number | null
}

export type TlsReportRow = TlsTotals & {
	id: string
	domain: string
	reporter: string
	reporter_email?: string | null
	contact_info?: string | null
	report_id?: string | null
	subject?: string | null
	to?: string[]
	date_range_begin?: string | null
	date_range_end?: string | null
	received_at?: string | null
	policy_types: string[]
}

export type TlsPolicy = {
	policy_type?: string | null
	policy_domain?: string | null
	mx_hosts: string[]
	policy_strings: string[]
	successful: number
	failed: number
}

export type TlsFailure = {
	result_type?: string | null
	count: number
	policy_type?: string | null
	policy_domain?: string | null
	sending_mta_ip?: string | null
	receiving_mx_hostname?: string | null
	receiving_mx_helo?: string | null
	receiving_ip?: string | null
	failure_reason_code?: string | null
	additional_information?: string | null
}

export type TlsFailureType = { result_type: string; reports: number; failed: number }

export type TlsSummary = {
	since: string | null
	until: string
	totals: TlsTotals
	domains: (TlsTotals & { domain: string })[]
	reporters: (TlsTotals & { reporter: string })[]
	failures: TlsFailureType[]
}

// The result types RFC 8460 defines, in the words an admin would look for.
const RESULT_TYPES: Record<string, string> = {
	'starttls-not-supported': __('STARTTLS not offered'),
	'certificate-host-mismatch': __('Certificate name mismatch'),
	'certificate-expired': __('Certificate expired'),
	'certificate-not-trusted': __('Certificate not trusted'),
	'validation-failure': __('Validation failure'),
	'tlsa-invalid': __('Invalid TLSA record'),
	'dnssec-invalid': __('DNSSEC validation failed'),
	'dane-required': __('DANE required but missing'),
	'sts-policy-fetch-error': __('MTA-STS policy unreachable'),
	'sts-policy-invalid': __('Invalid MTA-STS policy'),
	'sts-webpki-invalid': __('MTA-STS certificate invalid'),
}

const POLICY_TYPES: Record<string, string> = {
	sts: __('MTA-STS'),
	tlsa: __('DANE'),
	'no-policy-found': __('No policy'),
}

// A value a newer reporter or Stalwart introduced reads as it came.
export const resultTypeLabel = (type?: string | null) => (type && RESULT_TYPES[type]) || type || __('Other')

export const policyTypeLabel = (type?: string | null) => (type && POLICY_TYPES[type]) || type || __('Other')
