import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { withAccountFragments } from '@/router/fragmentHistory'

import { routes } from './routes'

const Stub = { render: () => null }

/** Mirror src/router/index.ts: the calendar module is mounted as children of '/calendar'. */
const makeRouter = () =>
	createRouter({
		history: withAccountFragments(createMemoryHistory(), ['calendar']),
		routes: [{ path: '/calendar', component: Stub, children: routes }],
	})

const at = (path: string) => {
	const { name, params } = makeRouter().resolve(path)
	return [name, params]
}

describe('the pages of an account in Calendar', () => {
	it('a view, on today or on a date', () => {
		expect(at('/calendar/a/0/week')[0]).toBe('calendar-week')
		expect(at('/calendar/a/2/day/2026/10/6')).toEqual([
			'calendar-day',
			{ account: '2', year: '2026', month: '10', day: '6' },
		])
		expect(at('/calendar/a/0/month/2026/10')[0]).toBe('calendar-month')
		expect(at('/calendar/a/0/agenda')[0]).toBe('calendar-agenda')
	})

	it('search and the profile', () => {
		expect(at('/calendar/a/0/search')[0]).toBe('calendar-search')
		expect(at('/calendar/a/0/profile')[0]).toBe('calendar-profile')
	})

	it('are linked to by fragment, with the open event after the page', () => {
		const link = makeRouter().resolve({
			name: 'calendar-day',
			params: { account: '1', year: 2026, month: 10, day: 6 },
			query: { event: 'E1' },
		})
		expect(link.href).toBe('/calendar/a/1/#day/2026/10/6?event=E1')
	})

	it('the shortcuts stay plain paths', () => {
		expect(at('/calendar')[0]).toBe('calendar-root-shortcut')
		expect(at('/calendar/a/1')[0]).toBe('calendar-account-shortcut')
		expect(at('/calendar/week/2026/10/6')[0]).toBe('calendar-week-shortcut')
		expect(makeRouter().resolve('/calendar/week').href).toBe('/calendar/week')
	})

	it('the addresses from before account numbers are gone', () => {
		expect(makeRouter().resolve('/calendar/account/mh/week').matched).toEqual([])
	})
})
