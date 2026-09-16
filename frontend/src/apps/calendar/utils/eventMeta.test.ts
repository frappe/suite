import { describe, expect, it, vi } from 'vitest'

import { eventDescription, eventPeople, eventRowDescription } from './eventMeta'

// The formatter calls the global `__()` the translation boot installs at app start.
vi.stubGlobal('__', (text: string, args?: string[]) =>
	args ? text.replace('{0}', args[0]!) : text,
)

describe('eventDescription', () => {
	it('says nothing about an event with nowhere to be', () => {
		expect(eventDescription({})).toBe('')
	})

	it('prefers the location to the meeting link', () => {
		expect(
			eventDescription({
				locations: [{ _name: 'Hall 2' }],
				links: [{ href: 'https://example.com/meet/abc' }],
			}),
		).toBe('Hall 2')
	})

	it('falls back to the meeting when there is no location', () => {
		expect(
			eventDescription({ links: [{ href: 'https://example.com/meet/abc' }] }),
		).toBe('Frappe Meet')
	})

	it('leads with how often it repeats, as the formatter writes it, then where', () => {
		const line = eventDescription({
			locations: [{ _name: 'Hall 2' }],
			recurrence_rule: { frequency: 'weekly' },
		})
		expect(line.startsWith('Every ')).toBe(true)
		expect(line.endsWith(' · Hall 2')).toBe(true)
	})

	// The count stands at the row's far end, not on this line.
	it('leaves who is coming to the count', () => {
		expect(
			eventDescription({
				locations: [{ _name: 'Hall 2' }],
				participants: Array.from({ length: 14 }, () => ({
					participation_status: 'ACCEPTED',
				})),
			}),
		).toBe('Hall 2')
	})
})

describe('eventRowDescription', () => {
	it('puts the day of a stay after where the event is', () => {
		expect(eventRowDescription({ locations: [{ _name: 'Hall 2' }] }, 'Day 2/3')).toBe(
			'Hall 2 · Day 2/3',
		)
	})

	it('is just the day span on an event with nowhere to be, and nothing without one', () => {
		expect(eventRowDescription({}, 'Day 2/3')).toBe('Day 2/3')
		expect(eventRowDescription({}, null)).toBe('')
	})
})

describe('eventPeople', () => {
	// One other person is not worth counting out loud; a crowd is.
	it('counts the crowd, but only once there is one', () => {
		const of = (n: number) => ({
			participants: Array.from({ length: n }, () => ({ participation_status: 'ACCEPTED' })),
		})
		expect(eventPeople(of(1))).toBe('')
		expect(eventPeople(of(14))).toBe('14 people')
	})

	it('counts everyone invited, whatever they answered', () => {
		expect(
			eventPeople({
				participants: [
					{ participation_status: 'ACCEPTED' },
					{ participation_status: 'NEEDS-ACTION' },
					{ participation_status: 'DECLINED' },
				],
			}),
		).toBe('3 people')
	})
})
