import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteLocationNormalized } from 'vue-router'

const state = vi.hoisted(() => ({
	accountId: 'own',
	switchedTo: [] as (string | undefined)[],
	lastView: null as string | null,
}))

// The user's own account and a team's, whose number skips the one an unlinked account had.
// A colleague's account shares a calendar with them: linked, but not one to switch to.
const ACCOUNTS = [
	{ id: 'own', number: 0 },
	{ id: 'team', number: 2 },
]
const ALL_ACCOUNTS = [...ACCOUNTS, { id: 'colleague', number: 3 }]

vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/composables/useScreenSize', () => ({ useScreenSize: () => ({ isMobile: { value: false } }) }))
vi.mock('@/apps/calendar/utils/lastView', () => ({ lastCalendarView: () => state.lastView }))
vi.mock('@/apps/calendar/stores/user', () => ({
	userStore: () => ({
		userResource: {
			promise: Promise.resolve(),
			data: { accounts: ACCOUNTS, all_accounts: ALL_ACCOUNTS },
		},
		resolveAccount: (_accounts: unknown, id?: string) => state.switchedTo.push(id),
		accountId: state.accountId,
	}),
}))

import { calendarGuard } from './router'
import { accountRoute } from './utils/locations'

const to = (name: string, params: Record<string, string> = {}, meta: Record<string, unknown> = {}) =>
	({ name, meta, params, query: { event: 'E1' } }) as unknown as RouteLocationNormalized
const shortcut = { shortcut: true }

beforeEach(() => {
	state.accountId = 'own'
	state.switchedTo.length = 0
	state.lastView = null
})

describe('the account a calendar URL names by number', () => {
	it('becomes the active one', async () => {
		expect(await calendarGuard(to('calendar-week', { account: '2' }))).toBeUndefined()
		expect(state.switchedTo).toEqual(['team'])
	})

	it('falls back to the personal account when the user has none at that number', async () => {
		const unlinked = to('calendar-day', { account: '1', year: '2026', month: '10', day: '6' })
		expect(await calendarGuard(unlinked)).toEqual({
			name: 'calendar-day',
			params: { account: '0', year: '2026', month: '10', day: '6' },
			query: { event: 'E1' },
		})
	})

	it('is not one that only shares a calendar with the user', async () => {
		const shared = await calendarGuard(to('calendar-month', { account: '3' }))
		expect(shared).toMatchObject({ params: { account: '0' } })
	})
})

describe('a calendar shortcut', () => {
	it('opens the view it names under the active account, keeping the date and the event', async () => {
		state.accountId = 'team'
		const week = to('calendar-week-shortcut', { year: '2026', month: '10', day: '6' }, shortcut)
		expect(await calendarGuard(week)).toEqual({
			name: 'calendar-week',
			params: { account: '2', year: '2026', month: '10', day: '6' },
			query: { event: 'E1' },
		})
	})

	it('opens the view the calendar was last left in, or the month', async () => {
		expect(await calendarGuard(to('calendar-root-shortcut', {}, shortcut))).toMatchObject({
			name: 'calendar-month',
			params: { account: '0' },
		})
		state.lastView = 'calendar-agenda'
		const account = to('calendar-account-shortcut', { account: '2' }, shortcut)
		expect(await calendarGuard(account)).toMatchObject({ name: 'calendar-agenda' })
	})
})

describe('the number in a link to an account', () => {
	it('is the user’s for it, the active one unless another is named', () => {
		expect(accountRoute('calendar-search').params).toEqual({ account: '0' })
		expect(accountRoute('calendar-day', 'team', { year: 2026 }).params).toEqual({
			account: '2',
			year: 2026,
		})
	})

	it('is there for an account that only shares a calendar', () => {
		expect(accountRoute('calendar-month', 'colleague').params).toEqual({ account: '3' })
	})
})
