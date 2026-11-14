import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { translate } from '@/platform/translation'

import MailboxView from './MailboxView.vue'
import UnifiedFolderView from './UnifiedFolderView.vue'

// A small Frappe whose thread lists fail until told otherwise, and then hold one empty folder.
const server = vi.hoisted(() => {
  const asked: string[] = []
  return { failing: true, asked }
})
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
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
  return {
    toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
    Breadcrumbs: nothing,
    Dialog: nothing,
    Checkbox: nothing,
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
vi.mock('@/apps/mail/components/MailThread.vue', none)
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
beforeEach(() => {
  server.failing = true
  server.asked = []
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
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
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return { element, errors }
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
