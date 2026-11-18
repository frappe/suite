import { h, render, type AppContext } from 'vue'

import ComposeHost from '@/apps/mail/components/ComposeHost.vue'
import MailScope from '@/apps/mail/components/MailScope.vue'
import { useComposeMail } from '@/apps/mail/utils/composables'

/** Mail's composer on another app's page, as `useMailCompose` (the package root) mounts it. */
export interface MountedComposeHost {
  /** Opens the composer addressed to `to`. */
  compose(to: readonly string[]): void
  unmount(): void
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
  const { requestCompose } = useComposeMail()
  return {
    // Mail may not have been opened this session, so its user, and with it the active account,
    // may still be loading: the host picks the request up once it has them and mounts.
    compose: (to) => requestCompose({ to: to.map((email) => ({ email })) }),
    unmount: () => render(null, container),
  }
}
