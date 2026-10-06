import type { RouteLocationNormalized } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import {
  INBOX_FOLDER,
  mailboxIdForParam,
  mailboxParam,
  prefersUnified,
  UNIFIED_THREAD_ROUTE,
  unifiedFolderRoute,
} from '@/apps/mail/utils/unifiedFolders'
import { useSessionStore } from '@/boot/session'
import suiteRouter from '@/router'

/**
 * Mail-local guard on the shared suite router: setup-wizard escape, user-data
 * wait, dashboard access control, account resolution, mailbox validation and
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

const buildDefaultRoute = (
  accountId: string,
  mailboxes: { data?: { id: string }[] },
): { name: string; params: Record<string, string> } => {
  const firstMailbox = mailboxes.data?.[0]?.id
  if (firstMailbox) return { name: 'mail-mailbox', params: { accountId, mailbox: firstMailbox } }

  return { name: 'people-address-books', params: { accountId } }
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
    default:
      return defaultRoute
  }
}

/** Every route in Mail's route module is named `mail-*`. */
export const isMailRoute = (route: Pick<RouteLocationNormalized, 'name'>): boolean =>
  typeof route.name === 'string' && route.name.startsWith('mail-')

export const mailGuard = async (to: RouteLocationNormalized) => {
  // Only act on mail routes; let the suite handle everything else.
  if (!isMailRoute(to)) return

  handleSetupWizardEscape()

  // Auth: the suite guard already redirects guests on non-public routes,
  // but public mail routes (login/signup/...) must short-circuit here so
  // we don't trigger user-data resolution for a guest.
  const { isLoggedIn } = useSessionStore()
  if (!isLoggedIn) return

  // Wait for user data.
  const { userResource, mailboxes, resolveAccount, loadUser } = userStore()
  await loadUser()
  const user = userResource.data

  // The Admin Dashboard is Suite Cloud's face on the site: it is for admins, and only on a
  // site connected to one. Mail itself needs neither, just a mailbox.
  const canAdminister = !!user?.is_suite_admin && !!user?.is_suite_cloud_configured

  // No mailbox. A MIME page needs none, and the dashboard is all Mail has for them, if they may
  // have it. Every other Mail page answers with the shell's "Mail is unavailable": the Mail
  // root does, and the dashboard, which carries no rail context, sends them there.
  if (!user?.is_jmap_configured) {
    if (to.name === 'mail-mime-message') return
    if (canAdminister) return to.meta.isDashboard ? undefined : { name: 'mail-overview' }
    if (to.meta.isDashboard) return { name: 'mail-root-shortcut' }
    return
  }

  // Resolve active account. The merged folder's thread route carries the thread's
  // owning account purely to scope the pane (see utils/accountScope) — opening a
  // thread there must not switch the active account out from under the merged list.
  const routeAccountId =
    to.name === UNIFIED_THREAD_ROUTE ? undefined : (to.params.accountId as string | undefined)
  resolveAccount(user?.accounts, routeAccountId)
  const accountId = userStore().accountId

  // Wait for mailbox list. The fetch rejects when the mail server is temporarily down;
  // swallow that so navigation still completes — otherwise the initial navigation aborts,
  // the app never mounts and the user gets a blank page instead of the unavailable banner.
  await mailboxes.refetch().catch(() => {})
  const defaultRoute = buildDefaultRoute(accountId, mailboxes)

  if (to.meta.isDashboard && !canAdminister) return defaultRoute

  // Validate mailbox param for mailbox routes. The param is the folder's slug (see
  // utils/unifiedFolders), though an id still opens it — links made before folders were named,
  // and every link built from an id — and is answered with the slug.
  if (to.name === 'mail-mailbox' || to.name === 'mail-mail') {
    const param = to.params.mailbox as string
    const mailboxId = mailboxIdForParam(param, mailboxes.data)

    // The screener mailbox has its own dedicated view (Allow/Block UI). Redirect its
    // plain mailbox URL to the screener route so direct navigation and reloads land on
    // the screener view, matching the sidebar link (which already targets 'mail-screener').
    const screenerId = userStore().mailboxIds.screener
    if (screenerId && mailboxId === screenerId)
      return { name: 'mail-screener', params: { accountId } }

    // With no mailbox list (fetch failed above) the param can't be validated — keep the
    // requested route rather than bouncing the user off the URL they asked for.
    const mailboxExists =
      !mailboxes.data ||
      mailboxes.data.some((m: { id: string }) => m.id === mailboxId) ||
      ['starred', 'search'].includes(mailboxId)
    if (!mailboxExists) return defaultRoute

    const canonical = mailboxParam(mailboxId, mailboxes.data)
    if (canonical !== param)
      return {
        name: to.name,
        params: { ...to.params, mailbox: canonical },
        query: to.query,
        hash: to.hash,
        replace: true,
      }
  }

  // /mail itself reopens "All accounts" for a reader who last chose it, while they still have
  // more than one account to merge.
  if (to.name === 'mail-root-shortcut' && prefersUnified() && (user?.accounts?.length ?? 0) > 1)
    return { ...unifiedFolderRoute(INBOX_FOLDER), query: to.query }

  // Expand shortcut routes to their full account-scoped equivalents. The
  // query rides along — it can carry a compose deep link (?compose=1&to=).
  if (to.meta.shortcut)
    return { ...resolveShortcut(to.name, to.params, accountId, defaultRoute), query: to.query }

  // Login pages redirect already-authenticated users to their mailbox.
  if (to.meta.isLogin) return defaultRoute
}

export default suiteRouter
