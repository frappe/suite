import { describe, expect, it } from 'vitest'

import { mailCopies, mailCopyIds, mailCopyNames, rowMailIds } from './mailCopies'

import type { Mail, MailCopy, Thread } from '@/apps/mail/types'

const mail = (overrides: Partial<Mail> = {}): Mail =>
	({ name: 'message-d1', id: 'd1', ...overrides }) as Mail

// What the server hangs off a self-addressed message: the copy sitting in Sent, which the thread
// doesn't show but every action still has to reach.
const sentCopy = { name: 'message-s1', id: 's1' } as MailCopy

describe('mailCopies', () => {
	it('is the message itself when the account holds only one of it', () => {
		const only = mail()
		expect(mailCopies(only)).toEqual([only])
	})

	it('leads with the message the thread shows, then the copies it stands in for', () => {
		const shown = mail({ duplicates: [sentCopy] })
		expect(mailCopies(shown)).toEqual([shown, sentCopy])
	})

	it('gives an action every id, so no copy is left behind in Sent', () => {
		expect(mailCopyIds(mail({ duplicates: [sentCopy] }))).toEqual(['d1', 's1'])
	})

	it('gives a delete every document name', () => {
		expect(mailCopyNames(mail({ duplicates: [sentCopy] }))).toEqual(['message-d1', 'message-s1'])
	})
})

// The row names one message of its thread — in Sent, for a mail to yourself, the copy the pane does
// not render.
const row = (id: string, messages: Mail[]): Thread => ({ id, messages }) as Thread

describe('rowMailIds', () => {
	it('reaches the copy the pane shows when the row stands for the other one', () => {
		const shown = mail({ duplicates: [sentCopy] })
		expect(rowMailIds(row('s1', [shown]))).toEqual(['d1', 's1'])
	})

	it('is the row\'s own mail when it has no twin', () => {
		expect(rowMailIds(row('d1', [mail()]))).toEqual(['d1'])
	})

	it('falls back to the row itself when its conversation is not loaded', () => {
		expect(rowMailIds({ id: 'x1' } as Thread)).toEqual(['x1'])
	})
})
