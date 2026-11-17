import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import SendMail from './SendMail.vue'

// The desktop composer window, mounted whole — window, editor, toolbar, recipient fields — against a
// small Frappe that answers each call as the test tells it to.
const server = vi.hoisted<{
  asked: string[]
  answer: (method: string) => Promise<Response> | Response
}>(() => ({ asked: [], answer: () => new Response('{}') }))
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    server.asked.push(method)
    return server.answer(method)
  }
})
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// The real frappe-ui pieces the composer is built from (tests otherwise get the recorder's
// stand-ins). Its dialogs stay shut, so they render nothing; its toasts are recorded.
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('frappe-ui', async () => {
  const { defineComponent } = await import('vue')
  const shut = defineComponent({ setup: () => () => null })
  return {
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Avatar')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Button')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Combobox')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Dropdown')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Popover')),
    ...(await import('../../../../../node_modules/frappe-ui/src/components/Tooltip')),
    ...(await import('../../../../../node_modules/frappe-ui/src/composables/usePortalTarget')),
    ...(await import('../../../../../node_modules/frappe-ui/src/utils/useFileUpload')),
    Dialog: shut,
    ErrorMessage: shut,
    FormControl: shut,
    toast: { ...toasts, dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
// The contact picker and Send later open over the composer, and neither is under test.
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/Modals/ContactsModal.vue', none)
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
// The suite router, which the mail composables import; the composer gets its own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed } = await import('vue')
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({ data: [{ email: 'maya@example.com', _name: 'Maya' }] })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

// jsdom lays nothing out; the suggestion list scrolls its highlighted row into view.
Element.prototype.scrollIntoView = () => {}

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.asked = []
  toasts.error.mockReset()
  toasts.success.mockReset()
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The composer window open on a saved draft to Dana. */
async function openComposer() {
  const show = ref(true)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)*', component: { render: () => null } }],
  })
  await router.push('/mail')
  const app = createApp({
    render: () =>
      h(SendMail, {
        modelValue: show.value,
        'onUpdate:modelValue': (open: boolean) => (show.value = open),
        mailDetails: {
          id: 'draft-1',
          to: [{ email: 'dana@brightwave.example' }],
          subject: 'Brief',
          html_body: '<p>See the brief.</p>',
          attachments: [],
        },
      }),
  })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(button('Close')).not.toBeNull())
}

const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  ) ?? null
const type = async (field: HTMLInputElement, text: string) => {
  field.focus()
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('typing a recipient', () => {
  const toField = () => document.querySelector<HTMLInputElement>('[data-recipient-input] input')!
  // A chip's name, without its avatar's initials.
  const chips = () =>
    [...document.querySelectorAll('[data-recipient-input] button .truncate')].map((name) =>
      name.textContent?.trim(),
    )
  const pressEnter = async (field: HTMLInputElement) => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }

  it('keeps an address that is not one, and adds no recipient for it', async () => {
    server.answer = () => reply({ message: [] })
    await openComposer()

    await type(toField(), 'jordan@northwind')
    await vi.waitFor(() => expect(document.body.textContent).toContain('Not a valid email address'))
    await pressEnter(toField())

    expect(toField().value).toBe('jordan@northwind')
    expect(chips()).toEqual(['dana@brightwave.example'])
  })

  it('adds a full address as a recipient', async () => {
    server.answer = () => reply({ message: [] })
    await openComposer()

    await type(toField(), 'jordan@northwind.example')
    await vi.waitFor(() => expect(document.body.textContent).toContain('jordan@northwind.example'))
    await pressEnter(toField())

    await vi.waitFor(() =>
      expect(chips()).toEqual(['dana@brightwave.example', 'jordan@northwind.example']),
    )
  })
})
