import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { searchesAllAccountsFrom, useMobileSearch } from '@/apps/mail/utils/composables'

vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'work', mailboxIds: { inbox: 'inbox-id' } }),
}))
vi.mock('@/apps/mail/router', () => ({ default: {} }))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

// The phone's Search tab, tapped on the page at `path`.
async function tapSearchAt(path: string) {
  const page = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail/account/:accountId/mailbox/:mailbox', name: 'mail-mailbox', component: page },
      { path: '/mail/all/:folder', name: 'mail-unified', component: page },
      {
        path: '/mail/all/:folder/:accountId/:threadID',
        name: 'mail-unified-mail',
        component: page,
      },
    ],
  })
  await router.push(path)
  let search!: ReturnType<typeof useMobileSearch>
  const app = createApp({
    setup() {
      search = useMobileSearch()
      return () => h('div')
    },
  })
  app.use(createPinia()).use(router)
  const root = document.createElement('div')
  app.mount(root)
  cleanup = () => app.unmount()
  await search.openSearch()
  const route = router.currentRoute.value
  return {
    paletteOpen: search.paletteOpen.value,
    onSearchPage: route.name === 'mail-mailbox' && route.params.mailbox === 'search',
    // The palette takes where it looks from the page it opens over, so this is where the
    // search typed into it runs.
    everyAccount: searchesAllAccountsFrom(route),
  }
}

describe('searching on a phone', () => {
  it('looks in every account from All Inboxes', async () => {
    expect(await tapSearchAt('/mail/all/inbox')).toEqual({
      paletteOpen: true,
      onSearchPage: true,
      everyAccount: true,
    })
  })

  it('looks in every account from a mail open in All Inboxes', async () => {
    expect(await tapSearchAt('/mail/all/archive/personal/t1')).toMatchObject({
      onSearchPage: true,
      everyAccount: true,
    })
  })

  it('looks in the one account from its own folder', async () => {
    expect(await tapSearchAt('/mail/account/work/mailbox/inbox-id')).toEqual({
      paletteOpen: true,
      onSearchPage: true,
      everyAccount: false,
    })
  })
})
