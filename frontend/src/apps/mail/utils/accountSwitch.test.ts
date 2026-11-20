import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useAccountSwitch } from '@/apps/mail/utils/composables'

vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/stores/user', () => ({
  SECONDARY_MAILBOX_ROLES: [],
  userStore: () => ({ accountId: 'alice', mailboxes: { data: [] } }),
}))

const page = { render: () => null }
const routes = [
  { path: '/account/:accountId/mailbox/:mailbox', name: 'mail-mailbox', component: page },
  { path: '/account/:accountId/mailbox/:mailbox/:threadID', name: 'mail-mail', component: page },
  { path: '/account/:accountId/outbox', name: 'mail-outbox', component: page },
  { path: '/account/:accountId/profile', name: 'mail-profile', component: page },
  { path: '/all/:folder', name: 'mail-unified', component: page },
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
      return router.currentRoute.value.fullPath
    },
    switchToAll: async () => {
      await switcher.switchToAll()
      await router.isReady()
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

describe('switching to every account at once', () => {
  afterEach(() => localStorage.clear())

  it('opens the same folder across every account from a folder', async () => {
    const { switchToAll } = await switcherAt('/account/alice/mailbox/inbox')
    expect(await switchToAll()).toBe('/all/inbox')
  })

  // On a phone the accounts are picked on Profile. Picking one stays there, so picking all of them
  // does too; the Inbox tab then opens the merged Inbox.
  it('stays on Profile, as picking an account does', async () => {
    const { switchAccount, switchToAll } = await switcherAt('/account/alice/profile')
    expect(await switchToAll()).toBe('/account/alice/profile')
    expect(localStorage.getItem('mail-unified')).toBe('1')
    expect(await switchAccount('bob')).toBe('/account/bob/profile')
    expect(localStorage.getItem('mail-unified')).toBeNull()
  })
})
