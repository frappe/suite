import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import ExchangesView from './ExchangesView.vue'

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

async function mount(kind: 'mail' | 'contacts' | 'calendar') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(ExchangesView, { kind }) })
  app.config.globalProperties.__ = translate
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return element
}

describe.each([
  ['mail', 'No mail exchanges found.'],
  ['contacts', 'No contacts exchanges found.'],
  ['calendar', 'No calendar exchanges found.'],
] as const)('%s exchanges list', (kind, emptyText) => {
  // Before the list arrives the page must not claim there are none: it is busy, with no
  // empty message. Once an empty answer lands, it says so.
  it('shows it is loading, not empty, until the list arrives', async () => {
    const element = await mount(kind)
    await vi.waitFor(() => expect(answers).toHaveLength(1))

    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(element.textContent).not.toContain(emptyText)

    answers[0]()
    await vi.waitFor(() => expect(element.textContent).toContain(emptyText))
    expect(element.querySelector('[aria-busy="true"]')).toBeNull()
  })
})
