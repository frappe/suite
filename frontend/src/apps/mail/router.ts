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
	mailboxes: { data?: { id: string }[] },
): { name: string; params: Record<string, string> } => {
	const firstMailbox = mailboxes.data?.[0]?.id
	if (firstMailbox) return { name: 'mail-mailbox', params: { accountId, mailbox: firstMailbox } }

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

		// Mail server not set up yet (Stalwart not fully configured — missing server_url,
		// username or password): show a friendly "not configured" message instead of a blank,
		// error-filled page. This is the most fundamental gate, so it runs before the
		// JMAP/dashboard checks below — the admin dashboard is only reachable once the server
		// is configured.
		if (!user?.is_stalwart_configured) {
			return to.name === 'mail-not-configured' ? undefined : { name: 'mail-not-configured' }
		}
		// Configured now, but sitting on the not-configured screen — send them into the app.
		if (to.name === 'mail-not-configured') return { name: 'mail-root-shortcut' }

		// Admin / dashboard access control.
		if (!user?.is_jmap_configured) {
			if (!user?.is_suite_admin) window.location.replace('/desk')
			if (to.meta.isDashboard) return
			return { name: 'mail-domains' }
		}

		// Resolve active account.
		resolveAccount(user?.accounts, to.params.accountId as string | undefined)
		const accountId = userStore().accountId

		// Wait for mailbox list.
		await mailboxes.promise
		const defaultRoute = buildDefaultRoute(accountId, mailboxes)

		// Validate mailbox param for mailbox routes.
		if (to.name === 'mail-mailbox' || to.name === 'mail-mail') {
			// The screener mailbox has its own dedicated view (Allow/Block UI). Redirect its
			// plain mailbox URL to the screener route so direct navigation and reloads land on
			// the screener view, matching the sidebar link (which already targets 'mail-screener').
			const screenerId = userStore().mailboxIds.screener
			if (screenerId && to.params.mailbox === screenerId)
				return { name: 'mail-screener', params: { accountId } }

			const mailboxExists =
				mailboxes.data?.some((m: { id: string }) => m.id === to.params.mailbox) ||
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
