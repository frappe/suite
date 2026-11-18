import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useFollowOpenFolder } from '@/apps/mail/composables/useFollowOpenFolder'
import type { MailboxData } from '@/apps/mail/types'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

// The active account and its folder list, as the user store holds them.
const store = vi.hoisted(() => ({
  current: { accountId: '', mailboxes: { data: undefined as MailboxData[] | undefined } },
}))
vi.mock('@/apps/mail/stores/user', () => ({
  SECONDARY_MAILBOX_ROLES: [],
  userStore: () => store.current,
}))

const folder = (id: string, slug: string) => fromPartial<MailboxData>({ id, slug, _name: slug })
const akashFolders = [folder('a1', 'inbox'), folder('a2', 'support')]
const suiteFolders = [folder('b1', 'inbox')]

const page = { render: () => null }
const routes = [
  { path: '/account/:accountId?', name: 'mail-account-shortcut', component: page },
  { path: '/account/:accountId/mailbox/:mailbox', name: 'mail-mailbox', component: page },
  { path: '/account/:accountId/mailbox/:mailbox/:threadID', name: 'mail-mail', component: page },
]

let app: App | undefined
afterEach(() => app?.unmount())

// Mail's layout, open at `path` in the account `accountId` with its `folders`.
const openAt = async (path: string, accountId: string, folders: MailboxData[]) => {
  store.current = reactive({ accountId, mailboxes: { data: folders } })
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  app = createApp(
    defineComponent({
      setup: () => {
        useFollowOpenFolder()
        return () => null
      },
    }),
  )
  app.use(router)
  app.mount(document.createElement('div'))
  const settle = async () => {
    await nextTick()
    await new Promise((settled) => setTimeout(settled))
    return router.currentRoute.value.fullPath
  }
  await settle()
  return settle
}

describe('the open folder in the URL', () => {
  // A switch to another account turns the folder list over before the URL follows; the old
  // account's folder is not in the new list, and was taken for deleted.
  it("is left alone while the list turns to another account's", async () => {
    const settle = await openAt('/account/ih/mailbox/support/t7', 'ih', akashFolders)
    store.current.accountId = 'q9'
    store.current.mailboxes.data = suiteFolders
    expect(await settle()).toBe('/account/ih/mailbox/support/t7')
  })

  it("leaves for the account's default folder when the folder is deleted", async () => {
    const settle = await openAt('/account/ih/mailbox/support', 'ih', akashFolders)
    store.current.mailboxes.data = [folder('a1', 'inbox')]
    expect(await settle()).toBe('/account/ih')
  })
})
