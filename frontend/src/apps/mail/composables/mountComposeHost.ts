import { h, render, type AppContext } from 'vue'

import { api, client } from '@/api'
import ComposeHost from '@/apps/mail/components/ComposeHost.vue'
import MailScope from '@/apps/mail/components/MailScope.vue'
import { userStore } from '@/apps/mail/stores/user'
import { useComposeMail } from '@/apps/mail/utils/composables'

/** Mail's composer on another app's page, as `useMailCompose` (the package root) mounts it. */
export interface MountedComposeHost {
  /**
   * Opens the composer addressed to `to`, less every address that is the reader's own in Mail.
   * With no Mail account to write from, it hands the same people to the device's mail app instead.
   */
  compose(to: readonly string[]): Promise<void>
  unmount(): void
}

/** Every address that is the reader's in Mail: each account's own, and each of its identities. */
async function ownAddresses(): Promise<Set<string>> {
  const accounts = userStore().userResource.data?.accounts ?? []
  const identities = await Promise.all(
    accounts.map((account) =>
      client
        .query(api.mail.identities.list, { account: account.id }, { cache: 'prefer' })
        .catch(() => []),
    ),
  )
  return new Set(
    [
      ...accounts.map((account) => account._name),
      ...identities.flat().map((id) => id.email),
    ].flatMap((email) => (email ? [email.toLowerCase()] : [])),
  )
}

/**
 * Mounts Mail's `ComposeHost` in `context`, the calling app's, so its router, stores and providers
 * apply, inside `MailScope` for what Mail's layout gives it at home: the `$user` resource, and an
 * overlay layer that carries Mail's styles for the window to teleport into.
 */
export function mountComposeHost(context: AppContext): MountedComposeHost {
  const container = document.createElement('div')
  const vnode = h(
    MailScope,
    { overlay: true },
    { default: () => h(ComposeHost), loading: () => null },
  )
  vnode.appContext = context
  render(vnode, container)
  let unmounted = false
  const store = userStore()
  const { requestCompose } = useComposeMail()
  return {
    async compose(to) {
      // Mail may not have been opened this session: its user, and with it the active account,
      // loads now.
      if (!store.userResource.data) await store.loadUser()
      const own = await ownAddresses()
      // The page may have gone while that loaded: a request left now would open the window the
      // next time Mail does.
      if (unmounted) return
      const others = to.filter((email) => !own.has(email.toLowerCase()))
      if (!store.accountId) {
        window.open(`mailto:${others.map(encodeURIComponent).join(',')}`, '_self')
        return
      }
      requestCompose({ to: others.map((email) => ({ email })) })
    },
    unmount() {
      unmounted = true
      render(null, container)
    },
  }
}
