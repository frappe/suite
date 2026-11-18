import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'

import { openComposePage } from '@/apps/mail/composables/composeHandoff'
import { translate } from '@/platform/translation'

import ComposeView from './ComposeView.vue'

// The phone's compose page as another app opens it on an iPhone browser: the first page of its
// document (see composeHandoff), so going back leaves the document, with no route guard and no
// unmount on the way. Against a small Frappe that keeps one draft.
interface Save {
  method: string
  body: Record<string, unknown>
  keepalive: boolean
}
const server = vi.hoisted<{ saves: Save[] }>(() => ({ saves: [] }))
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost')
    const method = url.pathname.split('.').at(-1) ?? ''
    const saved = { name: 'draft-1', id: 'draft-1', status: 'Drafted', error: null }
    const answer = { thread_id: null, submission_id: null, send_at: null, undo_send_period: null }
    if (method === 'create_mail' || method === 'update_draft_mail') {
      server.saves.push({
        method,
        body: JSON.parse(String(init?.body ?? '{}')),
        keepalive: !!init?.keepalive,
      })
      return Response.json({ message: { ...saved, ...answer } })
    }
    return Response.json({ message: [] })
  }
})

// The real frappe-ui pieces the page is built from (tests otherwise get the recorder's stand-ins).
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
    toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})
const { none } = vi.hoisted(() => ({ none: () => ({ default: { render: () => null } }) }))
vi.mock('@/apps/mail/components/Modals/ScheduleSendModal.vue', none)
vi.mock('@/apps/mail/components/ReminderMenu.vue', none)
vi.mock('@/apps/mail/components/ReplyReminderStrip.vue', none)
// The suite router, which the mail composables import; the page gets its own.
vi.mock('@/apps/mail/router', () => ({ default: {} }))
vi.mock('@/apps/mail/utils/accountScope', async () => {
  const { computed } = await import('vue')
  const scope = () => ({
    accountId: computed(() => 'acc'),
    account: computed(() => ({ default_outgoing_email: 'maya@example.com' })),
    identities: computed(() => ({ data: [{ email: 'maya@example.com', _name: 'Maya' }] })),
    mailboxes: computed(() => ({ data: [] })),
    mailboxIds: computed(() => ({ sent: 'e' })),
  })
  return { injectAccountScope: scope, provideAccountScope: scope }
})

Element.prototype.scrollIntoView = () => {}

const apps: ReturnType<typeof createApp>[] = []
beforeEach(() => {
  server.saves = []
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

/** The compose page, opened for the event's people as the first page of its document. */
async function openFirstPage(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/mail/account/:accountId/compose', component: ComposeView }],
  })
  // The first navigation of the router: no page of this document before it.
  await openComposePage(router, 'acc', { to: [{ email: 'dana@brightwave.example' }] })
  const app = createApp({ render: () => h(RouterView) })
  app.config.globalProperties.__ = translate
  app.provide('$user', { data: { name: 'maya@example.com', undo_send_period: 10 } })
  app.use(router)
  app.mount(document.body.appendChild(document.createElement('div')))
  apps.push(app)
  await vi.waitFor(() => expect(subject()).not.toBeNull())
  return router
}

const subject = () =>
  [...document.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Subject'))
    ?.querySelector('input') ?? null
const typeSubject = async (text: string) => {
  const field = subject()!
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const button = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
  ) ?? null

describe('leaving the compose page for the page before its document', () => {
  it('keeps what was typed when Close goes back', async () => {
    const router = await openFirstPage()
    const back = vi.spyOn(router, 'back')
    await typeSubject('Planning, Thursday')

    button('Close')!.click()

    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce())
    // Saved before going: going back leaves the document, which waits for nothing.
    expect(server.saves).toHaveLength(1)
    expect(server.saves[0]).toMatchObject({
      method: 'create_mail',
      body: { subject: 'Planning, Thursday', to: [{ email: 'dana@brightwave.example' }] },
    })
  })

  it('keeps what was typed when the page is hidden by the Back gesture', async () => {
    await openFirstPage()
    await typeSubject('Planning, Thursday')

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(server.saves).toHaveLength(1))
    expect(server.saves[0]).toMatchObject({
      method: 'create_mail',
      body: { subject: 'Planning, Thursday' },
      keepalive: true,
    })
  })

  it('sends nothing for a page left as it opened', async () => {
    const router = await openFirstPage()
    const back = vi.spyOn(router, 'back')

    window.dispatchEvent(new Event('pagehide'))
    button('Close')!.click()

    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce())
    expect(server.saves).toEqual([])
  })
})
