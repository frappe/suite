import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { userStore } from '@/apps/mail/stores/user'
import { translate } from '@/platform/translation'

import MailboxView from './MailboxView.vue'
import UnifiedFolderView from './UnifiedFolderView.vue'

// A small Frappe whose thread lists fail until told otherwise, and then hold one empty folder. While
// `holding`, it keeps a list's reader waiting for the answer.
const server = vi.hoisted(() => {
  const asked: string[] = []
  // What each list request asked for: its query string and body.
  const sent: string[] = []
  const waiting: (() => void)[] = []
  return { failing: true, holding: false, asked, sent, waiting }
})
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (method !== 'get_threads' && method !== 'get_unified_threads')
      return reply({ message: null })
    server.asked.push(method)
    server.sent.push(`${url.search} ${typeof init?.body === 'string' ? init.body : ''}`)
    if (server.holding) await new Promise<void>((resolve) => server.waiting.push(resolve))
    if (server.failing)
      return reply(
        {
          exc_type: 'MailServerUnavailableError',
          _server_messages: JSON.stringify([
            JSON.stringify({ message: 'The mail server did not answer.' }),
          ]),
        },
        503,
      )
    return reply({ message: { rows: [], mailbox: 'a', has_more: false } })
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
    toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
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
      data: [{ id: 'a', _name: 'Inbox', role: 'inbox', slug: 'inbox' }],
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
// The reader's "group by date" setting, where the lists read it: the store.
const groupByDate = (on: boolean) => {
  const settings = userStore().userResource.data
  if (settings) settings.group_by_date = on
}

beforeEach(() => {
  server.failing = true
  server.holding = false
  server.asked = []
  server.sent = []
})
afterEach(() => {
  for (const answer of server.waiting.splice(0)) answer()
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  groupByDate(false)
  userStore().inboxTabs = []
})

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
      {
        path: '/mail/all/:folder',
        name: 'mail-unified',
        component: UnifiedFolderView,
        props: true,
      },
      {
        path: '/mail/all/:folder/account/:accountId/:threadID',
        name: 'mail-unified-mail',
        component: UnifiedFolderView,
        props: true,
      },
    ],
  })
  await router.push(path)
  const errors: unknown[] = []
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.config.errorHandler = (error) => errors.push(error)
  app.provide('$socket', { on: () => {}, off: () => {}, emit: () => {} })
  // The loading outline lays its rows out by the reader's settings.
  app.provide('$user', { data: { show_reading_pane: true } })
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return { element, errors, router }
}

const retryButton = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Retry')

describe.each([
  ['an account folder', '/mail/account/acc/mailbox/a', 'get_threads'],
  ['an "All accounts" folder', '/mail/all/inbox', 'get_unified_threads'],
])('a thread list that fails to load, in %s', (_view, path, method) => {
  it('says so and offers Retry, not the empty folder', async () => {
    const { element, errors } = await open(path)

    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')).not.toBeNull())
    expect(element.textContent).toContain('The mail server did not answer.')
    expect(retryButton(element)).toBeDefined()
    expect(element.textContent).not.toContain('No mails in')
    expect(errors).toEqual([])
  })

  it('asks again on Retry, and shows the folder once it answers', async () => {
    const { element } = await open(path)
    await vi.waitFor(() => expect(retryButton(element)).toBeDefined())
    const before = server.asked.filter((asked) => asked === method).length

    server.failing = false
    retryButton(element)!.click()

    await vi.waitFor(() => expect(element.textContent).toContain('No mails in Inbox.'))
    expect(server.asked.filter((asked) => asked === method).length).toBeGreaterThan(before)
    expect(element.querySelector('[role="alert"]')).toBeNull()
  })
})

describe.each([
  ['an account folder', '/mail/account/acc/mailbox/a'],
  ['an "All accounts" folder', '/mail/all/inbox'],
])('a thread list on its way, in %s', (_view, path) => {
  const outline = (element: HTMLElement) => element.querySelector('[role="status"]')

  it('stands in outline under the toolbar its rows will sit under', async () => {
    server.holding = true
    const { element, errors } = await open(path)

    await vi.waitFor(() => expect(outline(element)).not.toBeNull())
    const refresh = element.querySelector('button[aria-label="Refresh"]')
    expect(refresh).not.toBeNull()
    expect(
      refresh!.compareDocumentPosition(outline(element)!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(errors).toEqual([])
  })

  it('keeps the reading pane beside it, not a blank half', async () => {
    server.holding = true
    const { element } = await open(path)

    await vi.waitFor(() => expect(outline(element)).not.toBeNull())
    expect(element.querySelector('[data-reading-pane]')).not.toBeNull()
  })

  it('outlines a date header where the reader groups mail by date', async () => {
    groupByDate(true)
    server.holding = true
    const { element } = await open(path)

    await vi.waitFor(() => expect(outline(element)).not.toBeNull())
    expect(outline(element)!.firstElementChild?.matches('[data-outline="date-header"]')).toBe(true)
  })

  it('outlines rows alone where the reader does not', async () => {
    server.holding = true
    const { element } = await open(path)

    await vi.waitFor(() => expect(outline(element)).not.toBeNull())
    expect(element.querySelector('[data-outline="date-header"]')).toBeNull()
  })
})

describe('a thread opened in an "All accounts" folder whose list is on its way', () => {
  it('stands in outline in the reading pane, toolbar and all, until its row is in', async () => {
    server.holding = true
    const { element, errors } = await open('/mail/all/inbox/account/acc/t1')

    await vi.waitFor(() =>
      expect(element.querySelector('[role="status"][aria-label="Loading thread"]')).not.toBeNull(),
    )
    // Above it, the thread's toolbar with its buttons in outline: the list has none of its own.
    expect(element.querySelector('[data-outline="thread-actions"]')).not.toBeNull()
    // The pane itself waits for the row: what its buttons do is read off it.
    expect(element.querySelector('[data-reading-pane]')).toBeNull()
    expect(errors).toEqual([])
  })
})

describe.each([
  ['an account Inbox', '/mail/account/acc/mailbox/a'],
  ['the "All accounts" Inbox', '/mail/all/inbox'],
])('switching category in %s', (_view, path) => {
  it('opens the next category unfiltered', async () => {
    server.failing = false
    userStore().inboxTabs = ['primary', 'social']
    const { element, router } = await open(`${path}?category=primary`)
    const chip = (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    await vi.waitFor(() => expect(chip('Unread')).toBeDefined())

    chip('Unread')!.click()
    await vi.waitFor(() => expect(server.sent.some((sent) => sent.includes('unread'))).toBe(true))
    const switchedAt = server.sent.length
    await router.push(`${path}?category=social`)

    await vi.waitFor(() =>
      expect(server.sent.slice(switchedAt).some((sent) => sent.includes('social'))).toBe(true),
    )
    expect(server.sent.slice(switchedAt).filter((sent) => sent.includes('unread'))).toEqual([])
  })
})
