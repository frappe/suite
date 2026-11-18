import dayjs from 'dayjs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import type { Mail, MailCopy } from '@/apps/mail/types'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

// The thread pane with its real template, as the reader sees it after the server answers: every
// message's chrome left out but its actions, which are handed the mail they act on.
const actedOn = vi.hoisted(() => new Map<string, Mail>())

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
        watchEffect(() => actedOn.set(props.mail.name, props.mail as Mail))
        return () => null
      },
    }),
  }
})
vi.mock('@/apps/mail/components/ThreadHeader.vue', empty)
vi.mock('@/apps/mail/components/SendMail.vue', empty)
vi.mock('@/apps/mail/components/ComposeMailEditor.vue', empty)
vi.mock('@/apps/mail/components/MailDetails.vue', empty)
vi.mock('@/apps/mail/components/MailDetailsPopover.vue', empty)
vi.mock('@/apps/mail/components/SenderCard.vue', empty)
vi.mock('@/apps/mail/components/MessageReactions.vue', empty)
vi.mock('@/apps/mail/components/MailDate.vue', empty)
vi.mock('@/apps/mail/components/AttachmentViewer.vue', empty)

// The thread's own fetch, which the pane falls back on when no list holds the thread.
const query = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    status: 'success',
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
beforeEach(() => actedOn.clear())
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

/** Thread `one` open in `mailbox`, its messages whatever `query` holds. */
const openThread = async (mailbox = 'inbox'): Promise<Router> => {
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
    setup: () => () => h(MailThread, { mailbox, threadID: 'one', threads: [], marksSeen: false }),
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
const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}

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
