import { describe, expect, it } from 'vitest'

import { eventRowId, sameEvent, serverEventId } from './eventIdentity'

describe('eventRowId', () => {
	it('tells apart two accounts that named an event the same thing', () => {
		const mine = { name: 'ih|eaaaalw', event_id: 'eaaaalw', master_id: 'lw' }
		const shared = { name: 'te|eaaaalw', event_id: 'eaaaalw', master_id: 'lw' }

		expect(eventRowId(mine)).not.toBe(eventRowId(shared))
	})

	it('names a row the same way on every redraw', () => {
		const event = { name: 'te|eaaaalw', event_id: 'eaaaalw', master_id: 'lw' }

		expect(eventRowId(event)).toBe(eventRowId({ ...event }))
	})
})

describe('serverEventId', () => {
	it('names the series an occurrence came from', () => {
		expect(
			serverEventId({ name: 'te|eaaaalw', event_id: 'eaaaalw', master_id: 'lw' }),
		).toBe('lw')
	})

	it('names the event itself when it belongs to no series', () => {
		expect(serverEventId({ name: 'ih|me', event_id: 'me' })).toBe('me')
	})

	it('never answers with the account-qualified name the UI draws with', () => {
		const event = { name: 'te|eaaaalw', event_id: 'eaaaalw', master_id: 'lw' }

		expect(serverEventId(event)).not.toContain('|')
	})
})

describe('sameEvent', () => {
	// What the search returns for a one-off, and what the grid's window holds for the same
	// event — the pair that made a search row never read as the open one.
	const searched = { account: 'ih', event_id: 'lw', recurrence_id: null }
	const onTheGrid = { account: 'ih', event_id: 'eaaaalw', master_id: 'lw', recurrence_id: null }

	it('knows a master and its expanded copy are one event', () => {
		expect(sameEvent(searched, onTheGrid)).toBe(true)
	})

	it('does not confuse two accounts that named an event the same', () => {
		expect(sameEvent(searched, { ...onTheGrid, account: 'te' })).toBe(false)
	})

	it('tells one occurrence of a series from the next', () => {
		const monday = { account: 'ih', event_id: 'biaaaamc', master_id: 'mc', recurrence_id: '2026-09-24T14:30:00' }
		const nextMonday = { ...monday, event_id: 'bmaaaamc', recurrence_id: '2026-10-01T14:30:00' }
		expect(sameEvent(monday, { ...monday })).toBe(true)
		expect(sameEvent(monday, nextMonday)).toBe(false)
	})

	it('is false with nothing to compare', () => {
		expect(sameEvent(null, onTheGrid)).toBe(false)
		expect(sameEvent(searched, undefined)).toBe(false)
	})
})
