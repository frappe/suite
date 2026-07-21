import type { RouteRecordRaw } from 'vue-router'

import { createResource } from 'frappe-ui'

// Install the mail-local navigation guard (auth-aware account resolution,
// dashboard access control, mailbox validation + shortcut expansion) on the
// shared suite router. Imported for side effects only.
import '@/apps/mail/router'

/**
 * Mail route module — mounted by the suite router under the '/mail' prefix.
 * Paths are RELATIVE to '/mail' (no leading slash; the empty-path '' is the
 * app index). Route names are namespaced `mail-*` to avoid collisions in the
 * single suite router.
 *
 * Public (pre-auth) routes carry `meta.allowGuest: true` so the suite router's
 * global auth guard does not redirect guests to /login. They sit OUTSIDE the
 * MailLayout (which provides $user/$dayjs/$socket) because they don't need
 * those injects. All authed routes nest under MailLayout.
 */

// Lightweight placeholder used by shortcut routes — the mail guard intercepts
// them and redirects before any component ever mounts.
const ShortcutRedirect = { render: () => null }

// LoginLayout supplies the Frappe Mail logo, the centered card and the per-route
// title. Without it the public views render as bare, full-bleed forms.
const LoginLayout = () => import('@/apps/mail/components/LoginLayout.vue')
const publicMeta = { isLogin: true, allowGuest: true }

export const routes: RouteRecordRaw[] = [
	// --- Public (pre-auth) routes -------------------------------------------
	// One LoginLayout wrapper PER path segment rather than a single `path: ''`
	// parent: an empty-path wrapper would tie with the MailLayout group below
	// for an exact `/mail` match and, being declared first, would win — leaving
	// `mail-root-shortcut` unreachable and rendering an empty login card.
	{
		path: 'login',
		component: LoginLayout,
		children: [
			{
				path: '',
				name: 'mail-login',
				component: () => import('@/apps/mail/pages/LoginView.vue'),
				meta: publicMeta,
			},
		],
	},
	{
		path: 'signup',
		component: LoginLayout,
		children: [
			{
				path: '',
				name: 'mail-signup',
				component: () => import('@/apps/mail/pages/SignupView.vue'),
				meta: publicMeta,
			},
			{
				path: ':requestKey',
				name: 'mail-invite-setup',
				component: () => import('@/apps/mail/pages/InviteSetupView.vue'),
				props: true,
				meta: publicMeta,
			},
		],
	},
	{
		path: 'reset-password',
		component: LoginLayout,
		children: [
			{
				path: '',
				name: 'mail-forgot-password',
				component: () => import('@/apps/mail/pages/ForgotPasswordView.vue'),
				meta: publicMeta,
			},
			{
				path: ':requestKey',
				name: 'mail-reset-password',
				component: () => import('@/apps/mail/pages/ResetPasswordView.vue'),
				props: true,
				meta: publicMeta,
			},
		],
	},
	// A guest must be able to reach a public MIME message view.
	{
		path: 'mime-message/:id',
		name: 'mail-mime-message',
		component: () => import('@/apps/mail/pages/MimeMessageView.vue'),
		props: true,
		meta: { noLayout: true, allowGuest: true },
	},

	// --- Authed routes (nested under MailLayout) ----------------------------
	{
		path: '',
		component: () => import('@/apps/mail/pages/MailLayout.vue'),
		children: [
			{
				path: 'all-inboxes',
				name: 'mail-all-inboxes',
				component: () => import('@/apps/mail/pages/AllInboxesView.vue'),
			},
			{
				path: 'account/:accountId/mailbox/:mailbox',
				name: 'mail-mailbox',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/mailbox/:mailbox/:threadID',
				name: 'mail-mail',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/screener',
				name: 'mail-screener',
				component: () => import('@/apps/mail/pages/ScreenerView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/address-books/',
				name: 'mail-address-books',
				component: () => import('@/apps/mail/pages/AddressBooksView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/address-books/:addressBookName',
				name: 'mail-address-book',
				component: () => import('@/apps/mail/pages/AddressBookView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/contacts/',
				name: 'mail-contacts',
				component: () => import('@/apps/mail/pages/ContactsView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/contacts/:contactName',
				name: 'mail-contact',
				component: () => import('@/apps/mail/pages/ContactView.vue'),
				props: true,
			},
			{
				path: 'mail-exchanges',
				name: 'mail-exchanges',
				component: () => import('@/apps/mail/pages/MailExchangesView.vue'),
				meta: { noLayout: true },
			},
			{
				path: 'mail-exchanges/:id',
				name: 'mail-exchange',
				component: () => import('@/apps/mail/pages/MailExchangeView.vue'),
				meta: { noLayout: true },
				props: true,
			},
			{
				path: 'calendar-exchanges',
				name: 'mail-calendar-exchanges',
				component: () => import('@/apps/mail/pages/CalendarExchangesView.vue'),
				meta: { noLayout: true },
			},
			{
				path: 'calendar-exchanges/:id',
				name: 'mail-calendar-exchange',
				component: () => import('@/apps/mail/pages/CalendarExchangeView.vue'),
				meta: { noLayout: true },
				props: true,
			},
			{
				path: 'contacts-exchanges',
				name: 'mail-contacts-exchanges',
				component: () => import('@/apps/mail/pages/ContactsExchangesView.vue'),
				meta: { noLayout: true },
			},
			{
				path: 'contacts-exchanges/:id',
				name: 'mail-contacts-exchange',
				component: () => import('@/apps/mail/pages/ContactsExchangeView.vue'),
				meta: { noLayout: true },
				props: true,
			},
			{
				path: 'dashboard',
				redirect: { name: 'mail-domains' },
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/domains',
				name: 'mail-domains',
				component: () => import('@/apps/mail/pages/dashboard/DomainsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/domains/:domainId',
				name: 'mail-domain',
				component: () => import('@/apps/mail/pages/dashboard/DomainView.vue'),
				props: true,
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/members',
				name: 'mail-members',
				component: () => import('@/apps/mail/pages/dashboard/MembersView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/invites',
				name: 'mail-invites',
				component: () => import('@/apps/mail/pages/dashboard/MembersView.vue'),
				meta: { isDashboard: true },
			},
			// Shortcut routes: short paths that resolve to their full
			// account-scoped equivalents once the active accountId is known
			// (resolved in the mail guard — see ./router.ts).
			{
				path: '',
				name: 'mail-root-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'account/:accountId?',
				name: 'mail-account-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'mailbox/:mailbox?/:threadID?',
				name: 'mail-mailbox-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'address-books/:addressBookName?',
				name: 'mail-address-books-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			{
				path: 'contacts/:contactName?',
				name: 'mail-contacts-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
		],
	},
]

export default routes

/* -------------------------------------------------------------------------- */
/* Translations                                                               */
/*                                                                            */
/* The suite installs ONE global translation plugin (foundation              */
/* src/boot/translation.ts) so bare `__('text')` works everywhere. We only   */
/* need to populate `window.translatedMessages`. Mail's translation.ts plugin */
/* was DELETED; this side-effect replaces it. Backend method preserved as-is. */
/* -------------------------------------------------------------------------- */

const translations = createResource({
	url: 'suite.mail.api.get_translations',
	cache: 'translations',
	transform: (data) => (window.translatedMessages = data),
})

if (!window.translatedMessages) translations.fetch()
