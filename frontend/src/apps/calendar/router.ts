import type { RouteLocationNormalized } from 'vue-router'

import suiteRouter from '@/router'

import { userStore } from '@/apps/calendar/stores/user'

/**
 * Calendar-local guard on the shared suite router: setup-wizard escape,
 * user-data wait, account resolution and shortcut-route expansion.
 * Early-returns for any route whose name doesn't start with `calendar-`;
 * auth itself is the suite router's `beforeEach`.
 *
 * Re-exports the suite router instance as `router` for calendar views.
 */
export const router = suiteRouter

type Params = Record<string, string | string[]>

const resolveShortcut = (
	name: string | symbol | null | undefined,
	params: Params,
	accountId: string,
) => {
	const defaultRoute = { name: 'calendar-month', params: { accountId } }

	switch (name) {
		case 'calendar-month-shortcut':
			return { name: 'calendar-month', params: { accountId, ...params } }
		case 'calendar-week-shortcut':
			return { name: 'calendar-week', params: { accountId, ...params } }
		case 'calendar-day-shortcut':
			return { name: 'calendar-day', params: { accountId, ...params } }
		default:
			return defaultRoute
	}
}

export const calendarGuard = async (to: RouteLocationNormalized) => {
	// Only act on calendar routes; let the suite handle everything else.
	if (typeof to.name !== 'string' || !to.name.startsWith('calendar-')) return

	// Wait for user data, then resolve the active account.
	const store = userStore()
	await store.userResource.promise
	const user = store.userResource.data

	store.resolveAccount(user?.accounts, to.params.accountId as string | undefined)
	const accountId = store.accountId

	// Expand shortcut routes to their full account-scoped equivalents. The
	// query rides along — it carries the open event's deep link (?event=).
	if (to.meta.shortcut) return { ...resolveShortcut(to.name, to.params, accountId), query: to.query }
}

export default router
