import type { RouteLocationNormalized } from 'vue-router'

import '@/router'
import { useScreenSize } from '@/composables/useScreenSize'

import { userStore } from '@/apps/calendar/stores/user'
import { accountIdAt, accountRoute } from '@/apps/calendar/utils/locations'
import { lastCalendarView } from '@/apps/calendar/utils/lastView'

/**
 * Calendar-local guard on the shared suite router: setup-wizard escape,
 * user-data wait, account resolution and shortcut-route expansion.
 * Early-returns for any route whose name doesn't start with `calendar-`;
 * auth itself is the suite router's `beforeEach`.
 */
type Params = Record<string, string | string[]>

const resolveShortcut = (name: string | symbol | null | undefined, params: Params) => {
	// Home is the view the calendar was last left in. Failing that, the month grid
	// on a desktop and the agenda on a phone, which is where each device starts.
	// The phone draws all four views on the same routes the desktop uses, at phone
	// width, so a remembered view opens wherever it was remembered.
	const { isMobile } = useScreenSize()
	const home = lastCalendarView() ?? (isMobile.value ? 'calendar-agenda' : 'calendar-month')

	switch (name) {
		case 'calendar-month-shortcut':
			return accountRoute('calendar-month', undefined, params)
		case 'calendar-week-shortcut':
			return accountRoute('calendar-week', undefined, params)
		case 'calendar-day-shortcut':
			return accountRoute('calendar-day', undefined, params)
		case 'calendar-agenda-shortcut':
			return accountRoute('calendar-agenda', undefined, params)
		case 'calendar-search-shortcut':
			return accountRoute('calendar-search')
		default:
			return accountRoute(home)
	}
}

export const calendarGuard = async (to: RouteLocationNormalized) => {
	// Only act on calendar routes; let the suite handle everything else.
	if (typeof to.name !== 'string' || !to.name.startsWith('calendar-')) return

	// Wait for user data, then resolve the active account.
	const store = userStore()
	await store.userResource.promise
	const user = store.userResource.data

	// A number the user has no account at opens their personal one instead, as Gmail's
	// /u/9 opens /u/0.
	const accountNumber = to.params.account as string | undefined
	const routeAccountId = accountIdAt(accountNumber)
	if (accountNumber && !routeAccountId && accountNumber !== '0' && accountIdAt('0'))
		return { name: to.name, params: { ...to.params, account: '0' }, query: to.query }

	store.resolveAccount(user?.accounts, routeAccountId)

	// Expand shortcut routes to their full account-scoped equivalents. The
	// query rides along — it carries the open event's deep link (?event=).
	if (to.meta.shortcut) return { ...resolveShortcut(to.name, to.params), query: to.query }
}
