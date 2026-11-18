import dayjs from 'dayjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import type { Mail, MailCopy } from '@/apps/mail/types'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

// The thread pane with its real template, as the reader sees it after the server answers: every
// message's chrome left out but its actions, which are handed the mail they act on, and a reply's
// composer, which is handed how to show its mail as sent.
const actedOn = vi.hoisted(() => new Map<string, Mail>())
const composers = vi.hoisted(() => new Map<string, () => Promise<void>>())

const empty = vi.hoisted(() => async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ render: () => null }) }
})
vi.mock('@/apps/mail/components/MailActions.vue', async () => {
  const { defineComponent, watchEffect } = await import('vue')
  return {
    default: defineComponent({
      props: { mail: { type: Object, required: true } },
      setup(props) {
        // SAFETY: MailThread hands every message's actions one of the thread's mails.
        watchEffect(() => actedOn.set(props.mail.name, props.mail as Mail))
        return () => null
      },
    }),
  }
})
vi.mock('@/apps/mail/components/ThreadHeader.vue', empty)
vi.mock('@/apps/mail/components/SendMail.vue', empty)
vi.mock('@/apps/mail/components/ComposeMailEditor.vue', async () => {
  const { defineComponent, h, watchEffect } = await import('vue')
  return {
    default: defineComponent({
      props: {
        mailDetails: { type: Object, default: undefined },
        showSent: { type: Function, default: undefined },
      },
      setup(props) {
        watchEffect(() => {
          if (props.mailDetails && props.showSent)
            // SAFETY: MailThread passes showSent as an async function of no arguments.
            composers.set(props.mailDetails.name, props.showSent as () => Promise<void>)
        })
        return () => h('div', { 'data-composer': '' })
      },
    }),
  }
})
vi.mock('@/apps/mail/components/MailDetails.vue', empty)
vi.mock('@/apps/mail/components/MailDetailsPopover.vue', empty)
vi.mock('@/apps/mail/components/SenderCard.vue', empty)
vi.mock('@/apps/mail/components/MessageReactions.vue', empty)
vi.mock('@/apps/mail/components/MailDate.vue', empty)
vi.mock('@/apps/mail/components/AttachmentViewer.vue', empty)
// A message's body, drawn as plain text where the reader can see whether it is open.
vi.mock('@/apps/mail/components/EmailContent.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { content: { type: String, default: '' } },
      setup: (props) => () => h('div', { 'data-body': '' }, props.content),
    }),
  }
})

// The thread's own fetch, which the pane falls back on when no list holds the thread.
const query = vi.hoisted(() => ({
  current: {
    // SAFETY: widens the empty start; each test sets the rows it answers with.
    data: undefined as unknown,
    status: 'success',
    refetch: async () => {},
  },
}))
// The thread asked for on its own once a reply is sent, answered as the test says.
const threadAsked = vi.hoisted(() => ({ answer: async (): Promise<unknown[]> => [] }))
vi.mock('@/api', async (original) => {
  const actual = await original<typeof import('@/api')>()
  return {
    ...actual,
    client: { ...actual.client, query: () => threadAsked.answer() },
    useQuery: () => query.current,
    useMutation: () => ({ run: vi.fn() }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ globalScreenedAddresses: { data: [] } }),
}))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { ref } = await import('vue')
  return {
    provideAccountScope: () => ({
      accountId: ref('alice@example.com'),
      account: ref({}),
      identities: ref({ data: [{ email: 'alice@example.com' }] }),
      screenedAddresses: ref({ data: [] }),
      mailboxIds: ref({ sent: 'sent', drafts: 'drafts' }),
    }),
  }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return {
    useScreenSize: () => ({ isMobile: ref(false) }),
    useComposeMail: () => ({ requestCompose: () => {} }),
    useSettings: () => ({}),
    useTheme: () => ({ dataTheme: ref('light') }),
    useDiscardingDrafts: () => ({
      isHeld: () => false,
      heldDrafts: ref(new Set()),
      takeRestoredDraft: () => undefined,
    }),
  }
})
vi.mock('@/apps/mail/composables/useScreener', async () => {
  const { ref } = await import('vue')
  return {
    trustableDomains: [],
    useScreener: () => ({ version: ref(0), isActive: () => false }),
  }
})
vi.mock('@/apps/mail/composables/useUnsubscribe', () => ({
  useUnsubscribe: () => ({
    offers: () => false,
    isUnsubscribed: () => false,
    unsubscribe: () => {},
  }),
}))
vi.mock('@/apps/mail/composables/useMessageReactions', () => ({
  useMessageReactions: () => ({ reactionsOn: () => [], react: () => {} }),
}))

let app: App | undefined
const root = document.createElement('div')
beforeEach(() => {
  actedOn.clear()
  composers.clear()
  threadAsked.answer = async () => []
})
afterEach(() => {
  app?.unmount()
  root.remove()
})

// A message in thread `one` as get_thread hands it over: read, from Bob, in the Inbox, unless told.
const message = (name: string, fields: Partial<Mail> = {}) => ({
  id: name,
  name,
  thread_id: 'one',
  subject: 'Trail map for Saturday',
  seen: 1,
  draft: 0,
  from_email: 'bob@example.com',
  recipients: [],
  reply_to: [],
  attachments: [],
  mailboxes: [{ mailbox_id: 'inbox', mailbox_name: 'Inbox' }],
  received_at: '2026-10-30T08:00:00Z',
  html_body: `<p>${name}</p>`,
  ...fields,
})

// What the pane is opened on; the reader moves to another thread by changing it.
const pane = reactive({ threadID: 'one' })
/** Thread `one` open in `mailbox`, its messages whatever `query` holds. */
const openThread = async (mailbox = 'inbox'): Promise<Router> => {
  pane.threadID = 'one'
  window.__ = (text: string) => text
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail/:mailbox', name: 'mail-mailbox', component: { render: () => null } },
      { path: '/:pathMatch(.*)*', component: { render: () => null } },
    ],
  })
  await router.push(`/mail/${mailbox}/one`)
  app = createApp({
    setup: () => () =>
      h(MailThread, { mailbox, threadID: pane.threadID, threads: [], marksSeen: false }),
  })
  app.config.globalProperties.__ = window.__
  app.use(router)
  app.provide('$user', { data: {} })
  app.provide('$dayjs', dayjs)
  document.body.appendChild(root)
  app.mount(root)
  await nextTick()
  await nextTick()
  return router
}
// A navigation, too, lands in a few turns.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// The folders each copy of a shown message is in, by copy: what an Undo puts each one back into.
const foldersOf = (mail: Mail) =>
  Object.fromEntries(
    [mail, ...(mail.duplicates ?? [])].map((copy: MailCopy) => [
      copy.id,
      copy.mailboxes.map((mailbox) => mailbox.mailbox_id),
    ]),
  )

it('keeps each copy of a reply to yourself in its own folders once its delivered copy lands', async () => {
  const sent = message('sent', {
    from_email: 'alice@example.com',
    mailboxes: [{ mailbox_id: 'sent', mailbox_name: 'Sent' }],
    received_at: '2026-10-30T09:00:00Z',
  })
  query.current = reactive({
    data: [message('bob'), sent],
    status: 'success',
    refetch: async () => {},
  })
  await openThread()

  // Delivered: the server leads with the copy in the Inbox, the Sent one hanging off it.
  query.current.data = [
    message('bob'),
    {
      ...sent,
      id: 'delivered',
      name: 'delivered',
      seen: 0,
      mailboxes: [{ mailbox_id: 'inbox', mailbox_name: 'Inbox' }],
      duplicates: [fromPartial<MailCopy>(sent)],
    },
  ]
  await settle()

  expect(foldersOf(actedOn.get('sent')!)).toEqual({ sent: ['sent'], delivered: ['inbox'] })
})

it('leaves the thread the reader moved to while the reply was being sent as it is', async () => {
  // A draft opened from Drafts, the whole of its pane.
  query.current = reactive({
    data: [message('draft', { draft: 1, mailboxes: [{ mailbox_id: 'drafts', mailbox_name: '' }] })],
    status: 'success',
    refetch: async () => {},
  })
  const router = await openThread('drafts')
  const showSent = composers.get('draft')!

  // On to another thread before the send's answer is back; its messages are on their way.
  pane.threadID = 'two'
  await settle()
  await showSent()
  await settle()

  expect(router.currentRoute.value.name).not.toBe('mail-mailbox')
})

// What the reader sees of the thread: the card of each message, and whether its body is open.
const cards = () =>
  [...root.querySelectorAll<HTMLElement>('[data-mail-name]')].map((card) => card.dataset.mailName)
const composerShown = () => root.querySelector('[data-composer]') !== null
const isOpen = (name: string) => {
  let node: HTMLElement | null = root.querySelector(`[data-mail-name="${name}"] [data-body]`)
  if (!node) return false
  for (; node && node !== root; node = node.parentElement)
    if (node.style.display === 'none') return false
  return true
}
const reply = message('reply', {
  from_email: 'alice@example.com',
  mailboxes: [{ mailbox_id: 'sent', mailbox_name: 'Sent' }],
  received_at: '2026-10-30T10:00:00Z',
})
const draftOfReply = message('draft', {
  from_email: 'alice@example.com',
  draft: 1,
  mailboxes: [{ mailbox_id: 'drafts', mailbox_name: 'Drafts' }],
  received_at: '2026-10-30T09:30:00Z',
})

it('puts the sent reply where its composer was', async () => {
  query.current = reactive({
    data: [message('bob'), draftOfReply],
    status: 'success',
    refetch: async () => {},
  })
  await openThread()
  expect(composerShown()).toBe(true)

  threadAsked.answer = async () => [message('bob'), reply]
  await composers.get('draft')!()
  await settle()

  expect(composerShown()).toBe(false)
  expect(cards()).toEqual(['bob', 'reply'])
  expect(isOpen('reply')).toBe(true)
})

it('leaves the messages above the reply open as the reader had them', async () => {
  query.current = reactive({
    data: [message('first'), message('bob', { received_at: '2026-10-30T09:00:00Z' }), draftOfReply],
    status: 'success',
    refetch: async () => {},
  })
  await openThread()
  // Read mail opens folded, but for the newest; the reader opens the first one too.
  expect(isOpen('first')).toBe(false)
  root.querySelector<HTMLElement>('[data-mail-name="first"]')!.click()
  await settle()
  expect(isOpen('first')).toBe(true)
  expect(isOpen('bob')).toBe(true)

  threadAsked.answer = async () => [
    message('first'),
    message('bob', { received_at: '2026-10-30T09:00:00Z' }),
    reply,
  ]
  await composers.get('draft')!()
  await settle()

  expect(cards()).toEqual(['first', 'bob', 'reply'])
  expect(isOpen('first')).toBe(true)
  expect(isOpen('bob')).toBe(true)
})

it('goes back to the folder when a draft that was the whole pane is sent off to a thread of its own', async () => {
  query.current = reactive({
    data: [{ ...draftOfReply, mailboxes: [{ mailbox_id: 'drafts', mailbox_name: 'Drafts' }] }],
    status: 'success',
    refetch: async () => {},
  })
  const router = await openThread('drafts')

  // A forward: the thread it was drafted in has nothing left in it.
  threadAsked.answer = async () => []
  await composers.get('draft')!()
  await settle()

  expect(router.currentRoute.value.name).toBe('mail-mailbox')
  expect(router.currentRoute.value.params.mailbox).toBe('drafts')
})
