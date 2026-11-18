import { providePortalTarget } from 'frappe-ui'
import { defineComponent, h, onScopeDispose, provide, render, type AppContext } from 'vue'

import ComposeHost from '@/apps/mail/components/ComposeHost.vue'
import { userStore } from '@/apps/mail/stores/user'
import { useComposeMail } from '@/apps/mail/utils/composables'

import '@/apps/mail/styles.css'

/**
 * Mail's composer over another app's page, for `useMailCompose` (see the package root). It is
 * Mail's own `ComposeHost`, given what Mail's layout gives it at home: the `$user` resource, and an
 * overlay layer that carries Mail's styles, for the window to teleport into.
 */
const OtherAppComposeHost = defineComponent({
  name: 'MailComposeHost',
  setup() {
    const { userResource } = userStore()
    provide('$user', userResource)
    const overlayLayer = document.createElement('div')
    overlayLayer.className = 'mail-app'
    document.body.append(overlayLayer)
    providePortalTarget(overlayLayer)
    onScopeDispose(() => overlayLayer.remove())
    // As Mail's layout does, nothing mounts until the user is known: the composer reads their
    // account, identities and limits from it.
    return () => (userResource.data?.name ? h(ComposeHost) : null)
  },
})

export interface MailComposeHost {
  compose(to: readonly string[]): void
  unmount(): void
}

/** Mounts the host in `context`, the calling app's, so its router, stores and providers apply. */
export function mountComposeHost(context: AppContext): MailComposeHost {
  const container = document.createElement('div')
  const vnode = h(OtherAppComposeHost)
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
