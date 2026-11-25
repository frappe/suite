import dayjs from 'dayjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, ref, type App, type Ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import { useThreadReload } from '@/apps/mail/composables/useThreadReload'
import type { Mail } from '@/apps/mail/types'
import { useDiscardingDrafts, useListReload } from '@/apps/mail/utils/composables'

// The thread pane on a phone, with its real template: every message's chrome left out, and the quick
// reply over the thread's foot reduced to what it was handed.
const empty = vi.hoisted(() => async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ render: () => null }) }
})
vi.mock('@/apps/mail/components/MailActions.vue', empty)
vi.mock('@/apps/mail/components/ThreadHeader.vue', empty)
vi.mock('@/apps/mail/components/SendMail.vue', empty)
// The quick reply, as what it holds and how it has the thread reloaded once it has saved.
const quickReply = vi.hoisted(() => ({
  holds: new Array<string | undefined>(),
  reloadMails: () => {},
}))
vi.mock('@/apps/mail/components/mobile/QuickReply.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: {
        mailDetails: { type: Object, required: true },
        reloadMails: { type: Function, required: true },
      },
      setup(props) {
        quickReply.holds.push(props.mailDetails.name)
        // SAFETY: MailThread hands the quick reply a function of no arguments to reload with.
        quickReply.reloadMails = props.reloadMails as () => void
        return () => h('div', { 'data-quick-reply': '' })
      },
    }),
  }
})
// A saved draft's card, as the draft it shows and its Discard.
const draftCard = vi.hoisted(() => ({ discard: () => {} }))
vi.mock('@/apps/mail/components/mobile/DraftCard.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { mail: { type: Object, required: true }, sender: String },
      emits: ['discard'],
      setup(props, { emit }) {
        draftCard.discard = () => emit('discard')
        return () => h('div', { 'data-draft-card': props.mail.name }, props.sender)
      },
    }),
  }
})
// A discard's Undo, as its toast offers it.
const undo = vi.hoisted<{ action?: () => void }>(() => ({}))
vi.mock('@/apps/mail/utils', async (original) => ({
  ...(await original<typeof import('@/apps/mail/utils')>()),
  commitAfterUndo: ({ restore }: { restore: () => void }) => (undo.action = restore),
}))
vi.mock('@/apps/mail/components/ComposeMailEditor.vue', empty)
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
vi.mock('@/api', async (original) => {
  const actual = await original<typeof import('@/api')>()
  return {
    ...actual,
    client: { ...actual.client, query: async () => [] },
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
      identities: ref({ data: [{ email: 'alice@example.com', _name: 'Alice Moreau' }] }),
      screenedAddresses: ref({ data: [] }),
      mailboxIds: ref({ sent: 'sent', drafts: 'drafts' }),
      mailboxes: ref({ data: [] }),
    }),
  }
})
vi.mock('@/apps/mail/utils/composables', async (original) => {
  const { ref } = await import('vue')
  const { useDiscardingDrafts, useListReload } =
    await original<typeof import('@/apps/mail/utils/composables')>()
  return {
    useDiscardingDrafts,
    useListReload,
    useUndo: () => ({ setUndoAction: () => {}, retireUndoAction: () => {} }),
    useScreenSize: () => ({ isMobile: ref(true) }),
    useComposeMail: () => ({ requestCompose: () => {} }),
    useSettings: () => ({}),
    useTheme: () => ({ dataTheme: ref('light') }),
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
  quickReply.holds = []
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
/** Thread `one` open in the Inbox, its messages the list's `rows` when given, else what `query` holds. */
const openThread = async (rows?: Ref<Mail[]>, onReloadMails?: () => void) => {
  window.__ = (text: string) => text
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  await router.push('/mail/inbox/one')
  app = createApp({
    setup: () => () =>
      h(MailThread, {
        mailbox: 'inbox',
        threadID: 'one',
        threads: [],
        marksSeen: false,
        messages: rows?.value,
        onReloadMails,
      }),
  })
  app.config.globalProperties.__ = window.__
  app.use(router)
  app.provide('$user', { data: {} })
  app.provide('$dayjs', dayjs)
  document.body.appendChild(root)
  app.mount(root)
}
// The reply island's field, which starts a reply to the newest message.
const replyButton = () => root.querySelector<HTMLElement>('button[label^="Reply"]') ?? undefined

it('has the thread reload when it is next open, for a reply that saved after the reader left it', async () => {
  query.current.data = [message('trail')]
  await openThread()
  await vi.waitFor(() => expect(replyButton()).toBeDefined())
  replyButton()!.click()
  await vi.waitFor(() => expect(quickReply.holds).toHaveLength(1))

  app?.unmount()
  quickReply.reloadMails()

  expect(useThreadReload().threadReloadRequest.value).toEqual({ threadId: 'one' })
})

// Back on the list, the row went on counting the conversation without the reply, and naming only
// the others in it, until the list was next read.
it('has the list read its row again, for a reply that saved after the reader left it', async () => {
  query.current.data = [message('trail')]
  await openThread()
  await vi.waitFor(() => expect(replyButton()).toBeDefined())
  replyButton()!.click()
  await vi.waitFor(() => expect(quickReply.holds).toHaveLength(1))

  app?.unmount()
  quickReply.reloadMails()

  expect(useListReload().rowReloadRequest.value).toEqual({ threadId: 'one' })
})

it('takes a draft discarded from its card off the thread, and puts it back on Undo', async () => {
  query.current.data = [
    message('trail'),
    message('reply', {
      draft: 1,
      from_email: 'alice@example.com',
      html_body: '<p>Running late</p>',
    }),
  ]
  await openThread()
  const card = () => root.querySelector('[data-draft-card="reply"]')
  await vi.waitFor(() => expect(card()).not.toBeNull())

  draftCard.discard()
  await vi.waitFor(() => expect(card()).toBeNull())

  undo.action!()
  await vi.waitFor(() => expect(card()).not.toBeNull())
})

// A reply saved on the compose page, or by a quick reply left behind, reaches the list's rows only
// after the ones the reader came back to; nothing reloads the thread for it a second time.
const savedReply = () =>
  message('reply', { draft: 1, from_email: 'alice@example.com', html_body: '<p>Running late</p>' })

it('shows a reply saved elsewhere once the rows bring it', async () => {
  const rows = ref<Mail[]>([message('trail')])
  await openThread(rows)
  await vi.waitFor(() => expect(replyButton()).toBeDefined())

  rows.value = [message('trail'), savedReply()]

  await vi.waitFor(() => expect(root.querySelector('[data-draft-card="reply"]')).not.toBeNull())
})

// A reply saved from the quick reply carries no name of its own: its card gave the bare address.
it("names a saved reply's sender as the identity it goes out as", async () => {
  await openThread(ref<Mail[]>([message('trail'), savedReply()]))

  await vi.waitFor(() =>
    expect(root.querySelector('[data-draft-card="reply"]')?.textContent).toBe('Alice Moreau'),
  )
})

it('leaves out the reply being written in the quick reply when its save reaches the rows', async () => {
  const rows = ref<Mail[]>([message('trail')])
  await openThread(rows)
  await vi.waitFor(() => expect(replyButton()).toBeDefined())
  replyButton()!.click()
  await vi.waitFor(() => expect(quickReply.holds).toHaveLength(1))

  rows.value = [message('trail'), savedReply()]
  await new Promise((resolve) => setTimeout(resolve))

  expect(root.querySelector('[data-draft-card="reply"]')).toBeNull()
})

it('reads the rows again for a draft let back by Undo that they do not hold yet', async () => {
  // A quick reply's draft: saved while it was written, discarded, and never read by the list.
  const { holdDraft, releaseDraft } = useDiscardingDrafts()
  holdDraft('reply')
  let reloads = 0
  await openThread(ref<Mail[]>([message('trail')]), () => reloads++)
  await vi.waitFor(() => expect(replyButton()).toBeDefined())

  releaseDraft('reply')

  await vi.waitFor(() => expect(reloads).toBe(1))
})
