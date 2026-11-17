import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { translate } from '@/platform/translation'

import ExchangeView from './ExchangeView.vue'

// A small server: one finished mail import, one that never answers, and nothing else.
const server = vi.hoisted(() => ({
  exchanges: new Map([
    [
      'MEX-0001',
      {
        name: 'MEX-0001',
        status: 'Completed',
        operation: 'Import',
        started_at: '2026-11-02 09:30:00',
        completed_at: '2026-11-02 09:41:00',
        output: 'Imported 1,204 messages.',
        import_format: 'mbox',
        export_format: null,
        export_archive_type: null,
      },
    ],
  ]),
}))
vi.hoisted(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost')
    const name = url.searchParams.get('name') ?? ''
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.pathname.endsWith('/exchanges/attachment')) return reply({ data: null })
    if (url.pathname.endsWith('/exchanges/get')) {
      if (name === 'MEX-SLOW') return new Promise<Response>(() => {})
      const exchange = server.exchanges.get(name)
      return exchange
        ? reply({ data: exchange })
        : reply(
            { errors: [{ type: 'DoesNotExistError', message: `Mail Exchange ${name} not found` }] },
            404,
          )
    }
    return reply({ errors: [{ type: 'NotFound', message: 'No such route' }] }, 404)
  }
})

vi.mock('frappe-ui', () => ({
  Badge: defineComponent({ props: ['label'], template: '<span>{{ label }}</span>' }),
  Breadcrumbs: defineComponent({
    props: ['items'],
    template: `<nav><template v-for="item in items" :key="item.label">
      <RouterLink v-if="item.route" :to="item.route">{{ item.label }}</RouterLink>
      <span v-else>{{ item.label }}</span></template></nav>`,
  }),
  Button: defineComponent({ template: '<button><slot /></button>' }),
  Dropdown: defineComponent({
    props: ['button'],
    template: '<button :aria-label="button.label" />',
  }),
  Skeleton: defineComponent({ template: '<i />' }),
  toast: {},
}))

const reported = vi.hoisted((): string[] => [])
vi.mock('@/platform/feedback', () => ({
  reportMutationError: (error: Error) => reported.push(error.message),
}))

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  reported.length = 0
})

async function open(path: string, { systemManager = true } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/mail-exchanges', name: 'mail-exchanges', component: { render: () => null } },
      {
        path: '/mail-exchanges/:id',
        name: 'mail-exchange',
        component: ExchangeView,
        props: (route) => ({ id: String(route.params.id), kind: 'mail' }),
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
  // What MailLayout provides to every page under it.
  app.provide('$user', { data: { is_system_manager: systemManager } })
  app.use(createPinia())
  app.use(router)
  apps.push(app)
  app.mount(element)
  return { element, router, errors }
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve))
    await nextTick()
  }
}

describe('Exchange page', () => {
  it('shows the job to a system manager, with its Desk link', async () => {
    const { element, errors } = await open('/mail-exchanges/MEX-0001')

    await vi.waitFor(() => expect(element.querySelector('h1')?.textContent).toBe('Mail Import'))
    expect(element.textContent).toContain('Completed')
    expect(element.textContent).toContain('Imported 1,204 messages.')
    expect(element.querySelector('[aria-label="More actions"]')).not.toBeNull()
    expect(errors).toEqual([])
  })

  it('leaves the Desk link out for everyone else', async () => {
    const { element, errors } = await open('/mail-exchanges/MEX-0001', { systemManager: false })

    await vi.waitFor(() => expect(element.querySelector('h1')).not.toBeNull())
    expect(element.querySelector('[aria-label="More actions"]')).toBeNull()
    expect(errors).toEqual([])
  })

  it('shows a placeholder while the job loads', async () => {
    const { element } = await open('/mail-exchanges/MEX-SLOW')
    await settle()

    expect(element.querySelector('[role="status"]')).not.toBeNull()
    expect(element.querySelector('h1')).toBeNull()
  })

  it('says why before going back to the list when the job is gone', async () => {
    const { router } = await open('/mail-exchanges/MEX-0404')

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-exchanges'))
    await settle()
    expect(reported).toEqual(['Mail Exchange MEX-0404 not found'])
  })

  it('links the breadcrumb to the list of the same operation inside Mail', async () => {
    const { element, router } = await open('/mail-exchanges/MEX-0001')

    await vi.waitFor(() => expect(element.querySelector('h1')).not.toBeNull())
    const crumb = Array.from(element.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Mail Exchanges',
    )
    expect(crumb).toBeDefined()
    crumb!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('mail-exchanges'))
    expect(router.currentRoute.value.query).toEqual({ operation: 'Import' })
  })
})
