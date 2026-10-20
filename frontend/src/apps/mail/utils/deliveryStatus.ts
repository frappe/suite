// The slice of a bounce report the DSN banner reads; the shape comes from the backend's
// parse_delivery_status (RFC 3464 fields, type prefixes already stripped).
export interface DsnRecipient {
  email: string
  action: string
  status: string
  diagnostic_code: string
  // The Diagnostic-Code, or else what the bounce's text says about this recipient.
  reason: string
  remote_mta: string
  will_retry_until: string
}

export interface DeliveryStatusReport {
  reporting_mta: string
  arrival_date: string
  original_envelope_id: string
  recipients: DsnRecipient[]
  // The sent message the report is about, when this site sent it.
  sent_thread_id: string | null
  submission_id: string | null
}

// The worst outcome names the card: one hard-failed recipient makes it a failure notice even
// when others were merely delayed or delivered.
const ACTION_PRIORITY = ['failed', 'delayed', 'delivered']

export const overallDsnAction = (recipients: DsnRecipient[]): string => {
  for (const action of ACTION_PRIORITY)
    if (recipients.some((recipient) => recipient.action === action)) return action
  return recipients[0]?.action || ''
}

// Why delivery failed — the diagnostic, or the reason the bounce's text gives, otherwise the
// bare enhanced status code (e.g. "5.1.1") so the card never shows an empty response box.
export const serverResponse = (recipient: DsnRecipient): string =>
  recipient.reason || recipient.status
