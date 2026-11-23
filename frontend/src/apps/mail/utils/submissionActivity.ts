// The ledger the submission details page reads: one clause on where the delivery stands, and
// its history as far as the server tells it. There is no event log behind this — the
// submission, its per-recipient DeliveryStatus and the MTA queue hold the present state only,
// whichever client submitted the mail — so the entries are that state, told in the order it
// happened, and only the release and the next attempt carry a time.

import { formatDateTime, fromNow } from '@/apps/mail/utils/datetime'
import {
  priorityLabel,
  type RecipientState,
  type StatusTheme,
  type SubmissionDetails,
  type SubmissionStatus,
} from '@/apps/mail/utils/submission'

export type ActivityEntry = {
  key: string
  title: string
  detail?: string
  // The server's raw SMTP reply, verbatim.
  reply?: string
  // UTC wire timestamp; only the release and the next attempt have one.
  time?: string
  theme: StatusTheme
  // Yet to happen: an unreleased hold, the next retry.
  pending?: boolean
}

/** The clause after the status label: what the state means for this send. */
export const statusSummary = (s: SubmissionDetails): string => {
  const total = s.recipients_status.length
  switch (s.status) {
    case 'scheduled':
      return __('Sends {0} ({1})', [formatDateTime(s.send_at), fromNow(s.send_at)])
    case 'queued':
      return __('Handed to the mail server, waiting for the first attempt')
    case 'retrying':
      return s.next_retry
        ? __('Next attempt {0} ({1})', [formatDateTime(s.next_retry), fromNow(s.next_retry)])
        : __('The mail server will keep trying')
    case 'failed':
      return total > 1
        ? __('Could not be delivered to {0} of {1} recipients', [
            String(countOf(s, 'failed')),
            String(total),
          ])
        : __('Could not be delivered')
    case 'delivered':
      return deliveredSummary(total, countOf(s, 'displayed'))
    case 'displayed':
      return total > 1 ? __('Delivered and read by every recipient') : __('Delivered and read')
    case 'cancelled':
      return __('Was scheduled for {0}', [formatDateTime(s.send_at)])
    default:
      return __('Accepted by the mail server, no delivery report yet')
  }
}

/** The delivery's history, oldest first. */
export const activityEntries = (s: SubmissionDetails): ActivityEntry[] => {
  if (s.status === 'cancelled') return [cancelledEntry(s)]
  if (s.status === 'scheduled') return [releaseEntry(s)]

  const entries = [releasedEntry(s)]
  for (const recipient of s.recipients_status) {
    const entry = recipientEntry(recipient)
    if (entry) entries.push(entry)
  }
  if (s.status === 'retrying' && s.next_retry) entries.push(nextAttemptEntry(s.next_retry))
  return entries
}

/** Text colour per theme; dots take it through `bg-current` / `border-current`. */
export const themeInkClass = (theme: StatusTheme) =>
  ({
    gray: 'text-ink-gray-4',
    blue: 'text-ink-blue-7',
    amber: 'text-ink-amber-7',
    green: 'text-ink-green-7',
    red: 'text-ink-red-7',
  })[theme]

const deliveredSummary = (total: number, read: number) => {
  if (total <= 1) return __('Delivery confirmed')
  return read
    ? __('Delivered to all {0} recipients, read by {1}', [String(total), String(read)])
    : __('Delivered to all {0} recipients', [String(total)])
}

const countOf = (s: SubmissionDetails, status: SubmissionStatus) =>
  s.recipients_status.filter((r) => r.status === status).length

const recipientCount = (s: SubmissionDetails) => {
  const total = s.recipients_status.length
  return total === 1 ? __('1 recipient') : __('{0} recipients', [String(total)])
}

// When it was cancelled is not recorded anywhere; the summary line carries the release it
// was meant to have.
const cancelledEntry = (s: SubmissionDetails): ActivityEntry => ({
  key: 'cancelled',
  title: __('Delivery cancelled'),
  detail: s.email_deleted ? __('The message itself was deleted afterwards') : undefined,
  theme: 'gray',
})

const releaseEntry = (s: SubmissionDetails): ActivityEntry => ({
  key: 'release',
  time: s.send_at,
  title: __('Release to the mail server'),
  detail: [fromNow(s.send_at), recipientCount(s)].join(' · '),
  theme: 'blue',
  pending: true,
})

const releasedEntry = (s: SubmissionDetails): ActivityEntry => ({
  key: 'released',
  time: s.send_at,
  title: __('Released to the mail server'),
  detail: [
    recipientCount(s),
    ...(s.priority ? [__('{0} priority', [priorityLabel(s.priority)])] : []),
  ].join(' · '),
  theme: 'gray',
})

const nextAttemptEntry = (time: string): ActivityEntry => ({
  key: 'next-attempt',
  time,
  title: __('Next attempt'),
  detail: fromNow(time),
  theme: 'amber',
  pending: true,
})

// The queue's last error is the reason a troubled delivery stands where it does; for a settled
// one only the raw reply remains.
const recipientEntry = (r: RecipientState): ActivityEntry | null => {
  const key = `recipient:${r.email}`
  const retries = String(r.retries ?? 0)
  switch (r.status) {
    case 'queued':
      return {
        key,
        theme: 'blue',
        title: __('Queued for {0}', [r.email]),
        detail: __('Waiting for the first attempt'),
        reply: r.reason || r.smtp_reply,
      }
    case 'retrying':
      return {
        key,
        theme: 'amber',
        title: __('Deferred for {0}', [r.email]),
        detail: r.retries
          ? __('Retried {0} times, the server will keep trying', [retries])
          : __('The server will keep trying'),
        reply: r.reason || r.smtp_reply,
      }
    case 'failed':
      return {
        key,
        theme: 'red',
        title: __('Delivery failed for {0}', [r.email]),
        detail: r.retries ? __('Gave up after {0} retries', [retries]) : undefined,
        reply: r.reason || r.smtp_reply,
      }
    case 'sent':
      return {
        key,
        theme: 'gray',
        title: __('Accepted for {0}', [r.email]),
        detail: __('No delivery report yet'),
        reply: r.smtp_reply,
      }
    case 'delivered':
      return {
        key,
        theme: 'green',
        title: __('Delivered to {0}', [r.email]),
        detail: __('Delivery report received'),
        reply: r.smtp_reply,
      }
    case 'displayed':
      return {
        key,
        theme: 'green',
        title: __('Read by {0}', [r.email]),
        detail: __('Read receipt received'),
        reply: r.smtp_reply,
      }
    default:
      // Still held: the release entry tells that, nothing has happened per recipient.
      return null
  }
}
