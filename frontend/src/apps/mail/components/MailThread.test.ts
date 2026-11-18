import dayjs from 'dayjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, createBlock, h, nextTick, openBlock, reactive, ref, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import type { Mail } from '@/apps/mail/types'
import type { PrintedMessage } from '@/apps/mail/utils/printMail'
import { applyRouteMeta } from '@/platform/page-meta'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

const query = vi.hoisted(() => ({
  current: {
    data: fromPartial<Partial<Mail>[] | undefined>(undefined),
    status: 'pending',
    refetch: async () => {},
  },
}))
// Every get_thread the pane sends: a read goes out each time its input turns to a new value, as the
// real observer's does.
const threadReads = vi.hoisted(() => new Array<unknown>())
vi.mock('@/api', async (original) => {
  const actual = await original<typeof import('@/api')>()
  const { watch } = await import('vue')
  return {
    ...actual,
    useQuery: (reference: unknown, input: () => unknown) => {
      if (reference === actual.api.mail.threads.get)
        watch(
          () => JSON.stringify(input()),
          (asked) => {
            if (asked !== 'false') threadReads.push(JSON.parse(asked))
          },
          { immediate: true, flush: 'sync' },
        )
      return query.current
    },
    useMutation: () => ({ run: vi.fn() }),
  }
})
// The print dialog is the browser's; what the thread hands it is what these tests read.
const printing = vi.hoisted(() => ({
  printMessages: vi.fn<(subject: string, messages: readonly PrintedMessage[]) => void>(),
}))
vi.mock('@/apps/mail/utils/printMail', () => printing)
// The print chord is ⌘P on a Mac and Ctrl+P elsewhere.
const platform = vi.hoisted(() => ({ mac: false }))
vi.mock('@/apps/mail/utils', async (original) => ({
  ...(await original<typeof import('@/apps/mail/utils')>()),
  get isMac() {
    return platform.mac
  },
}))
// The reader's own addresses: their own mail is never held back.
const own = vi.hoisted(() => ({ identities: new Array<{ email: string }>() }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ globalScreenedAddresses: { data: [] } }),
}))
vi.mock('@/apps/mail/utils/accountScope', () => ({
  provideAccountScope: () => ({
    accountId: ref('alice@example.com'),
    account: ref({}),
    identities: ref({ data: own.identities }),
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
vi.mock('@/apps/mail/composables/useMessageReactions', () => ({
  useMessageReactions: () => ({ reactionsOn: () => [], react: () => {} }),
}))

let app: App | undefined
const root = document.createElement('div')
afterEach(() => {
  app?.unmount()
  root.remove()
  document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove())
  printing.printMessages.mockClear()
  threadReads.length = 0
  platform.mac = false
  own.identities = []
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

describe('a thread the list may not hold', () => {
  // The pane as a list mounts it: the open thread's row, if the list has one, comes with the list.
  const list = reactive<{ loading: boolean; messages?: Partial<Mail>[] }>({ loading: true })
  const open = async () => {
    window.__ = (text: string) => text
    list.loading = true
    list.messages = undefined
    query.current = reactive({ data: undefined, status: 'pending', refetch: async () => {} })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
    })
    const Reader = { ...MailThread, render: () => null }
    // Rendered as a compiled template renders it (MailboxView's): its changed props (patch flag 8)
    // set one by one, in the order they are written there.
    app = createApp({
      setup: () => () => (
        openBlock(),
        createBlock(
          Reader,
          {
            mailbox: 'inbox',
            threadID: 'one',
            threads: [],
            threadsLoading: list.loading,
            messages: list.messages,
            marksSeen: false,
          },
          null,
          8,
          ['threadsLoading', 'messages'],
        )
      ),
    })
    app.use(router)
    app.provide('$user', { data: {} })
    app.provide('$dayjs', dayjs)
    document.body.appendChild(root)
    app.mount(root)
    await nextTick()
  }

  it('waits for the list, then asks for the thread when the list came without it', async () => {
    await open()
    expect(threadReads).toEqual([])

    list.loading = false
    await nextTick()
    expect(threadReads).toEqual([expect.objectContaining({ thread_id: 'one' })])
  })

  it('never asks for the thread when the list lands holding it', async () => {
    await open()
    list.loading = false
    list.messages = [
      {
        id: 'one',
        name: 'one',
        thread_id: 'one',
        subject: 'Friday planning',
        seen: 1,
        draft: 0,
        from_email: 'bob@example.com',
        recipients: [],
        reply_to: [],
        attachments: [],
        mailboxes: [],
        received_at: '2026-10-30T08:00:00Z',
      },
    ]
    await nextTick()
    await nextTick()
    expect(threadReads).toEqual([])
  })
})

describe('printing the conversation', () => {
  const mail = (name: string, fields: Partial<Mail> = {}) => ({
    id: name,
    name,
    thread_id: 'invoice',
    subject: 'Invoice for October',
    seen: 1,
    draft: 0,
    from_name: 'Bob Lee',
    from_email: 'bob@example.com',
    recipients: [{ type: 'To', email: 'alice@example.com', display_name: 'Alice' }],
    reply_to: [],
    attachments: [],
    mailboxes: [],
    html_body: '<p>Here it is.</p>',
    received_at: '2026-10-30T08:00:00Z',
    ...fields,
  })
  const conversation = [
    mail('question'),
    mail('answer', {
      from_name: 'Alice',
      from_email: 'alice@example.com',
      recipients: [
        { type: 'To', email: 'bob@example.com', display_name: 'Bob Lee' },
        { type: 'Bcc', email: 'cy@example.com', display_name: 'Cy' },
      ],
      html_body: '<p>Thanks.</p>',
      received_at: '2026-10-30T09:00:00Z',
    }),
    mail('unsent', { from_email: 'alice@example.com', draft: 1, html_body: '<p>Draft</p>' }),
  ]

  const open = async ({ readonly = false } = {}) => {
    window.__ = (text: string) => text
    query.current = reactive({ data: conversation, status: 'success', refetch: async () => {} })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:pathMatch(.*)*', name: 'mail-thread', component: { render: () => null } },
      ],
    })
    await router.push('/mail/inbox/invoice')
    const Reader = { ...MailThread, render: () => null }
    app = createApp({
      setup: () => () =>
        h(Reader, {
          mailbox: 'inbox',
          threadID: 'invoice',
          threads: [],
          marksSeen: false,
          readonly,
        }),
    })
    app.use(router)
    app.provide('$user', { data: {} })
    app.provide('$dayjs', dayjs)
    document.body.appendChild(root)
    app.mount(root)
    await nextTick()
    await nextTick()
  }
  // Says whether the browser was kept from printing the page itself.
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { key: 'p', cancelable: true, ...init })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  const printedMessages = () => printing.printMessages.mock.calls[0]?.[1]

  it('prints every sent and received message, not the draft, when Ctrl+P is pressed', async () => {
    await open()

    expect(press({ ctrlKey: true })).toBe(true)
    expect(printing.printMessages).toHaveBeenCalledTimes(1)
    expect(printing.printMessages.mock.calls[0][0]).toBe('Invoice for October')
    expect(printedMessages()).toEqual([
      expect.objectContaining({
        from: 'Bob Lee <bob@example.com>',
        to: 'Alice <alice@example.com>',
        bcc: '',
        receivedAt: '2026-10-30T08:00:00Z',
      }),
      expect.objectContaining({
        from: 'Alice <alice@example.com>',
        to: 'Bob Lee <bob@example.com>',
        bcc: 'Cy <cy@example.com>',
      }),
    ])
  })

  it('prints on ⌘P on a Mac, where Ctrl+P is left to the browser', async () => {
    platform.mac = true
    await open()

    expect(press({ ctrlKey: true })).toBe(false)
    expect(printing.printMessages).not.toHaveBeenCalled()
    expect(press({ metaKey: true })).toBe(true)
    expect(printing.printMessages).toHaveBeenCalledTimes(1)
  })

  it("holds back remote content in a stranger's message, and not in the reader's own", async () => {
    own.identities = [{ email: 'alice@example.com' }]
    await open()

    press({ ctrlKey: true })
    expect(printedMessages()?.map((message) => message.blockRemote)).toEqual([true, false])
  })

  it('leaves Ctrl+P to the browser in a read-only thread', async () => {
    await open({ readonly: true })

    expect(press({ ctrlKey: true })).toBe(false)
    expect(printing.printMessages).not.toHaveBeenCalled()
  })

  // A dialog or the attachment viewer over the thread is what the reader is looking at.
  it('leaves Ctrl+P to the browser while a dialog is open over the thread', async () => {
    await open()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    expect(press({ ctrlKey: true })).toBe(false)
    expect(printing.printMessages).not.toHaveBeenCalled()
  })
})
