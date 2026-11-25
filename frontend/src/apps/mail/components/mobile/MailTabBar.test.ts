import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailTabBar from '@/apps/mail/components/mobile/MailTabBar.vue'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const calls = vi.hoisted(() => ({
  search: 0,
  compose: 0,
  folders: fromPartial<string[]>([]),
  selecting: false,
}))

// Unit tests alias frappe-ui to a stub; the island lands on the body, as it does without Mail's
// overlay layer.
vi.mock('frappe-ui', async (original) => {
  const { defineComponent, h } = await import('vue')
  return {
    ...(await original<object>()),
    toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
    Avatar: defineComponent({ setup: () => () => h('span') }),
    usePortalTarget: () => undefined,
  }
})
// The sprite icon, drawn as its name: which icon a tab shows is what a test reads.
vi.mock('frappe-ui/experimental', async () => {
  const { h } = await import('vue')
  return { Icon: (props: { name: string }) => h('svg', { 'data-icon': props.name }) }
})
vi.mock('@/apps/mail/composables/composeHandoff', () => ({
  openComposePage: () => calls.compose++,
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    accountId: 'a',
    userResource: { data: { accounts: [{ id: 'a' }, { id: 'b' }] } },
    mailboxes: {
      data: [
        { id: 'm-inbox', slug: 'inbox', _name: 'Inbox', role: 'inbox' },
        { id: 'm-receipts', slug: 'receipts', _name: 'Receipts', role: null, icon: 'receipt' },
        { id: 'm-junk', slug: 'spam', _name: 'Spam', role: 'junk' },
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
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return {
    useMobileSearch: () => ({ openSearch: () => calls.search++ }),
    useMobileSelection: () => ({ isMobileSelectionActive: ref(calls.selecting) }),
  }
})
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
  calls.compose = 0
  calls.folders = []
  calls.selecting = false
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
  const nav = () => document.querySelector<HTMLElement>('nav[aria-label="Mail"]')
  const tabs = () => [...(nav()?.querySelectorAll<HTMLElement>('button') ?? [])]
  const items = () => tabs().map((tab) => tab.textContent?.trim())
  const item = (label: string) => tabs().find((tab) => tab.textContent?.trim() === label)!
  const compose = () => document.querySelector<HTMLElement>('button[aria-label="Compose"]')
  return { router, nav, items, item, compose }
}

describe("Mail's bottom bar", () => {
  it('holds the folder you are in, Search and your profile, and no other app', async () => {
    const { items } = await mountAt('/mail/account/a/mailbox/receipts')
    expect(items()).toEqual(['Receipts', 'Search', 'Settings'])
  })

  it("draws the folder's own icon on its tab, Spam's included", async () => {
    const { item } = await mountAt('/mail/account/a/mailbox/spam')
    expect(item('Spam').querySelector('svg')?.dataset.icon).toBe('mail-warning')
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
    item('Settings').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/profile'),
    )
    item('Inbox').click()
    await vi.waitFor(() =>
      expect(router.currentRoute.value.fullPath).toBe('/mail/account/a/mailbox/inbox'),
    )
    expect(calls.folders).toEqual([])
  })
  it('offers Compose in a folder, and not in search results or on the profile page', async () => {
    const { compose, router } = await mountAt('/mail/account/a/mailbox/receipts')
    compose()!.click()
    expect(calls.compose).toBe(1)
    await router.push('/mail/account/a/mailbox/search')
    await nextTick()
    expect(compose()).toBeNull()
    await router.push('/mail/account/a/profile')
    await nextTick()
    expect(compose()).toBeNull()
  })

  it('steps aside while mail is selected', async () => {
    calls.selecting = true
    const { nav, compose } = await mountAt('/mail/account/a/mailbox/inbox')
    expect(nav()).toBeNull()
    expect(compose()).toBeNull()
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
