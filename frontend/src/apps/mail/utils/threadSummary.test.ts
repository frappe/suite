import { describe, expect, it } from 'vitest'

import { resummariseRow } from './threadSummary'

import type { Mail, Thread } from '@/apps/mail/types'

const INBOX = 'mb-inbox'
const SENT = 'mb-sent'

const message = (mailbox: string, received_at: string, overrides: Partial<Mail> = {}): Mail =>
	({
		from_name: 'Ms. Paola',
		from_email: 'paola@iitkgp.ac.in',
		preview: 'The first tranche looks difficult, November…',
		recipients: [],
		draft: 0,
		attachments: [],
		received_at,
		mailboxes: [{ mailbox_id: mailbox }],
		...overrides,
	}) as unknown as Mail

// The mail that started it, four days old, and the reply sent today — which the account keeps in Sent
// and nowhere else, since a mail you send is never delivered to your own Inbox.
const received = message(INBOX, '2026-09-17 11:37:00')
const replied = message(SENT, '2026-09-21 11:43:00', {
	from_name: 'Vibhav Katre',
	from_email: 'vibhav@frappe.io',
	preview: 'Thanks — sharing the dates with the team.',
})

const row = (messages: Mail[]): Thread =>
	({
		thread_id: 't1',
		subject: 'ERPNext session for University of IIT Kharagpur',
		received_at: 'stale',
		from_name: 'stale',
		from_email: 'stale',
		preview: 'stale',
		recipients: [],
		draft: 0,
		attachments: [],
		messages,
	}) as unknown as Thread

describe('resummariseRow', () => {
	it('dates an Inbox row by the last mail that arrived, not by the reply you sent', () => {
		const thread = row([received, replied])

		resummariseRow(thread, { mailbox: INBOX })

		expect(thread.received_at).toBe('2026-09-17 11:37:00')
	})

	it('still describes the conversation by its most recent message', () => {
		const thread = row([received, replied])

		resummariseRow(thread, { mailbox: INBOX })

		expect(thread.from_email).toBe('vibhav@frappe.io')
		expect(thread.preview).toBe('Thanks — sharing the dates with the team.')
	})

	it('dates and describes a Sent row by the message you wrote', () => {
		const thread = row([received, replied])

		resummariseRow(thread, { mailbox: SENT, outgoing: true })

		expect(thread.received_at).toBe('2026-09-21 11:43:00')
		expect(thread.from_email).toBe('vibhav@frappe.io')
	})

	it('falls back to the conversation where no message is in the given mailbox', () => {
		const thread = row([received, replied])

		resummariseRow(thread, { mailbox: 'starred' })

		expect(thread.received_at).toBe('2026-09-21 11:43:00')
	})

	it('puts every summary field back when the action it was optimistic about fails', () => {
		const thread = row([received, replied])

		const restore = resummariseRow(thread, { mailbox: INBOX })
		restore()

		expect(thread.received_at).toBe('stale')
		expect(thread.from_email).toBe('stale')
		expect(thread.preview).toBe('stale')
	})
})
