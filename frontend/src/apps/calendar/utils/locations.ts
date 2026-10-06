import type { RouteParamsRawGeneric } from 'vue-router'

import { userStore } from '@/apps/calendar/stores/user'

/**
 * Where things are in Calendar. Stores and views name an account by its JMAP id ('mh'), but a
 * URL names it by the user's number for it, 0 their personal one, as Mail's do:
 *
 *   /calendar/a/0/#week/2026/10/6
 *
 * The number is the same in both apps. This module turns an id into it and back.
 */

interface Account {
	id: string
	number: number
}

/** A page of an account: `accountRoute('calendar-day', accountId, { year, month, day })`. */
export const accountRoute = (
	name: string,
	accountId?: string,
	params: RouteParamsRawGeneric = {},
) => ({ name, params: { account: accountNumber(accountId), ...params } })

/** Defaults to the active account. One that only shares a calendar with the user has a number too. */
export const accountNumber = (accountId?: string): string => {
	const store = userStore()
	const id = accountId || store.accountId
	const accounts: Account[] = store.userResource.data?.all_accounts ?? []
	return String(accounts.find((a) => a.id === id)?.number ?? 0)
}

/** The account the user can switch to at a number, if there is one. */
export const accountIdAt = (number: unknown): string | undefined => {
	const accounts: Account[] = userStore().userResource.data?.accounts ?? []
	return accounts.find((a) => String(a.number) === number)?.id
}
