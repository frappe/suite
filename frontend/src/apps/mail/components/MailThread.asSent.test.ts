import dayjs from 'dayjs'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import MailThread from '@/apps/mail/components/MailThread.vue'
import { mailDatesLoaded } from '@/apps/mail/composables/useMailDates'
import type { Mail } from '@/apps/mail/types'

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))
const { ref: hoistedRef } = await vi.hoisted(() => import('vue'))

// The app's theme, switched by the test while the thread is open.
const theme = vi.hoisted(() => hoistedRef<'light' | 'dark'>('dark'))
// What the message's More menu was last told about its body, and a way to pick its item.
interface Menu {
  bodyView?: string
  toggle: () => void
}
const menu = vi.hoisted((): Menu => ({ toggle: () => {} }))

// The rest of the message's chrome, which the test doesn't read, left out.
const empty = vi.hoisted(() => async () => {
  const { defineComponent } = await import('vue')
  return { default: defineComponent({ render: () => null }) }
})

vi.mock('@/apps/mail/components/MailActions.vue', async () => {
  const { defineComponent, watchEffect } = await import('vue')
  return {
    default: defineComponent({
      props: { bodyView: { type: String, default: undefined } },
      emits: ['toggleAsSent'],
      setup(props, { emit }) {
        watchEffect(() => (menu.bodyView = props.bodyView))
        menu.toggle = () => emit('toggleAsSent')
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

const query = vi.hoisted(() => ({
  current: {
    data: fromPartial<Partial<Mail>[] | undefined>(undefined),
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
  useComposeMail: () => ({ requestCompose: () => {} }),
  useSettings: () => ({}),
  useTheme: () => ({ dataTheme: theme }),
  useDiscardingDrafts: () => ({
    isHeld: () => false,
    heldDrafts: ref(new Set()),
    takeRestoredDraft: () => undefined,
  }),
}))
vi.mock('@/apps/mail/composables/useScreener', () => ({
  trustableDomains: [],
  useScreener: () => ({ version: ref(0), isActive: () => false }),
}))
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
afterEach(() => {
  app?.unmount()
  root.remove()
})

const colorScheme = () =>
  new DOMParser()
    .parseFromString(root.querySelector('iframe')!.getAttribute('srcdoc')!, 'text/html')
    .querySelector('meta[name="color-scheme"]')!
    .getAttribute('content')

it('offers a recoloured message as sent, shows it so, and drops the offer when the theme turns light', async () => {
  window.__ = (text: string) => text
  query.current.data = [
    {
      id: 'one',
      name: 'one',
      thread_id: 'one',
      subject: 'Weekly digest',
      seen: 1,
      draft: 0,
      from_email: 'bob@example.com',
      recipients: [],
      reply_to: [],
      attachments: [],
      mailboxes: [],
      received_at: '2026-10-30T08:00:00Z',
      html_body: '<div><p>This week in the project.</p></div>',
    },
  ]
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
  })
  app = createApp({
    setup: () => () =>
      h(MailThread, { mailbox: 'inbox', threadID: 'one', threads: [], marksSeen: false }),
  })
  app.use(router)
  app.provide('$user', { data: {} })
  app.provide('$dayjs', dayjs)
  document.body.appendChild(root)
  app.mount(root)
  await nextTick()
  await nextTick()

  expect(menu.bodyView).toBe('adapted')
  // The frame waits for the date reader, so that the dates are in the first document it loads.
  await mailDatesLoaded()
  await nextTick()
  expect(colorScheme()).toBe('dark')

  menu.toggle()
  await nextTick()
  expect(menu.bodyView).toBe('asSent')
  expect(colorScheme()).toBe('light')

  theme.value = 'light'
  await nextTick()
  await nextTick()
  expect(menu.bodyView).toBeUndefined()
})
