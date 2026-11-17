import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { translate } from '@/platform/translation'

import OutboxView from './OutboxView.vue'
import SubmissionDetailsView from './SubmissionDetailsView.vue'

// A small Frappe whose Outbox refuses until told otherwise, and then holds nothing.
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
    if (method !== 'get_submissions' && method !== 'get_scheduled_mail')
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
    return reply({ message: { rows: [], total: 0 } })
  }
})

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const nothing = defineComponent({ setup: () => () => null })
  return {
    toast: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
    usePageMeta: () => {},
    Badge: nothing,
    Breadcrumbs: nothing,
    Dialog: nothing,
    LoadingIndicator: nothing,
    Skeleton: nothing,
    Tooltip: nothing,
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

// The page's chrome and its dialogs are not under test.
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/HeaderActions.vue', none)
vi.mock('@/apps/mail/components/OutboxFilters.vue', none)
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
vi.mock('@/apps/mail/components/mobile/MobileTitleHeader.vue', none)

vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/stores/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/apps/mail/stores/user')>()),
  userStore: () => ({ accountId: 'acc', mailboxIds: { drafts: 'd', sent: 'e', inbox: 'a' } }),
}))

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
        path: '/mail/account/:accountId/outbox',
        name: 'mail-outbox',
        component: OutboxView,
      },
      {
        path: '/mail/account/:accountId/outbox/:submissionId',
        name: 'mail-submission',
        component: SubmissionDetailsView,
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
  app.provide('$socket', { on: () => {}, off: () => {} })
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return { element, router, errors }
}

const button = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)

describe('an Outbox that fails to load', () => {
  it('says so, not that nothing is pending, and asks again on Retry', async () => {
    const { element, errors } = await open('/mail/account/acc/outbox')

    await vi.waitFor(() => expect(button(element, 'Retry')).toBeDefined(), { timeout: 3000 })
    expect(element.textContent).toContain('The mail server did not answer.')
    expect(element.textContent).not.toContain('No pending submissions')
    expect(errors).toEqual([])

    const before = server.asked.length
    server.failing = false
    button(element, 'Retry')!.click()
    await vi.waitFor(() => expect(element.textContent).toContain('No pending submissions'))
    expect(server.asked.length).toBeGreaterThan(before)
  })
})

describe("a delivery's details that fail to load", () => {
  it('say so instead of loading forever, with Retry and a way back', async () => {
    const { element, router, errors } = await open('/mail/account/acc/outbox/SUB-1')

    await vi.waitFor(() => expect(button(element, 'Retry')).toBeDefined())
    expect(element.textContent).toContain('The mail server did not answer.')
    expect(errors).toEqual([])

    const before = server.asked.length
    button(element, 'Retry')!.click()
    await vi.waitFor(() => expect(server.asked.length).toBeGreaterThan(before))

    await vi.waitFor(() => expect(button(element, 'Back to Outbox')).toBeDefined())
    button(element, 'Back to Outbox')!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-outbox'))
  })
})
