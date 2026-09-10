import { describe, expect, it } from 'vitest'

import {
	getMailChoiceOperator,
	getMailContactOperator,
	getMailSearchOperatorContext,
	parseMailSearchQuery,
} from './searchQuery'

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

	it('describes the active operator while its value is being entered', () => {
		expect(getMailSearchOperatorContext('invoice to:')).toEqual({
			label: 'To',
			prompt: 'Enter a recipient email address',
		})
		expect(getMailSearchOperatorContext('invoice')).toBeNull()
		expect(getMailSearchOperatorContext('to:alice@example.com from:bob@example.com')).toBeNull()
	})

	it('combines multiple populated filters', () => {
		expect(parseMailSearchQuery('to:alice@example.com from:bob@example.com')).toEqual({
			to: 'alice@example.com',
			from: 'bob@example.com',
		})
	})

	it('identifies the contact operator currently being typed', () => {
		expect(getMailContactOperator('invoice to:sag')).toEqual({ key: 'to', partial: 'sag' })
		expect(getMailContactOperator('subject:invoice')).toBeNull()
	})

	it('identifies operators with a fixed set of choices', () => {
		expect(getMailChoiceOperator('project in:inb')).toEqual({ key: 'in', partial: 'inb' })
		expect(getMailChoiceOperator('has:att')).toEqual({ key: 'has', partial: 'att' })
		expect(getMailChoiceOperator('is:un')).toEqual({ key: 'is', partial: 'un' })
	})
})
