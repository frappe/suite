import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailTabBar from '@/apps/mail/components/mobile/MailTabBar.vue'

const calls = vi.hoisted(() => ({ search: 0, folders: [] as string[] }))

// Unit tests alias frappe-ui to a stub. The bar and its items are the real
// components here, so a wrong prop name fails the test.
vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  return {
    ...(await original<object>()),
    toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
    MobileNav: (
      await import('../../../../../../node_modules/frappe-ui/src/components/MobileNav/MobileNav.vue')
    ).default,
    MobileNavItem: (
      await import('../../../../../../node_modules/frappe-ui/src/components/MobileNav/MobileNavItem.vue')
    ).default,
    Avatar: defineComponent({ setup: () => () => h('span') }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'a',
    userResource: { data: { accounts: [{ id: 'a' }, { id: 'b' }] } },
    mailboxes: {
      data: [
        { id: 'm-inbox', slug: 'inbox', _name: 'Inbox', role: 'inbox' },
        { id: 'm-receipts', slug: 'receipts', _name: 'Receipts', role: null, icon: 'receipt' },
      ],
    },
    unifiedFolders: {
      data: [
        { slug: 'inbox', name: 'Inbox', role: 'inbox', icon: null },
        { slug: 'sent', name: 'Sent', role: 'sent', icon: null },
      ],
    },
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useMobileSearch: () => ({ openSearch: () => calls.search++ }),
}))
vi.mock('@/platform/area-sidebar', () => ({
  openAreaSidebar: (area: string) => calls.folders.push(area),
}))
vi.mock('@/platform/session', async (original) => {
  const { ref } = await import('vue')
  const session = {
    status: ref('authenticated'),
    user: ref({ id: 'a@suite.test', fullName: 'Ada', avatar: null }),
    onLogout: () => () => {},
  }
  return { ...(await original<object>()), useSession: () => session }
})

const translate = (text: string) => text
vi.stubGlobal('__', translate)

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  calls.search = 0
  calls.folders = []
})

async function mountAt(path: string) {
  const page = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail/account/:accountId/mailbox/:mailbox', name: 'mail-mailbox', component: page },
      { path: '/mail/all/:folder', name: 'mail-unified', component: page },
      { path: '/mail/account/:accountId/profile', name: 'mail-profile', component: page },
    ],
  })
  await router.push(path)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    setup: () => () => h(MailTabBar),
  })
  app.config.globalProperties.__ = translate
  app.use(router)
  app.mount(root)
  await router.isReady()
  await nextTick()
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const items = () =>
    [...root.querySelectorAll<HTMLElement>('[data-slot="mobile-nav-item"]')].map((item) =>
      item.getAttribute('aria-label'),
    )
  const item = (label: string) =>
    root.querySelector<HTMLElement>(`[data-slot="mobile-nav-item"][aria-label="${label}"]`)!
  return { router, items, item }
}

describe("Mail's bottom bar", () => {
  it('holds the folder you are in, Search and your profile, and no other app', async () => {
    const { items } = await mountAt('/mail/account/a/mailbox/receipts')
    expect(items()).toEqual(['Receipts', 'Search', 'Profile'])
  })

  it('opens the folders from the folder you are in', async () => {
    const { item, router } = await mountAt('/mail/account/a/mailbox/receipts')
    item('Receipts').click()
    expect(calls.folders).toEqual(['mail'])
    expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/mailbox/receipts')
  })

  it('names a folder merged across the accounts, and opens the folders from it', async () => {
    const { items, item } = await mountAt('/mail/all/sent')
    expect(items()[0]).toBe('Sent')
    item('Sent').click()
    expect(calls.folders).toEqual(['mail'])
  })

  it('names Starred, and opens the folders from it', async () => {
    const { items, item, router } = await mountAt('/mail/account/a/mailbox/starred')
    expect(items()[0]).toBe('Starred')
    item('Starred').click()
    expect(calls.folders).toEqual(['mail'])
    expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/mailbox/starred')
  })

  it('goes back to the Inbox from Search', async () => {
    const { item, router } = await mountAt('/mail/account/a/mailbox/search')
    item('Inbox').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/mailbox/inbox'),
    )
    expect(calls.folders).toEqual([])
  })

  it('opens Search', async () => {
    const { item } = await mountAt('/mail/account/a/mailbox/inbox')
    item('Search').click()
    expect(calls.search).toBe(1)
  })

  it("opens Mail's profile page from Profile, and goes back to the Inbox from there", async () => {
    const { item, router } = await mountAt('/mail/account/a/mailbox/inbox')
    item('Profile').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/profile'),
    )
    item('Inbox').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/mailbox/inbox'),
    )
    expect(calls.folders).toEqual([])
  })
  it("goes back to every account's Inbox from Profile, when All accounts was chosen", async () => {
    localStorage.setItem('mail-unified', '1')
    try {
      const { item, router } = await mountAt('/mail/account/a/profile')
      item('Inbox').click()
      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/mail/all/inbox'))
    } finally {
      localStorage.removeItem('mail-unified')
    }
  })
})
