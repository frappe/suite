import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { translate } from '@/platform/translation'

import InvitesView from './InvitesView.vue'

const server = vi.hoisted(() => {
  const failed = {
    name: 'request-nisha',
    account: 'nisha@frappe.io',
    is_admin: 0,
    backup_email: null,
    invited_by: 'admin@frappe.io',
    is_verified: 0,
    status: 'Setup failed',
  }
  const pending = {
    ...failed,
    name: 'request-sofia',
    account: 'sofia@frappe.io',
    status: 'Pending',
  }
  return { failed, pending, retried: [] as string[], settled: false }
})
vi.hoisted(() => {
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = String(init?.body ?? '')
    if (url.includes('retry_account_creation')) {
      server.retried.push(body)
      server.settled = true
      return new Response(
        JSON.stringify({
          message: {
            success: true,
            user: server.failed.account,
            status: 'Password change required',
            error: null,
            temporary_password: null,
            expires_at: null,
          },
        }),
      )
    }
    const everyRow = server.settled ? [server.pending] : [server.failed, server.pending]
    const items = body.includes('Setup failed')
      ? everyRow.filter((row) => row.status === 'Setup failed')
      : everyRow
    return new Response(JSON.stringify({ message: { items, total: items.length } }))
  }
})

vi.mock('@/apps/mail/utils', () => ({ raiseToast: vi.fn() }))
vi.mock('@/platform/dashboard', () => ({
  DashboardSkeletonText: defineComponent({ template: '<i />' }),
}))
vi.mock('@/apps/mail/components/DashboardPager.vue', () => ({
  default: defineComponent({ template: '<i />' }),
}))
vi.mock('@/apps/mail/components/Modals/EditInviteModal.vue', () => ({
  default: defineComponent({ template: '<i />' }),
}))
const passThrough = vi.hoisted(() => ({ template: '<div><slot /></div>' }))
vi.mock('frappe-ui', () => ({
  Badge: defineComponent({ props: ['label'], template: '<span>{{ label }}</span>' }),
  Button: defineComponent({
    props: ['label'],
    template: '<button>{{ label }}</button>',
  }),
  Dialog: defineComponent({ template: '<template />' }),
  FormControl: defineComponent({
    props: ['modelValue', 'options', 'type'],
    emits: ['update:modelValue'],
    template: `<select v-if="type === 'select'" :value="modelValue" aria-label="Status"
      @change="$emit('update:modelValue', $event.target.value)">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select><input v-else />`,
  }),
  Skeleton: defineComponent({ template: '<i />' }),
  Tooltip: passThrough,
}))
vi.mock('frappe-ui/list', () => ({
  List: passThrough,
  ListCell: passThrough,
  ListHeader: passThrough,
  ListHeaderCell: passThrough,
  ListRow: defineComponent({
    props: ['value'],
    template: '<div role="row" :data-name="value"><slot /></div>',
  }),
  ListRows: defineComponent({
    props: ['items'],
    template: '<div><slot v-for="item in items" :item="item" /></div>',
  }),
}))

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  server.retried.length = 0
  server.settled = false
})

async function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(InvitesView) })
  app.config.globalProperties.__ = translate
  apps.push(app)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  })
  await router.push('/')
  app.use(router)
  app.mount(element)
  return element
}
const row = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(`[data-name="${name}"]`)
const buttons = (scope: HTMLElement | null) =>
  Array.from(scope?.querySelectorAll('button') ?? []).map((button) => button.textContent)

describe('Invitations', () => {
  it('offers Retry and Remove on a failed setup, and only there', async () => {
    const element = await mount()
    await vi.waitFor(() => expect(row(element, 'request-nisha')).not.toBeNull())
    expect(row(element, 'request-nisha')?.textContent).toContain('Setup failed')
    expect(buttons(row(element, 'request-nisha'))).toEqual(['Retry', 'Remove'])
    expect(buttons(row(element, 'request-sofia'))).toEqual(['Edit invite for sofia@frappe.io'])
  })

  it('lists only failed setups under the Failed filter', async () => {
    const element = await mount()
    await vi.waitFor(() => expect(row(element, 'request-sofia')).not.toBeNull())
    const filter = element.querySelector('select')!
    const failed = Array.from(filter.options).find((option) => option.textContent === 'Failed')!
    filter.value = failed.value
    filter.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(row(element, 'request-sofia')).toBeNull())
    expect(row(element, 'request-nisha')).not.toBeNull()
  })

  it('takes a failed setup off the list once its retry succeeds', async () => {
    const element = await mount()
    await vi.waitFor(() => expect(row(element, 'request-nisha')).not.toBeNull())
    Array.from(row(element, 'request-nisha')!.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry')!
      .click()
    await nextTick()
    await vi.waitFor(() => expect(row(element, 'request-nisha')).toBeNull())
    expect(server.retried.join()).toContain('request-nisha')
  })
})
