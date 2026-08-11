// The slice of a bounce report the DSN banner reads; the shape comes from the backend's
// parse_delivery_status (RFC 3464 fields, type prefixes already stripped).
export interface DsnRecipient {
	email: string
	action: string
	status: string
	diagnostic_code: string
	remote_mta: string
	will_retry_until: string
}

export interface DeliveryStatusReport {
	reporting_mta: string
	arrival_date: string
	recipients: DsnRecipient[]
}

// The worst outcome names the card: one hard-failed recipient makes it a failure notice even
// when others were merely delayed or delivered.
const ACTION_PRIORITY = ['failed', 'delayed', 'delivered']

export const overallDsnAction = (recipients: DsnRecipient[]): string => {
	for (const action of ACTION_PRIORITY)
		if (recipients.some((recipient) => recipient.action === action)) return action
	return recipients[0]?.action || ''
}

// What the remote server said — the diagnostic when the MTA relayed one, otherwise the bare
// enhanced status code (e.g. "5.1.1") so the card never shows an empty response box.
export const serverResponse = (recipient: DsnRecipient): string =>
	recipient.diagnostic_code || recipient.status
