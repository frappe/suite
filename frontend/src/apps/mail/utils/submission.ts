// Shared shapes and display helpers for EmailSubmission rows — the Outbox list and the
// submission details page render the same server-derived state.

import { CalendarClock, Mail, RefreshCw, SendHorizontal, X } from 'lucide-vue-next'
import type { Component } from 'vue'

import { api, type OutputOf } from '@/api'

type WireSubmission = OutputOf<typeof api.mail.scheduled.list>['rows'][number]
type WireDetails = OutputOf<typeof api.mail.scheduled.get>
export function submissionRow(row: WireSubmission) {
  return {
    ...row,
    email_id: row.email_id ?? undefined,
    thread_id: row.thread_id ?? undefined,
    subject: row.subject ?? undefined,
    from_name: row.from_name ?? undefined,
    from_email: row.from_email ?? undefined,
    send_at: row.send_at ?? '',
    undo_status: row.undo_status ?? '',
    recipients: row.recipients.map((recipient) => ({
      ...recipient,
      display_name: recipient.display_name ?? undefined,
    })),
    recipients_status: row.recipients_status.map((recipient) => ({
      ...recipient,
      email: recipient.email ?? '',
      reason: recipient.reason ?? undefined,
      smtp_reply: recipient.smtp_reply ?? undefined,
      delivered: recipient.delivered ?? undefined,
      displayed: recipient.displayed ?? undefined,
      next_retry: recipient.next_retry ?? undefined,
    })),
    delivery_errors: row.delivery_errors.map((error) => ({ ...error, email: error.email ?? '' })),
  }
}
export function submissionDetails(row: WireDetails) {
  return {
    ...submissionRow(row),
    identity_email: row.identity_email ?? undefined,
    envelope_from: row.envelope_from ?? undefined,
    envelope_recipients: row.envelope_recipients.filter((email): email is string => email !== null),
    priority: row.priority,
    next_retry: row.next_retry ?? undefined,
    dsn_count: row.dsn_count,
    mdn_count: row.mdn_count,
  }
}
export type Submission = ReturnType<typeof submissionRow>
export type SubmissionDetails = ReturnType<typeof submissionDetails>
export type RecipientState = Submission['recipients_status'][number]
export type SubmissionStatus = Submission['status']

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

export type StatusTheme = 'red' | 'amber' | 'blue' | 'green' | 'gray'

export const statusTheme = (status: SubmissionStatus | string): StatusTheme => {
  if (status === 'failed') return 'red'
  if (status === 'retrying') return 'amber'
  if (status === 'scheduled' || status === 'queued') return 'blue'
  if (status === 'delivered' || status === 'displayed') return 'green'
  return 'gray'
}

// The MT-Priority values MailQueue submits with (RFC 6710).
export const priorityLabel = (priority: number) => {
  const labels: Record<number, string> = { 4: __('High'), 0: __('Normal'), [-4]: __('Low') }
  return labels[priority] || String(priority)
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

type SubmissionAction = {
  label: string
  icon: Component
  theme?: string
  onClick: () => void
}

type SubmissionActionHandlers = {
  /** When provided, "Open email" leads the menu (for submissions whose message still exists). */
  openEmail?: () => void
  sendNow: () => void
  reschedule: () => void
  cancelDelivery: () => void
  sendAgain: () => void
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
    // The shared cluster retries on its own schedule; a released delivery stays
    // cancellable for as long as its submission is pending.
    return [...openEmail, ...(row.undo_status === 'pending' ? [cancel] : [])]
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
