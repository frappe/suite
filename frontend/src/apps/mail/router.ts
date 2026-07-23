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

		// The admin dashboard manages mail infrastructure, so it requires the full server
		// connection (server_url + username + password). If that isn't set up, show the
		// "not configured" screen (which explains the fix to admins and tells everyone else to
		// contact one). Account is already resolved on user load, so nothing else to do here.
		if (to.meta.isDashboard) {
			if (!user?.is_stalwart_configured) {
				return to.name === 'mail-not-configured' ? undefined : { name: 'mail-not-configured' }
			}
			return
		}

		// Users without a "Suite User" role have no personal mailbox, so the mail UI isn't for
		// them — Administrators / System Managers / Suite Admins belong in the admin area. (This
		// is also why the credentials-setup screen below is only ever shown to Suite Users.)
		if (!user?.is_suite_user) {
			// A user with no suite or admin role at all doesn't belong in Mail — hand them to Desk.
			if (!user?.is_system_manager && !user?.is_suite_admin) {
				window.location.replace('/desk')
				return
			}
			// When the server isn't set up, keep them on the not-configured screen rather than
			// bouncing to the admin area (which would just send them back here).
			if (to.name === 'mail-not-configured' && !user?.is_stalwart_configured) return
			return to.name === 'mail-admin' ? undefined : { name: 'mail-admin' }
		}

		// Suite Users (mail users). Mail viewing needs a server_url...
		if (!user?.is_server_configured) {
			return to.name === 'mail-not-configured' ? undefined : { name: 'mail-not-configured' }
		}

		// ...and this user's own JMAP credentials.
		if (!user?.is_jmap_configured) {
			return to.name === 'mail-credentials-setup'
				? undefined
				: { name: 'mail-credentials-setup' }
		}

		// Fully configured — bounce off any setup/not-configured screen into the app.
		if (to.name === 'mail-not-configured' || to.name === 'mail-credentials-setup')
			return { name: 'mail-root-shortcut' }

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
