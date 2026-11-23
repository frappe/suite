import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import { translate } from '@/platform/translation'

import MailboxView from './MailboxView.vue'

// A small Frappe with one mail in Spam, or none when `empty`. While `holding`, it keeps a list's reader waiting.
const server = vi.hoisted(() => {
  const waiting: (() => void)[] = []
  return { holding: false, waiting, answered: 0, empty: false }
})
vi.hoisted(() => {
  const message = {
    name: 'm1',
    id: 'm1',
    thread_id: 't1',
    from_name: 'Sender',
    from_email: 'sender@example.com',
    received_at: '2026-11-04 10:00:00',
    mailboxes: [{ mailbox: 'j', mailbox_id: 'j', mailbox_name: 'Spam' }],
    seen: 0,
    junk: 1,
    flagged: 0,
    draft: 0,
    subject: 'Offer',
    preview: 'Offer',
    recipients: [],
    attachments: [],
  }
  const row = {
    ...message,
    messages: [
      {
        ...message,
        message_id: null,
        in_reply_to: null,
        reacts_with: [],
        mailing_list: 0,
        html_body: null,
        text_body: 'Offer',
        reply_to: [],
        dsn_blob_id: null,
      },
    ],
  }
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const reply = (message: unknown) =>
      new Response(JSON.stringify({ message }), { headers: { 'Content-Type': 'application/json' } })
    if (!url.pathname.endsWith('get_threads')) return reply(null)
    if (server.holding) await new Promise<void>((resolve) => server.waiting.push(resolve))
    server.answered += 1
    return reply({ rows: server.empty ? [] : [row], mailbox: 'j', has_more: false })
  }
})

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const nothing = defineComponent({ setup: () => () => null })
  const slotOnly = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return {
    toast: {
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
      dismiss: () => {},
    },
    usePortalTarget: () => undefined,
    Breadcrumbs: nothing,
    Dialog: nothing,
    Checkbox: nothing,
    Divider: nothing,
    Dropdown: slotOnly,
    Tooltip: slotOnly,
    PageHeader: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h(
            'div',
            Object.values(slots).map((slot) => slot?.()),
          ),
    }),
    Button: defineComponent({
      props: { label: String },
      emits: ['click'],
      setup:
        (props, { emit, slots }) =>
        () =>
          h('button', { onClick: () => emit('click') }, props.label ?? slots.default?.()),
    }),
  }
})

// The page's chrome and the reading pane are not under test.
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/HeaderActions.vue', none)
// A row is a mark in the list: what it shows is not under test.
vi.mock('@/apps/mail/components/MailListItem.vue', none)
// The reading pane's content: a mark where the thread, or the prompt to pick one, would stand.
vi.mock('@/apps/mail/components/MailThread.vue', async () => {
  const { h } = await import('vue')
  return { default: { render: () => h('section', { 'data-reading-pane': '' }) } }
})
vi.mock('@/apps/mail/components/SnoozeMenu.vue', none)
vi.mock('@/apps/mail/components/ListSelection/MobileSelectionBar.vue', none)
vi.mock('@/apps/mail/components/mobile/MobileTitleHeader.vue', none)

// The suite router, which the real store reaches for; these pages get their own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/stores/user', async (importOriginal) => {
  const { reactive } = await import('vue')
  const store = reactive({
    accountId: 'acc',
    mailboxIds: { inbox: 'a', sent: 'e', drafts: 'd', trash: 't', junk: 'j' },
    mailboxes: {
      data: [
        { id: 'a', _name: 'Inbox', role: 'inbox', slug: 'inbox' },
        { id: 'j', _name: 'Spam', role: 'junk', slug: 'spam', total_emails: 1 },
      ],
      refetch: () => Promise.resolve(),
    },
    unifiedFolders: { data: [{ slug: 'inbox', name: 'Inbox', role: 'inbox' }] },
    inboxTabs: [],
    tabCounts: { data: [] },
    unifiedTabCounts: { data: [] },
    accountShortNames: {},
    userResource: { data: { accounts: [{ id: 'acc' }, { id: 'b' }] } },
    refreshCounts: () => Promise.resolve(),
  })
  return {
    ...(await importOriginal<typeof import('@/apps/mail/stores/user')>()),
    userStore: () => store,
  }
})

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const answer of server.waiting.splice(0)) answer()
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  server.holding = false
  spam().total_emails = 1
  server.answered = 0
  server.empty = false
})

// Spam's record in the store, which says how much mail the folder holds.
const spam = () => userStore().mailboxes.data!.find((m) => m.id === 'j')!

async function open(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/mail/account/:accountId/mailbox/:mailbox',
        name: 'mail-mailbox',
        component: MailboxView,
        props: true,
      },
    ],
  })
  await router.push(path)
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.provide('$socket', { on: () => {}, off: () => {}, emit: () => {} })
  app.provide('$user', { data: { show_reading_pane: true } })
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return element
}

const banner = (element: HTMLElement) =>
  element.textContent?.includes('Items in this folder will be automatically deleted after 30 days.')

// The banner is about the folder, not about the list's latest read. Reading the list again (after a
// mail is read, on Refresh, on the poll) took it away until the answer came, and the list jumped by
// its height each time.
it("keeps Spam's banner up while the list is read again", async () => {
  const element = await open('/mail/account/acc/mailbox/j')
  await vi.waitFor(() => expect(banner(element)).toBe(true))

  server.holding = true
  element.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click()
  await vi.waitFor(() => expect(server.waiting).toHaveLength(1))

  expect(banner(element)).toBe(true)
})

it("puts Spam's banner up before its list is in", async () => {
  server.holding = true
  const element = await open('/mail/account/acc/mailbox/j')
  await vi.waitFor(() => expect(server.waiting).toHaveLength(1))

  expect(banner(element)).toBe(true)
})

it('shows no banner in an empty Spam', async () => {
  spam().total_emails = 0
  server.empty = true
  const element = await open('/mail/account/acc/mailbox/j')
  await vi.waitFor(() => expect(server.answered).toBeGreaterThan(0))
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(banner(element)).toBe(false)
})
