import type { RouteLocationNormalized, RouteParamsGeneric, RouteRecordRaw } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import { openedMailboxId } from '@/apps/mail/utils/unifiedFolders'

// Installs Mail's guard on the suite router. The suite router loads this module once, when a
// Mail route first opens, so the guard is in place before any Mail page resolves.
import '@/apps/mail/runtime'

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
 * The authed routes take their frame from the Mail area group and render in
 * the shell. The public routes set `frame: 'none'`, so they stay outside it
 * [T010].
 */

// An account's folder is named by its slug in the URL (`mailbox/sent`), but MailboxView works in
// mailbox ids, so the param is translated on the way in. The guard has already waited for the
// account's mailboxes and turned an id in the URL into the slug (see ./router.ts), and MailLayout
// moves the URL along when a rename changes the slug.
const mailboxProps = (route: RouteLocationNormalized) => ({
  ...route.params,
  mailbox: openedMailboxId(
    route.params.accountId,
    route.params.mailbox,
    userStore().mailboxes.data,
  ),
})

// The People path of an old Mail contacts or address-books URL. Without an account it is People's
// shortcut, which opens the active one.
const peopleLocation = (list: 'contacts' | 'address-books', params: RouteParamsGeneric) => {
  const item = params.contactName ?? params.addressBookName
  const path = params.accountId ? `/people/account/${params.accountId}/${list}` : `/people/${list}`
  return item ? `${path}/${item}` : path
}

// Lightweight placeholder used by shortcut routes — the mail guard intercepts
// them and redirects before any component ever mounts.
const ShortcutRedirect = { render: () => null }

// The MIME page and the Admin Dashboard need no mail account, so the suite router loads them
// without the Mail capability. They carry no rail context (`area` unset), so the shell does not
// answer them with "Mail is unavailable". The mail guard still decides who may see the dashboard.
const dashboardMeta = { isDashboard: true, area: undefined }

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
    meta: { frame: 'none' },
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
    meta: { noLayout: true, allowGuest: true, frame: 'none', area: undefined },
  },

  // --- Authed routes (nested under MailLayout) ----------------------------
  {
    path: '',
    component: () => import('@/apps/mail/pages/MailLayout.vue'),
    children: [
      // "All accounts": one folder merged across every account, named by its slug since mailbox
      // ids are per account (see utils/unifiedFolders).
      {
        path: 'all/:folder',
        name: 'mail-unified',
        component: () => import('@/apps/mail/pages/UnifiedFolderView.vue'),
        props: true,
      },
      // The merged view with a thread open, so opening a mail keeps you in the merged folder
      // instead of navigating into the owning account's mailbox. Same component as the list-only
      // route above, mirroring how `mail-mail` reuses MailboxView. accountId is the row's own
      // account: the merged list spans accounts, so the URL has to say which one the thread
      // belongs to rather than relying on whichever is active. The folder needs no second naming:
      // in that account it is the one with the folder's slug.
      {
        path: 'all/:folder/account/:accountId/:threadID',
        name: 'mail-unified-mail',
        component: () => import('@/apps/mail/pages/UnifiedFolderView.vue'),
        props: true,
      },
      // The merged Inbox's old address, kept so bookmarks still land.
      { path: 'all-inboxes', redirect: { name: 'mail-unified', params: { folder: 'inbox' } } },
      {
        path: 'all-inboxes/account/:accountId/mailbox/:mailbox/:threadID',
        redirect: (to) => ({
          name: 'mail-unified-mail',
          params: { folder: 'inbox', accountId: to.params.accountId, threadID: to.params.threadID },
        }),
      },
      {
        path: 'account/:accountId/mailbox/:mailbox',
        name: 'mail-mailbox',
        component: () => import('@/apps/mail/pages/MailboxView.vue'),
        props: mailboxProps,
      },
      {
        path: 'account/:accountId/mailbox/:mailbox/:threadID',
        name: 'mail-mail',
        component: () => import('@/apps/mail/pages/MailboxView.vue'),
        props: mailboxProps,
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
      // list itself.
      {
        path: 'account/:accountId/profile',
        name: 'mail-profile',
        component: () => import('@/apps/mail/pages/ProfileView.vue'),
      },
      // The Screener had a page of its own; screened mail now waits in the Inbox, so an old link
      // to it — or to one of its senders — lands there.
      {
        path: 'account/:accountId/screener/:senderEmail?',
        redirect: (to) => ({
          name: 'mail-mailbox',
          params: { accountId: to.params.accountId, mailbox: 'inbox' },
        }),
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
      // Contacts and address books moved to People. Old links land there.
      {
        path: 'account/:accountId/address-books/:addressBookName?',
        redirect: (to) => peopleLocation('address-books', to.params),
      },
      {
        path: 'account/:accountId/contacts/:contactName?',
        redirect: (to) => peopleLocation('contacts', to.params),
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
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/domains',
        name: 'mail-domains',
        component: () => import('@/apps/mail/pages/dashboard/DomainsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/domains/:domainId',
        name: 'mail-domain',
        component: () => import('@/apps/mail/pages/dashboard/DomainView.vue'),
        props: true,
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/dmarc',
        name: 'mail-dmarc-reports',
        component: () => import('@/apps/mail/pages/dashboard/DmarcReportsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/dmarc/:reportId',
        name: 'mail-dmarc-report',
        component: () => import('@/apps/mail/pages/dashboard/DmarcReportView.vue'),
        props: true,
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/tls',
        name: 'mail-tls-reports',
        component: () => import('@/apps/mail/pages/dashboard/TlsReportsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/tls/:reportId',
        name: 'mail-tls-report',
        component: () => import('@/apps/mail/pages/dashboard/TlsReportView.vue'),
        props: true,
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/accounts',
        name: 'mail-accounts',
        component: () => import('@/apps/mail/pages/dashboard/AccountsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/invites',
        name: 'mail-invites',
        component: () => import('@/apps/mail/pages/dashboard/AccountsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/accounts/:accountId',
        name: 'mail-account',
        component: () => import('@/apps/mail/pages/dashboard/AccountView.vue'),
        props: true,
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/groups',
        name: 'mail-groups',
        component: () => import('@/apps/mail/pages/dashboard/GroupsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/groups/:groupId',
        name: 'mail-group',
        component: () => import('@/apps/mail/pages/dashboard/GroupView.vue'),
        props: true,
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/mailing-lists',
        name: 'mail-mailing-lists',
        component: () => import('@/apps/mail/pages/dashboard/MailingListsView.vue'),
        meta: dashboardMeta,
      },
      {
        path: 'dashboard/mailing-lists/:listId',
        name: 'mail-mailing-list',
        component: () => import('@/apps/mail/pages/dashboard/MailingListView.vue'),
        props: true,
        meta: dashboardMeta,
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
        redirect: (to) => peopleLocation('address-books', to.params),
      },
      {
        path: 'contacts/:contactName?',
        redirect: (to) => peopleLocation('contacts', to.params),
      },
    ],
  },
]
