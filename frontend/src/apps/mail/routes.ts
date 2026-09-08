import type { RouteRecordRaw } from 'vue-router'

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

export const routes: RouteRecordRaw[] = [
	// --- Public (pre-auth) routes -------------------------------------------
	// Nested under LoginLayout, which supplies the Frappe Mail logo, the centered
	// card and the per-route title. Without it these views render as bare,
	// full-bleed forms.
	{
		path: '',
		component: () => import('@/apps/mail/components/LoginLayout.vue'),
		// This wrapper's own full path is bare '/mail' — the same as the root
		// shortcut below — and, being registered first, it wins the matcher tie:
		// without the redirect, '/mail' renders an empty login card instead of
		// the inbox. Redirect exact matches to the shortcut; children
		// ('/mail/login' etc.) are unaffected.
		redirect: { name: 'mail-root-shortcut' },
		children: [
			{
				path: 'signup',
				name: 'mail-signup',
				component: () => import('@/apps/mail/pages/SignupView.vue'),
				meta: { isLogin: true, allowGuest: true },
			},
			{
				path: 'signup/:requestKey',
				name: 'mail-invite-setup',
				component: () => import('@/apps/mail/pages/InviteSetupView.vue'),
				props: true,
				meta: { isLogin: true, allowGuest: true },
			},
			{
				path: 'login',
				name: 'mail-login',
				component: () => import('@/apps/mail/pages/LoginView.vue'),
				meta: { isLogin: true, allowGuest: true },
			},
			{
				path: 'reset-password',
				name: 'mail-forgot-password',
				component: () => import('@/apps/mail/pages/ForgotPasswordView.vue'),
				meta: { isLogin: true, allowGuest: true },
			},
			{
				path: 'reset-password/:requestKey',
				name: 'mail-reset-password',
				component: () => import('@/apps/mail/pages/ResetPasswordView.vue'),
				props: true,
				meta: { isLogin: true, allowGuest: true },
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
			// The merged view with a thread open, so opening a mail keeps you in All Inboxes
			// instead of navigating into the owning account's mailbox. Same component as the
			// list-only route above, mirroring how `mail-mail` reuses MailboxView, and the same
			// three params as `mail-mail` so a row only swaps the route name. accountId is the
			// row's own account: the merged list spans accounts, so the URL has to say which
			// one the thread belongs to rather than relying on whichever is active.
			{
				path: 'all-inboxes/account/:accountId/mailbox/:mailbox/:threadID',
				name: 'mail-all-inboxes-mail',
				component: () => import('@/apps/mail/pages/AllInboxesView.vue'),
				props: true,
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
			// Compose as a page of its own rather than an overlay over the list. `noLayout` keeps
			// the app chrome — and the full-height scroll frame it brings — out of the way, so the
			// composer can own the visible area and decide for itself what scrolls inside it.
			{
				path: 'account/:accountId/compose',
				name: 'mail-compose',
				component: () => import('@/apps/mail/pages/ComposeView.vue'),
				props: true,
				meta: { noLayout: true },
			},
			// Profile as a page rather than a bottom sheet, so the tab behaves like the other
			// three — a route the bar keeps a selected state for. It holds the mobile settings
			// list itself; PWASettings stays for the sidebar and in-thread entry points.
			{
				path: 'account/:accountId/profile',
				name: 'mail-profile',
				component: () => import('@/apps/mail/pages/ProfileView.vue'),
			},
			{
				path: 'account/:accountId/screener',
				name: 'mail-screener',
				component: () => import('@/apps/mail/pages/ScreenerView.vue'),
				props: true,
			},
			// The open sender lives in the URL, as the open thread does: on mobile the preview is a
			// full-screen overlay, so the back gesture has to close it rather than leave the screener.
			// Same component — the param only says which sender is open.
			{
				path: 'account/:accountId/screener/:senderEmail',
				name: 'mail-screener-sender',
				component: () => import('@/apps/mail/pages/ScreenerView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/outbox',
				name: 'mail-outbox',
				component: () => import('@/apps/mail/pages/OutboxView.vue'),
				props: true,
			},
			{
				path: 'account/:accountId/outbox/:submissionId',
				name: 'mail-submission',
				component: () => import('@/apps/mail/pages/SubmissionDetailsView.vue'),
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
				name: 'mail-overview',
				component: () => import('@/apps/mail/pages/dashboard/OverviewView.vue'),
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
				path: 'dashboard/accounts',
				name: 'mail-accounts',
				component: () => import('@/apps/mail/pages/dashboard/AccountsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/invites',
				name: 'mail-invites',
				component: () => import('@/apps/mail/pages/dashboard/AccountsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/accounts/:accountId',
				name: 'mail-account',
				component: () => import('@/apps/mail/pages/dashboard/AccountView.vue'),
				props: true,
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/groups',
				name: 'mail-groups',
				component: () => import('@/apps/mail/pages/dashboard/GroupsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/groups/:groupId',
				name: 'mail-group',
				component: () => import('@/apps/mail/pages/dashboard/GroupView.vue'),
				props: true,
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/mailing-lists',
				name: 'mail-mailing-lists',
				component: () => import('@/apps/mail/pages/dashboard/MailingListsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/mailing-lists/:listId',
				name: 'mail-mailing-list',
				component: () => import('@/apps/mail/pages/dashboard/MailingListView.vue'),
				props: true,
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
