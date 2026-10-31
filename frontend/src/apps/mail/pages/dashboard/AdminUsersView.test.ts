import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import AdminUsersView from './AdminUsersView.vue'

vi.mock('@/apps/mail/utils/addOnArrival', () => ({ useAddOnArrival: vi.fn() }))
vi.mock('@/platform/dashboard', () => ({
  DashboardLayout: defineComponent({
    template: '<main><slot name="actions" /><slot /></main>',
  }),
}))
vi.mock('frappe-ui', () => ({
  Alert: defineComponent({
    props: ['title', 'description'],
    template: '<div role="alert">{{ title }} {{ description }}<slot name="actions" /></div>',
  }),
  ErrorMessage: defineComponent({
    props: ['message'],
    template: '<p>{{ message }}</p>',
  }),
  Button: defineComponent({
    props: ['label'],
    template: '<button>{{ label }}</button>',
  }),
  Tabs: defineComponent({
    props: ['modelValue', 'tabs'],
    emits: ['update:modelValue'],
    template: `<div><button v-for="tab in tabs" :key="tab.value"
      @click="$emit('update:modelValue', tab.value)">{{ tab.label }}</button>
      <slot name="tab-panel" /></div>`,
  }),
}))

vi.hoisted(() => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            name: 'aisha@frappe.io',
            email: 'aisha@frappe.io',
            full_name: 'Aisha Khan',
            user_image: null,
            is_admin: false,
            enabled: false,
            account: 'aisha@frappe.io',
            setup_status: 'Setup failed',
            must_change_password: false,
          },
          {
            name: 'maya@frappe.io',
            email: 'maya@frappe.io',
            full_name: 'Maya',
            user_image: null,
            is_admin: false,
            enabled: true,
            account: 'maya@frappe.io',
            setup_status: 'Active',
            must_change_password: false,
          },
        ],
      }),
    )
})
vi.mock('@/apps/mail/pages/dashboard/InvitesView.vue', () => ({
  default: defineComponent({
    setup(_, { expose }) {
      expose({ reloadInvites: vi.fn() })
    },
    template: '<div data-test="invitations">Invitation list</div>',
  }),
}))
vi.mock('@/apps/mail/components/Modals/AddAccountModal.vue', () => ({
  default: defineComponent({
    props: ['modelValue'],
    emits: ['reload'],
    template: '<button v-if="modelValue" @click="$emit(\'reload\')">Finish adding</button>',
  }),
}))

const apps: ReturnType<typeof createApp>[] = []
let router = makeRouter()
function makeRouter() {
  const page = { render: () => null }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/users', component: page },
      { path: '/admin/users/invitations', component: page },
    ],
  })
}
async function install(app: ReturnType<typeof createApp>) {
  router = makeRouter()
  await router.push('/admin/users')
  app.use(router)
}
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})
async function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({
    render: () =>
      h(AdminUsersView, {}, { users: () => h('div', { 'data-test': 'users' }, 'User list') }),
  })
  apps.push(app)
  await install(app)
  app.mount(element)
  return element
}
async function click(element: HTMLElement, label: string) {
  const button = Array.from(element.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  )
  expect(button).toBeDefined()
  button!.click()
  await new Promise((resolve) => setTimeout(resolve))
  await nextTick()
  await nextTick()
}

describe('Admin Users', () => {
  it('lets Suite composition supply the user directory while retaining invitations', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const app = createApp({
      render: () =>
        h(AdminUsersView, {}, { users: () => h('section', 'Preserved Suite identities') }),
    })
    apps.push(app)
    await install(app)
    app.mount(element)
    expect(element.textContent).toContain('Preserved Suite identities')
    expect(element.querySelector('[data-test="users"]')).toBeNull()
    await click(element, 'Invitations')
    expect(element.querySelector('[data-test="invitations"]')).not.toBeNull()
    expect(element.textContent).not.toContain('Preserved Suite identities')
  })

  it('opens the user list by default', async () => {
    const element = await mount()
    expect(element.querySelector('[data-test="users"]')).not.toBeNull()
    expect(element.querySelector('[data-test="invitations"]')).toBeNull()
  })

  it('shows invitations without leaving Users', async () => {
    const element = await mount()
    await click(element, 'Invitations')
    expect(element.querySelector('[data-test="invitations"]')).not.toBeNull()
    expect(element.querySelector('[data-test="users"]')).toBeNull()
  })

  it('opens invitations after adding a user', async () => {
    const element = await mount()
    await click(element, 'Add user')
    await click(element, 'Finish adding')
    expect(element.querySelector('[data-test="invitations"]')).not.toBeNull()
  })

  it('puts Mail setup failure alerts in the Users tab, not Invitations', async () => {
    const element = await mount()
    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mail account setup failed',
      ),
    )
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('aisha@frappe.io')
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Aisha Khan')
    expect(element.querySelector('[role="alert"]')?.textContent).not.toContain('Maya')
    await click(element, 'Invitations')
    expect(element.querySelector('[role="alert"]')).toBeNull()
  })
})
