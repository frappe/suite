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
 * Name mapping from the standalone app:
 *   SignUp              -> mail-signup
 *   InviteSetup         -> mail-invite-setup
 *   Login               -> mail-login
 *   ForgotPassword      -> mail-forgot-password
 *   ResetPassword       -> mail-reset-password
 *   Mailbox             -> mail-mailbox
 *   Mail                -> mail-mail
 *   AddressBooks        -> mail-address-books
 *   AddressBook         -> mail-address-book
 *   Contacts            -> mail-contacts
 *   Contact             -> mail-contact
 *   MailExchanges       -> mail-exchanges
 *   MailExchange        -> mail-exchange
 *   MimeMessage         -> mail-mime-message
 *   Domains             -> mail-domains
 *   Domain              -> mail-domain
 *   Members             -> mail-members
 *   Invites             -> mail-invites
 *   RootShortcut        -> mail-root-shortcut
 *   AccountShortcut     -> mail-account-shortcut
 *   MailboxShortcut     -> mail-mailbox-shortcut
 *   AddressBooksShortcut-> mail-address-books-shortcut
 *   ContactsShortcut    -> mail-contacts-shortcut
 *
 * Public (pre-auth) routes carry `meta.isPublic: true` so the suite router's
 * global auth guard does not redirect guests to /login. They sit OUTSIDE the
 * MailLayout (which provides $user/$dayjs/$socket) because they don't need
 * those injects. All authed routes nest under MailLayout.
 */

// Lightweight placeholder used by shortcut routes — the mail guard intercepts
// them and redirects before any component ever mounts.
const ShortcutRedirect = { render: () => null }

export const routes: RouteRecordRaw[] = [
	// --- Public (pre-auth) routes -------------------------------------------
	{
		path: 'signup',
		name: 'mail-signup',
		component: () => import('@/apps/mail/pages/SignupView.vue'),
		meta: { isLogin: true, isPublic: true },
	},
	{
		path: 'signup/:requestKey',
		name: 'mail-invite-setup',
		component: () => import('@/apps/mail/pages/InviteSetupView.vue'),
		props: true,
		meta: { isLogin: true, isPublic: true },
	},
	{
		path: 'login',
		name: 'mail-login',
		component: () => import('@/apps/mail/pages/LoginView.vue'),
		meta: { isLogin: true, isPublic: true },
	},
	{
		path: 'reset-password',
		name: 'mail-forgot-password',
		component: () => import('@/apps/mail/pages/ForgotPasswordView.vue'),
		meta: { isLogin: true, isPublic: true },
	},
	{
		path: 'reset-password/:requestKey',
		name: 'mail-reset-password',
		component: () => import('@/apps/mail/pages/ResetPasswordView.vue'),
		props: true,
		meta: { isLogin: true, isPublic: true },
	},
	// A guest must be able to reach a public MIME message view.
	{
		path: 'mime-message/:id',
		name: 'mail-mime-message',
		component: () => import('@/apps/mail/pages/MimeMessageView.vue'),
		props: true,
		meta: { noLayout: true, isPublic: true },
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
