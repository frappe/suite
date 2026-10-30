import dayjs from 'dayjs'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import type { Mail } from '@/apps/mail/types'
import { applyRouteMeta } from '@/platform/page-meta'

const query = vi.hoisted(() => ({
  current: {
    data: undefined as Partial<Mail>[] | undefined,
    status: 'pending',
    refetch: async () => {},
  },
}))
vi.mock('@/api', async (original) => ({
  ...(await original<typeof import('@/api')>()),
  useQuery: () => query.current,
  useMutation: () => ({ run: vi.fn() }),
}))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ globalScreenedAddresses: { data: [] } }),
}))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  provideAccountScope: () => ({
    accountId: ref('alice@example.com'),
    account: ref({}),
    identities: ref({ data: [] }),
    screenedAddresses: ref({ data: [] }),
    mailboxIds: ref({}),
  }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: ref(false) }),
  useComposeMail: () => ({}),
  useSettings: () => ({}),
  useTheme: () => ({ dataTheme: ref('light') }),
  useDiscardingDrafts: () => ({
    isHeld: () => false,
    heldDrafts: ref(new Set()),
    takeRestoredDraft: () => undefined,
  }),
}))
vi.mock('@/apps/mail/composables/useScreener', () => ({
  trustableDomains: [],
  useScreener: () => ({ version: ref(0) }),
}))
vi.mock('@/apps/mail/composables/useUnsubscribe', () => ({ useUnsubscribe: () => ({}) }))

let app: App | undefined
const root = document.createElement('div')
afterEach(() => {
  app?.unmount()
  root.remove()
})

it('names a directly fetched conversation after async arrival and when the reused reader changes thread', async () => {
  window.__ = (text: string) => text
  query.current = reactive({ data: undefined, status: 'pending', refetch: async () => {} })
  const props = reactive<{
    mailbox: string
    threadID?: string
    threads: string[]
    marksSeen: boolean
  }>({ mailbox: 'inbox', threadID: 'one', threads: [], marksSeen: false })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  applyRouteMeta({ ...router.currentRoute.value, meta: { title: '[No Subject] | Mail' } })
  // Exercise the reader's real setup and fetch lifecycle without rendering unrelated mail controls.
  const Reader = { ...MailThread, render: () => null }
  app = createApp({ setup: () => () => h(Reader, props) })
  app.use(router)
  app.provide('$user', { data: {} })
  app.provide('$dayjs', dayjs)
  document.body.appendChild(root)
  app.mount(root)
  const message = (thread: string, subject: string) => ({
    id: thread,
    name: thread,
    thread_id: thread,
    subject,
    seen: 1,
    draft: 0,
    from_email: 'bob@example.com',
    recipients: [],
    reply_to: [],
    attachments: [],
    mailboxes: [],
    received_at: '2026-10-30T08:00:00Z',
  })
  query.current.data = [message('one', 'Friday planning')]
  query.current.status = 'success'
  await nextTick()
  await nextTick()
  expect(document.title).toBe('Friday planning | Mail')
  applyRouteMeta({ ...router.currentRoute.value, meta: { title: 'Mail' } })
  expect(document.title).toBe('Friday planning | Mail')

  props.threadID = 'two'
  await nextTick()
  query.current.data = [message('two', 'Travel confirmation')]
  await nextTick()
  await nextTick()
  expect(document.title).toBe('Travel confirmation | Mail')

  props.threadID = 'three'
  await nextTick()
  query.current.data = [message('three', '')]
  await nextTick()
  await nextTick()
  expect(document.title).toBe('[No subject] | Mail')

  applyRouteMeta({ ...router.currentRoute.value, meta: { title: 'Mail' } })
  props.threadID = undefined
  await nextTick()
  await nextTick()
  expect(document.title).toBe('Mail')
})
