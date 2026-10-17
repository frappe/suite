import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick } from 'vue'

import AdminUsersView from './AdminUsersView.vue'

vi.mock('@/apps/mail/utils/addOnArrival', () => ({ useAddOnArrival: vi.fn() }))
vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/platform/dashboard', () => ({
  DashboardLayout: defineComponent({
    template: '<main><slot name="actions" /><slot /></main>',
  }),
}))
vi.mock('frappe-ui', () => ({
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
vi.mock('@/apps/mail/pages/dashboard/UsersView.vue', () => ({
  default: defineComponent({ template: '<div data-test="users">User list</div>' }),
}))
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
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})
function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp(AdminUsersView)
  apps.push(app)
  app.mount(element)
  return element
}
async function click(element: HTMLElement, label: string) {
  const button = Array.from(element.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  )
  expect(button).toBeDefined()
  button!.click()
  await nextTick()
  await nextTick()
}

describe('Admin Users', () => {
  it('opens the existing user list by default', () => {
    const element = mount()
    expect(element.querySelector('[data-test="users"]')).not.toBeNull()
    expect(element.querySelector('[data-test="invitations"]')).toBeNull()
  })

  it('shows invitations without leaving Users', async () => {
    const element = mount()
    await click(element, 'Invitations')
    expect(element.querySelector('[data-test="invitations"]')).not.toBeNull()
    expect(element.querySelector('[data-test="users"]')).toBeNull()
  })

  it('opens invitations after adding a user', async () => {
    const element = mount()
    await click(element, 'Add user')
    await click(element, 'Finish adding')
    expect(element.querySelector('[data-test="invitations"]')).not.toBeNull()
  })
})
