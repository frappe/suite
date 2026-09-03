import { describe, expect, it } from 'vitest'

import { parseMailSearchQuery } from './searchQuery'

describe('parseMailSearchQuery', () => {
	it('extracts address, subject, date, attachment, and read filters', () => {
		expect(
			parseMailSearchQuery(
				'budget from:alice@example.com to:bob@example.com cc:team@example.com bcc:audit@example.com subject:"Quarterly report" after:2026-01-01 before:2026-02-01 has:attachment is:unread',
			),
		).toEqual({
			text: 'budget',
			from: 'alice@example.com',
			to: 'bob@example.com',
			cc: 'team@example.com',
			bcc: 'audit@example.com',
			subject: 'Quarterly report',
			after: '2026-01-01',
			before: '2026-02-01',
			hasAttachment: 'true',
			isRead: 'false',
		})
	})

	it('keeps unsupported operators in the text query', () => {
		expect(parseMailSearchQuery('invoice label:finance')).toEqual({
			text: 'invoice label:finance',
		})
	})
})
