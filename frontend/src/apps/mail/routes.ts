import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'

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
 *
 * The pages of an account sit under `a/:account`, the user's number for it, and the suite
 * history shows whatever follows in the URL's fragment: `a/0/inbox` here is /mail/a/0/#inbox
 * in the address bar (see @/router/fragmentHistory). A mailbox is named there by its role or,
 * for a folder of the user's own, its name; see utils/locations for both.
 */

// The views work in JMAP ids, so they are not handed the account's number: MailLayout gives
// them its id, and a mailbox's, alongside the params here.
const viewParams = ({ params: { account, ...params } }: RouteLocationNormalized) => params

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
			// The merged list of every account's inbox. It is the same list under any account, which
			// is only the one that stays active beside it.
			{
				path: 'a/:account/all',
				name: 'mail-all-inboxes',
				component: () => import('@/apps/mail/pages/AllInboxesView.vue'),
			},
			// The merged view with a thread open, so opening a mail keeps you in All Inboxes
			// instead of navigating into the owning account's mailbox. Same component as the
			// list-only route above, mirroring how `mail-mail` reuses MailboxView. The account here
			// is the thread's own: the merged list spans accounts, so the URL has to say which
			// one the thread belongs to rather than relying on whichever is active.
			{
				path: 'a/:account/all/:threadID',
				name: 'mail-all-inboxes-mail',
				component: () => import('@/apps/mail/pages/AllInboxesView.vue'),
				props: viewParams,
			},
			// A mailbox by its role (inbox, sent, …), and the two lists that are not mailboxes
			// (starred, search). One the account has not got opens a page saying so.
			{
				path: 'a/:account/:mailbox',
				name: 'mail-mailbox',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/:mailbox/:threadID',
				name: 'mail-mail',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: viewParams,
			},
			// A folder of the user's own, by its name. Routes apart from the two above so that a
			// folder called Sent is not the Sent mailbox.
			{
				path: 'a/:account/mailbox/:mailbox',
				name: 'mail-folder',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/mailbox/:mailbox/:threadID',
				name: 'mail-folder-mail',
				component: () => import('@/apps/mail/pages/MailboxView.vue'),
				props: viewParams,
			},
			// Compose as a page of its own rather than an overlay over the list. `noLayout` keeps
			// the app chrome — and the full-height scroll frame it brings — out of the way, so the
			// composer can own the visible area and decide for itself what scrolls inside it.
			{
				path: 'a/:account/compose',
				name: 'mail-compose',
				component: () => import('@/apps/mail/pages/ComposeView.vue'),
				props: viewParams,
				meta: { noLayout: true },
			},
			// Profile as a page rather than a bottom sheet, so the tab behaves like the other
			// three — a route the bar keeps a selected state for. It holds the mobile settings
			// list itself; PWASettings stays for the sidebar and in-thread entry points.
			{
				path: 'a/:account/profile',
				name: 'mail-profile',
				component: () => import('@/apps/mail/pages/ProfileView.vue'),
			},
			{
				path: 'a/:account/screener',
				name: 'mail-screener',
				component: () => import('@/apps/mail/pages/ScreenerView.vue'),
				props: viewParams,
			},
			// The open sender lives in the URL, as the open thread does: on mobile the preview is a
			// full-screen overlay, so the back gesture has to close it rather than leave the screener.
			// Same component — the param only says which sender is open.
			{
				path: 'a/:account/screener/:senderEmail',
				name: 'mail-screener-sender',
				component: () => import('@/apps/mail/pages/ScreenerView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/outbox',
				name: 'mail-outbox',
				component: () => import('@/apps/mail/pages/OutboxView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/outbox/:submissionId',
				name: 'mail-submission',
				component: () => import('@/apps/mail/pages/SubmissionDetailsView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/address-books/',
				name: 'mail-address-books',
				component: () => import('@/apps/mail/pages/AddressBooksView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/address-books/:addressBookName',
				name: 'mail-address-book',
				component: () => import('@/apps/mail/pages/AddressBookView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/contacts/',
				name: 'mail-contacts',
				component: () => import('@/apps/mail/pages/ContactsView.vue'),
				props: viewParams,
			},
			{
				path: 'a/:account/contacts/:contactName',
				name: 'mail-contact',
				component: () => import('@/apps/mail/pages/ContactView.vue'),
				props: viewParams,
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
				path: 'dashboard/dmarc',
				name: 'mail-dmarc-reports',
				component: () => import('@/apps/mail/pages/dashboard/DmarcReportsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/dmarc/:reportId',
				name: 'mail-dmarc-report',
				component: () => import('@/apps/mail/pages/dashboard/DmarcReportView.vue'),
				props: true,
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/tls',
				name: 'mail-tls-reports',
				component: () => import('@/apps/mail/pages/dashboard/TlsReportsView.vue'),
				meta: { isDashboard: true },
			},
			{
				path: 'dashboard/tls/:reportId',
				name: 'mail-tls-report',
				component: () => import('@/apps/mail/pages/dashboard/TlsReportView.vue'),
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
				path: 'a/:account?',
				name: 'mail-account-shortcut',
				component: ShortcutRedirect,
				meta: { shortcut: true },
			},
			// A mailbox by its id, for a link made where its name is not known: a push
			// notification, a row of another account. Lands on the mailbox's own address.
			{
				path: 'a/:account/id/:mailbox/:threadID?',
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
