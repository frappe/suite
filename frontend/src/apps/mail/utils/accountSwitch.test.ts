import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useAccountSwitch } from '@/apps/mail/utils/composables'

vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/stores/user', () => ({
  SECONDARY_MAILBOX_ROLES: [],
  userStore: () => ({ accountId: 'alice', mailboxes: { data: [] } }),
}))
vi.mock('@/shell/settings/useSettingsDialog', () => ({ openSettings: () => {} }))
vi.mock('@/stores/root', () => ({ useRootStore: () => ({}) }))

const page = { render: () => null }
const routes = [
  { path: '/account/:accountId/mailbox/:mailbox', name: 'mail-mailbox', component: page },
  { path: '/account/:accountId/mailbox/:mailbox/:threadID', name: 'mail-mail', component: page },
  { path: '/account/:accountId/outbox', name: 'mail-outbox', component: page },
]

let app: App | undefined
afterEach(() => app?.unmount())

// The switcher as the sidebar holds it, on a page of the active account.
const switcherAt = async (path: string) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  let switcher!: ReturnType<typeof useAccountSwitch>
  app = createApp(
    defineComponent({
      setup: () => {
        switcher = useAccountSwitch()
        return () => null
      },
    }),
  )
  app.use(router)
  app.mount(document.createElement('div'))
  return {
    switchAccount: async (id: string) => {
      await switcher.switchAccount(id)
      // Not every branch hands back its navigation: let any that started finish.
      await new Promise((settled) => setTimeout(settled))
      return router.currentRoute.value.fullPath
    },
  }
}

describe('switching accounts', () => {
  // Thread ids are the mail server's, counted per account: Bob's "t7" is not Alice's.
  it('leaves an open thread for the same folder in the other account', async () => {
    const { switchAccount } = await switcherAt('/account/alice/mailbox/receipts/t7')
    expect(await switchAccount('bob')).toBe('/account/bob/mailbox/receipts')
  })

  it('stays in the same folder from a folder', async () => {
    const { switchAccount } = await switcherAt('/account/alice/mailbox/receipts')
    expect(await switchAccount('bob')).toBe('/account/bob/mailbox/receipts')
  })

  it("stays on another account's page of the same kind", async () => {
    const { switchAccount } = await switcherAt('/account/alice/outbox')
    expect(await switchAccount('bob')).toBe('/account/bob/outbox')
  })

  it('keeps the thread open when picking the account already shown', async () => {
    const { switchAccount } = await switcherAt('/account/alice/mailbox/receipts/t7')
    expect(await switchAccount('alice')).toBe('/account/alice/mailbox/receipts/t7')
  })
})
