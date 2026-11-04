import type { api, OutputOf } from '@/api'

// What the TLS report pages share: the shapes Suite's admin API answers and how a result reads.

export type TlsTotals = OutputOf<typeof api.mail.admin.tls.summary>['totals']
export type TlsReportRow = OutputOf<typeof api.mail.admin.tls.list>['items'][number]
export type TlsSummary = OutputOf<typeof api.mail.admin.tls.summary>
export type TlsPolicy = OutputOf<typeof api.mail.admin.tls.get>['policies'][number]
export type TlsFailure = OutputOf<typeof api.mail.admin.tls.get>['failures'][number]
export type TlsFailureType = OutputOf<typeof api.mail.admin.tls.summary>['failures'][number]

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
export const resultTypeLabel = (type?: string | null) =>
  (type && RESULT_TYPES[type]) || type || __('Other')

export const policyTypeLabel = (type?: string | null) =>
  (type && POLICY_TYPES[type]) || type || __('Other')
