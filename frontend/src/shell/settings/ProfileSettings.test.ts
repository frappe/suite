import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'

import { openSettings, settingsSection } from '@/platform/settings'

import ProfileSettings from './ProfileSettings.vue'

vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))
vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: { value: { id: 'maya@example.com' } } }),
}))
vi.mock('@/api', () => ({
  api: { suite: { preferences: { get: {}, update: {} }, account: { changePassword: {} } } },
  useQuery: () =>
    reactive({ data: { first_name: 'Maya', last_name: '', email: 'maya@example.com' } }),
  useMutation: () => reactive({ isPending: false, error: null, run: async () => {} }),
  client: { mutation: async () => {} },
}))
// The parts this file doesn't open
vi.mock('@/shell/settings/SettingsTabHeader.vue', () => ({ default: { render: () => null } }))
vi.mock('@/shell/settings/SettingsTabContent.vue', () => ({
  default: {
    setup:
      (_: unknown, { slots }: { slots: { default?: () => unknown } }) =>
      () =>
        h('div', slots.default?.() as never),
  },
}))
vi.mock('frappe-ui', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Avatar: { render: () => null },
  Button: { render: () => null },
  Dropdown: { render: () => null },
  ErrorMessage: { render: () => null },
  FileUploader: { render: () => null },
  FormControl: { render: () => null },
  SettingsRow: { render: () => null },
  Dialog: defineComponent({
    props: { open: Boolean, title: { type: String, default: '' } },
    setup(props) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title })
      }
    },
  }),
}))

let app: ReturnType<typeof createApp>
/** Shows the page and gives back the title of its open dialog, if any. */
function openDialog() {
  const root = document.createElement('div')
  app = createApp(ProfileSettings)
  app.mount(root)
  return root.querySelector('dialog')?.getAttribute('aria-label')
}

beforeEach(() => {
  settingsSection.value = undefined
})
afterEach(() => app.unmount())

it('opens the password dialog when Settings is opened on Password', () => {
  openSettings('account.profile', 'password')
  expect(openDialog()).toBe('Change password')
})
it('opens no dialog when Settings is opened on the page alone', () => {
  openSettings('account.profile')
  expect(openDialog()).toBeUndefined()
})
