// Shared shapes and display helpers for EmailSubmission rows — the Outbox list and the
// submission details page render the same server-derived state.

import type { Component } from 'vue'
import { CalendarClock, Mail, RefreshCw, SendHorizontal, X } from 'lucide-vue-next'

// The submission's merged delivery state, worst recipient wins: 'queued' is a released
// delivery the MTA hasn't concluded yet, 'retrying' one that failed temporarily and waits
// for its next attempt, 'sent' relayed with no delivery confirmation, 'displayed' one whose
// read receipt (MDN) arrived.
export type SubmissionStatus =
	| 'scheduled'
	| 'queued'
	| 'retrying'
	| 'failed'
	| 'delivered'
	| 'displayed'
	| 'sent'
	| 'cancelled'

export type RecipientState = {
	email: string
	status: SubmissionStatus
	reason?: string
	// The raw JMAP DeliveryStatus for this recipient.
	smtp_reply?: string
	delivered?: 'queued' | 'yes' | 'no' | 'unknown'
	displayed?: 'unknown' | 'yes'
	retries?: number | null
	next_retry?: string
}

// One row per EmailSubmission — the server is the source of truth, so emails submitted by
// other clients appear too. `id` is the submission id every action is keyed on.
// `email_deleted` marks a submission whose Email was deleted after scheduling: it cannot be
// resubmitted, and its recipients come from the SMTP envelope.
export type Submission = {
	id: string
	email_id?: string
	thread_id?: string
	subject?: string
	from_name?: string
	from_email?: string
	recipients: { type: string; email: string; display_name?: string }[]
	recipients_status: RecipientState[]
	send_at: string
	// 'pending' means the delivery can still be cancelled — true for an unreleased hold AND
	// for a released message the MTA is still working on.
	undo_status: string
	status: SubmissionStatus
	retries: number | null
	delivery_errors: { email: string; reason: string }[]
	email_deleted: boolean
}

export type SubmissionDetails = Submission & {
	identity_email?: string
	envelope_from?: string
	envelope_recipients: string[]
	priority: number
	next_retry?: string
	dsn_count: number
	mdn_count: number
}

// The RFC 8621 §7.3 EmailSubmission/query filters the Outbox browses with. undoStatus is
// always applied (the status tabs have no "all" state); for the rest an empty string means
// "not filtering on this". after/before hold local calendar days from date inputs.
export type SubmissionFilters = {
	undoStatus: 'pending' | 'final' | 'canceled'
	identityId: string
	emailId: string
	threadId: string
	after: string
	before: string
}

export const emptySubmissionFilters = (): SubmissionFilters => ({
	undoStatus: 'pending',
	identityId: '',
	emailId: '',
	threadId: '',
	after: '',
	before: '',
})

/** How many optional filters are set — undoStatus doesn't count, it always has a value. */
export const activeSubmissionFilterCount = (filters: SubmissionFilters) =>
	[filters.identityId, filters.emailId, filters.threadId, filters.after, filters.before].filter(
		Boolean,
	).length

export const statusLabel = (status: SubmissionStatus | string) =>
	({
		scheduled: __('Scheduled'),
		queued: __('Sending'),
		retrying: __('Retrying'),
		failed: __('Failed'),
		delivered: __('Delivered'),
		displayed: __('Read'),
		sent: __('Sent'),
		cancelled: __('Cancelled'),
	})[status] || status

export const statusTheme = (status: SubmissionStatus | string) => {
	if (status === 'failed') return 'red'
	if (status === 'retrying') return 'amber'
	if (status === 'scheduled' || status === 'queued') return 'blue'
	if (status === 'delivered' || status === 'displayed') return 'green'
	return 'gray'
}

// Both pages badge the raw JMAP undoStatus as the submission's status; the merged delivery
// state is a separate detail (and still drives which actions a row offers).
export const undoStatusLabel = (undoStatus: string) =>
	({
		pending: __('Pending'),
		final: __('Final'),
		canceled: __('Cancelled'),
	})[undoStatus] || undoStatus

export const undoStatusTheme = (undoStatus: string) => {
	if (undoStatus === 'pending') return 'blue'
	if (undoStatus === 'final') return 'green'
	return 'gray'
}

/** The per-recipient failure detail, for the status hover. */
export const deliveryErrorTitle = (row: Submission) =>
	row.delivery_errors.map((e) => `${e.email}: ${e.reason}`).join('\n')

export const subjectLabel = (row: Submission) =>
	row.email_deleted ? __('(Message deleted)') : row.subject || __('(No subject)')

export type SubmissionAction = {
	label: string
	icon: Component
	theme?: string
	onClick: () => void
}

export type SubmissionActionHandlers = {
	/** When provided, "Open email" leads the menu (for submissions whose message still exists). */
	openEmail?: () => void
	sendNow: () => void
	reschedule: () => void
	cancelDelivery: () => void
	sendAgain: () => void
	tryAgainNow: () => void
	remove: () => void
}

/**
 * The actions a submission's state offers, as dropdown options — shared by the Outbox
 * list rows and the details page header so the two menus never drift apart.
 */
export const submissionActions = (
	row: Submission,
	on: SubmissionActionHandlers,
): SubmissionAction[] => {
	const openEmail =
		on.openEmail && !row.email_deleted && row.thread_id
			? [{ label: __('Open email'), icon: Mail, onClick: on.openEmail }]
			: []
	const sendAgain = { label: __('Send again'), icon: RefreshCw, onClick: on.sendAgain }
	const remove = { label: __('Remove'), icon: X, onClick: on.remove }
	const cancel = {
		label: __('Cancel delivery'),
		icon: X,
		theme: 'red',
		onClick: on.cancelDelivery,
	}

	// A deleted message can't be resubmitted — dropping the failed record is all that's left.
	if (row.status === 'failed')
		return [...openEmail, ...(row.email_deleted ? [] : [sendAgain]), remove]

	if (row.status === 'retrying' || row.status === 'queued') {
		const retry = { label: __('Try again now'), icon: RefreshCw, onClick: on.tryAgainNow }
		// A released delivery stays cancellable for as long as its submission is pending.
		return [...openEmail, retry, ...(row.undo_status === 'pending' ? [cancel] : [])]
	}

	if (row.status === 'scheduled') {
		// A deleted message can't be resubmitted (send now / reschedule recreate the
		// submission from it) — cancelling the pending delivery is all that's left.
		if (row.email_deleted) return [cancel]

		return [
			...openEmail,
			{ label: __('Send now'), icon: SendHorizontal, onClick: on.sendNow },
			{ label: __('Reschedule'), icon: CalendarClock, onClick: on.reschedule },
			cancel,
		]
	}

	// Concluded (sent/delivered/read) or cancelled rows: resubmit and/or drop the record.
	if (row.status === 'cancelled' || row.email_deleted) return [...openEmail, remove]
	return [...openEmail, sendAgain, remove]
}
