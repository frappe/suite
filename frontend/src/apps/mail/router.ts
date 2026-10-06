import type { RouteLocationNormalized } from 'vue-router'

import suiteRouter from '@/router'
import { useSessionStore } from '@/boot/session'

import { userStore } from '@/apps/mail/stores/user'
import {
	accountIdAt,
	accountRoute,
	isMailboxRoute,
	mailboxAddress,
	mailboxRoute,
	routeMailboxId,
	type MailLocation,
} from '@/apps/mail/utils/locations'

/**
 * Mail-local guard on the shared suite router: setup-wizard escape, user-data
 * wait, dashboard access control, account resolution, the screener redirect and
 * shortcut-route expansion. Early-returns for any route whose name doesn't
 * start with `mail-`; auth itself is the suite router's `beforeEach`
 * (redirects guests unless `meta.allowGuest`).
 *
 * Re-exports the suite router instance as default so mail pages/stores can
 * import it from `@/apps/mail/router`.
 */
type Params = Record<string, string | string[]>

const handleSetupWizardEscape = () => {
	if (document.referrer.includes('/desk/setup-wizard')) window.location.replace('/desk')
}

const buildDefaultRoute = (mailboxes: { data?: { id: string }[] }): MailLocation => {
	const firstMailbox = mailboxes.data?.[0]?.id
	return firstMailbox ? mailboxRoute(firstMailbox) : accountRoute('mail-address-books')
}

const resolveShortcut = (
	name: string | symbol | null | undefined,
	params: Params,
	mailboxes: { data?: { id: string }[] },
	defaultRoute: MailLocation,
) => {
	const { mailbox, threadID, addressBookName, contactName } = params as Record<string, string>
	switch (name) {
		case 'mail-mailbox-shortcut':
			// An id the account has no mailbox for would only come back here.
			if (!mailboxAddress(mailboxes.data, mailbox)) return defaultRoute
			return mailboxRoute(mailbox, { threadID })
		case 'mail-address-books-shortcut':
			if (addressBookName) return accountRoute('mail-address-book', undefined, { addressBookName })
			return accountRoute('mail-address-books')
		case 'mail-contacts-shortcut':
			if (contactName) return accountRoute('mail-contact', undefined, { contactName })
			return accountRoute('mail-contacts')
		default:
			return defaultRoute
	}
}

export const mailGuard = async (to: RouteLocationNormalized) => {
	// Only act on mail routes; let the suite handle everything else.
	if (typeof to.name !== 'string' || !to.name.startsWith('mail-')) return

	handleSetupWizardEscape()

	// Auth: the suite guard already redirects guests on non-public routes,
	// but public mail routes (login/signup/...) must short-circuit here so
	// we don't trigger user-data resolution for a guest.
	const { isLoggedIn } = useSessionStore()
	if (!isLoggedIn) return

	// Wait for user data.
	const { userResource, mailboxes, resolveAccount } = userStore()
	await userResource.promise
	const user = userResource.data

	// The Admin Dashboard is Suite Cloud's face on the site: it is for admins, and only on a
	// site connected to one. Mail itself needs neither, just a mailbox.
	const canAdminister = !!user?.is_suite_admin && !!user?.is_suite_cloud_configured

	// No mailbox: the dashboard is all Mail has for them, if they may have it.
	if (!user?.is_jmap_configured) {
		if (!canAdminister) {
			window.location.replace('/desk')
			return false
		}
		if (to.meta.isDashboard) return
		return { name: 'mail-overview' }
	}

	// A number the user has no account at opens their personal one instead, as Gmail's
	// /u/9 opens /u/0.
	const accountNumber = to.params.account as string | undefined
	const routeAccountId = accountIdAt(accountNumber)
	if (accountNumber && !routeAccountId && accountNumber !== '0' && accountIdAt('0'))
		return { name: to.name, params: { ...to.params, account: '0' }, query: to.query }

	// Resolve active account. The merged All Inboxes thread route carries the thread's
	// owning account purely to scope the pane (see utils/accountScope) — opening a
	// thread there must not switch the active account out from under the merged list.
	resolveAccount(user?.accounts, to.name === 'mail-all-inboxes-mail' ? undefined : routeAccountId)

	// Wait for mailbox list. The fetch rejects when the mail server is temporarily down;
	// swallow that so navigation still completes — otherwise the initial navigation aborts,
	// the app never mounts and the user gets a blank page instead of the unavailable banner.
	await mailboxes.promise?.catch(() => {})
	const defaultRoute = buildDefaultRoute(mailboxes)

	if (to.meta.isDashboard && !canAdminister) return defaultRoute
	if (accountNumber && !routeAccountId) return defaultRoute

	// The screener mailbox has its own dedicated view (Allow/Block UI). Redirect its plain
	// mailbox URL to the screener route so direct navigation and reloads land on the
	// screener view, matching the sidebar link (which already targets 'mail-screener').
	// Any other mailbox is left as asked for: one the account has not got is told so by
	// MailLayout rather than swapped for another.
	const screenerId = userStore().mailboxIds.screener
	if (screenerId && isMailboxRoute(to) && routeMailboxId(to) === screenerId)
		return accountRoute('mail-screener')

	// Expand shortcut routes to their full account-scoped equivalents. The
	// query rides along — it can carry a compose deep link (?compose=1&to=).
	if (to.meta.shortcut)
		return { ...resolveShortcut(to.name, to.params, mailboxes, defaultRoute), query: to.query }

	// Login pages redirect already-authenticated users to their mailbox.
	if (to.meta.isLogin) return defaultRoute
}

export default suiteRouter
