import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import InboxCategorySettings from './InboxCategorySettings.vue'

const state = vi.hoisted(() => ({
  user: { email_classification: true, split_inbox: 1, inbox_tabs: [''], all_mail_tab: 1 },
  save: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ userResource: { data: state.user } }),
}))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('@/api', () => ({
  api: { mail: { settings: { updatePreferences: 'update_preferences' } } },
  client: { mutation: (reference: string, input: unknown) => state.save(reference, input) },
}))
vi.mock('frappe-ui', () => ({
  Switch: { render: () => null },
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' } },
    setup(props) {
      return () => h('section', props.title)
    },
  }),
  Checkbox: defineComponent({
    props: { modelValue: Boolean, disabled: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () =>
        h('input', {
          type: 'checkbox',
          checked: props.modelValue,
          disabled: props.disabled,
          onChange: (event: Event) =>
            emit('update:modelValue', requireTestElement(event.target, HTMLInputElement).checked),
        })
    },
  }),
}))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(InboxCategorySettings)
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  return root
}

// A category's check box, found by the card that names it
function box(root: HTMLElement, category: string) {
  const card = Array.from(root.querySelectorAll('label')).find((label) =>
    label.textContent.includes(category),
  )

  return requireTestElement(card?.querySelector('input'), HTMLInputElement)
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.user = {
    email_classification: true,
    split_inbox: 1,
    inbox_tabs: ['primary', 'updates', 'forums', 'promotions', 'social'],
    all_mail_tab: 1,
  }
  state.save.mockReset().mockResolvedValue(undefined)
})
afterEach(() => app.unmount())

it('saves a category as its box is unticked, keeping the others', () => {
  const forums = box(mount(), 'Forums')
  forums.checked = false
  forums.dispatchEvent(new Event('change'))
  expect(state.save).toHaveBeenCalledWith('update_preferences', {
    inbox_tabs: ['primary', 'updates', 'promotions', 'social'],
  })
})
it('holds the last category on: the switch is the way to one list', () => {
  state.user.inbox_tabs = ['primary', 'promotions']
  const root = mount()
  expect(box(root, 'Promotions').disabled).toBe(true)
  expect(box(root, 'Updates').disabled).toBe(false)
})
it('shows no category to tick while the Inbox is one list, nor the All mail tab', () => {
  state.user.split_inbox = 0
  const root = mount()
  expect(root.textContent).toContain('Split Inbox into categories')
  expect(root.textContent).not.toContain('All mail tab')
  expect(root.querySelector('input')).toBeNull()
})
it('offers the All mail tab while the Inbox is split', () => {
  expect(mount().textContent).toContain('All mail tab')
})
it('shows nothing on a site that does not sort mail into categories', () => {
  state.user.email_classification = false
  expect(mount().textContent).toBe('')
})
