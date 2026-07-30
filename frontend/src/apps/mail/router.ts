import type { RouteLocationNormalized, Router } from 'vue-router'

import suiteRouter from '@/router'
import { useSessionStore } from '@/boot/session'

import { userStore } from '@/apps/mail/stores/user'

/**
 * Mail-local guard on the shared suite router: setup-wizard escape, user-data
 * wait, dashboard access control, account resolution, mailbox validation and
 * shortcut-route expansion. Early-returns for any route whose name doesn't
 * start with `mail-`; auth itself is the suite router's `beforeEach`
 * (redirects guests unless `meta.allowGuest`).
 *
 * Re-exports the suite router instance as `router` so mail pages/stores can
 * import it from `@/apps/mail/router`.
 */
export const router = suiteRouter

type Params = Record<string, string | string[]>

const handleSetupWizardEscape = () => {
	if (document.referrer.includes('/desk/setup-wizard')) window.location.replace('/desk')
}

const buildDefaultRoute = (
	accountId: string,
	mailboxes: { data?: { id: string; role?: string }[] },
): { name: string; params: Record<string, string> } => {
	// Resolve the Inbox by role, not list position: the list is sorted by the
	// user-orderable sort_order, so [0] can be any folder — including the
	// Screener, whose redirect below would bounce '/mail' back to the screener
	// view (from there the Inbox tab then appeared to do nothing).
	const defaultMailbox = mailboxes.data?.find((m) => m.role === 'inbox') ?? mailboxes.data?.[0]
	if (defaultMailbox)
		return { name: 'mail-mailbox', params: { accountId, mailbox: defaultMailbox.id } }

	return { name: 'mail-address-books', params: { accountId } }
}

const resolveShortcut = (
	name: string | symbol | null | undefined,
	params: Params,
	accountId: string,
	defaultRoute: { name: string; params: Record<string, string> },
) => {
	switch (name) {
		case 'mail-mailbox-shortcut':
			if (params.threadID) return { name: 'mail-mail', params: { accountId, ...params } }
			if (params.mailbox) return { name: 'mail-mailbox', params: { accountId, ...params } }
			return defaultRoute
		case 'mail-address-books-shortcut':
			if (params.addressBookName)
				return { name: 'mail-address-book', params: { accountId, ...params } }
			return { name: 'mail-address-books', params: { accountId } }
		case 'mail-contacts-shortcut':
			if (params.contactName) return { name: 'mail-contact', params: { accountId, ...params } }
			return { name: 'mail-contacts', params: { accountId } }
		default:
			return defaultRoute
	}
}

function installMailGuard(r: Router) {
	r.beforeEach(async (to: RouteLocationNormalized) => {
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

		// Admin / dashboard access control.
		if (!user?.is_jmap_configured) {
			if (!user?.is_suite_admin) window.location.replace('/desk')
			if (to.meta.isDashboard) return
			return { name: 'mail-domains' }
		}

		// Resolve active account.
		resolveAccount(user?.accounts, to.params.accountId as string | undefined)
		const accountId = userStore().accountId

		// Wait for mailbox list. The fetch rejects when the mail server is temporarily down;
		// swallow that so navigation still completes — otherwise the initial navigation aborts,
		// the app never mounts and the user gets a blank page instead of the unavailable banner.
		await mailboxes.promise?.catch(() => {})
		const defaultRoute = buildDefaultRoute(accountId, mailboxes)

		// Validate mailbox param for mailbox routes.
		if (to.name === 'mail-mailbox' || to.name === 'mail-mail') {
			// The screener mailbox has its own dedicated view (Allow/Block UI). Redirect its
			// plain mailbox URL to the screener route so direct navigation and reloads land on
			// the screener view, matching the sidebar link (which already targets 'mail-screener').
			const screenerId = userStore().mailboxIds.screener
			if (screenerId && to.params.mailbox === screenerId)
				return { name: 'mail-screener', params: { accountId } }

			// With no mailbox list (fetch failed above) the param can't be validated — keep the
			// requested route rather than bouncing the user off the URL they asked for.
			const mailboxExists =
				!mailboxes.data ||
				mailboxes.data.some((m: { id: string }) => m.id === to.params.mailbox) ||
				['starred', 'search'].includes(to.params.mailbox as string)
			if (!mailboxExists) return defaultRoute
		}

		// Expand shortcut routes to their full account-scoped equivalents.
		if (to.meta.shortcut) return resolveShortcut(to.name, to.params, accountId, defaultRoute)

		// Login pages redirect already-authenticated users to their mailbox.
		if (to.meta.isLogin) return defaultRoute
	})
}

installMailGuard(router)

export default router
