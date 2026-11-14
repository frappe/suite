import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type Component } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import CalendarExchangesView from './CalendarExchangesView.vue'
import ContactsExchangesView from './ContactsExchangesView.vue'
import MailExchangesView from './MailExchangesView.vue'

// Each pending list request, waiting for the test to answer it with no jobs.
const answers = vi.hoisted((): (() => void)[] => [])
vi.hoisted(() => {
  globalThis.fetch = (input) =>
    String(input instanceof Request ? input.url : input).includes('/exchanges?')
      ? new Promise<Response>((resolve) =>
          answers.push(() =>
            resolve(
              new Response(JSON.stringify({ data: { items: [], total: 0 } }), {
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
          ),
        )
      : Promise.resolve(new Response(JSON.stringify({ message: {} })))
})

const slot = vi.hoisted(() => ({ template: '<div><slot /></div>' }))
vi.mock('frappe-ui', () => ({
  Badge: slot,
  Breadcrumbs: slot,
  ErrorMessage: slot,
  FormControl: slot,
  Skeleton: defineComponent({ template: '<i />' }),
  Tabs: defineComponent({ template: '<div><slot name="tab-panel" /></div>' }),
  toast: {},
}))

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  answers.length = 0
})

async function mount(view: Component) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(view) })
  app.config.globalProperties.__ = translate
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return element
}

describe.each([
  ['Mail', MailExchangesView],
  ['Contacts', ContactsExchangesView],
  ['Calendar', CalendarExchangesView],
])('%s exchanges list', (_, view) => {
  // The list itself (frappe-ui's experimental ListView, with its empty state) is not stubbed
  // here, so the test follows the loading placeholder: shown while the request is out, gone
  // once the answer lands and the list takes its place.
  it('shows a loading placeholder until the list arrives', async () => {
    const element = await mount(view)
    await vi.waitFor(() => expect(answers).toHaveLength(1))

    expect(element.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading')

    answers[0]()
    await vi.waitFor(() => expect(element.querySelector('[role="status"]')).toBeNull())
  })
})
