import { describe, expect, it } from 'vitest'

import { moveRecipient } from './recipientFields'

import type { ComposeMailData } from '@/apps/mail/types'

const draft = (overrides: Partial<ComposeMailData> = {}): ComposeMailData => ({
	to: [],
	cc: [],
	bcc: [],
	...overrides,
})

const amy = { email: 'amy@example.com', display_name: 'Amy Shah' }
const bob = { email: 'bob@example.com' }

describe('moveRecipient', () => {
	it('takes the address out of the field it was in and puts it in the one asked for', () => {
		const mail = draft({ cc: [amy] })

		moveRecipient(mail, amy.email, 'cc', 'to')

		expect(mail.cc).toEqual([])
		expect(mail.to).toEqual([amy])
	})

	it('carries the name and avatar over, not just the address', () => {
		const mail = draft({ cc: [amy] })

		moveRecipient(mail, amy.email, 'cc', 'to')

		expect(mail.to?.[0]).toMatchObject({ display_name: 'Amy Shah' })
	})

	it('leaves the others in the field where they were, in the order they were in', () => {
		const mail = draft({ cc: [amy, bob, { email: 'cat@example.com' }] })

		moveRecipient(mail, bob.email, 'cc', 'bcc')

		expect(mail.cc?.map((r) => r.email)).toEqual([amy.email, 'cat@example.com'])
		expect(mail.bcc).toEqual([bob])
	})

	it('keeps the lists it was handed, so the fields bound to them see the move', () => {
		const to = [bob]
		const cc = [amy]
		const mail = draft({ to, cc })

		moveRecipient(mail, amy.email, 'cc', 'to')

		expect(mail.to).toBe(to)
		expect(mail.cc).toBe(cc)
		expect(to).toEqual([bob, amy])
	})

	it('finds the address however it is spelled', () => {
		const mail = draft({ cc: [{ email: 'Amy@Example.com' }] })

		moveRecipient(mail, 'amy@example.com', 'cc', 'to')

		expect(mail.cc).toEqual([])
		expect(mail.to).toEqual([{ email: 'Amy@Example.com' }])
	})

	it('addresses nobody twice when they are already in the field being moved to', () => {
		const mail = draft({ to: [{ email: 'AMY@example.com' }], cc: [amy] })

		moveRecipient(mail, amy.email, 'cc', 'to')

		expect(mail.cc).toEqual([])
		expect(mail.to).toEqual([{ email: 'AMY@example.com' }])
	})

	it('does nothing when the address is not in the field it is said to be in', () => {
		const mail = draft({ to: [amy] })

		moveRecipient(mail, amy.email, 'cc', 'bcc')

		expect(mail.to).toEqual([amy])
		expect(mail.bcc).toEqual([])
	})

	it('does nothing when a field is asked to move an address to itself', () => {
		const mail = draft({ to: [amy, bob] })

		moveRecipient(mail, amy.email, 'to', 'to')

		expect(mail.to).toEqual([amy, bob])
	})

	it('starts the field it moves into when the draft has none', () => {
		const mail: ComposeMailData = { to: [amy] }

		moveRecipient(mail, amy.email, 'to', 'bcc')

		expect(mail.to).toEqual([])
		expect(mail.bcc).toEqual([amy])
	})
})
