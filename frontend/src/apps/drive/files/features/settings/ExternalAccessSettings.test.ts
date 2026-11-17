import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, reactive } from 'vue'

import ExternalAccessSettings from './ExternalAccessSettings.vue'

const state = vi.hoisted(() => ({ webdav: { data: {} } }))
vi.mock('@/api', () => ({
  api: {
    drive: { webdav: { get: {} }, siteSettings: { update: {} }, settings: { update: {} } },
    suite: { account: { generateKeys: {} } },
  },
  useQuery: () => reactive(state.webdav),
  useMutation: () => reactive({ isPending: false, run: vi.fn() }),
}))
vi.mock('frappe-ui', () => {
  const titled = defineComponent({
    setup(_, { attrs, slots }) {
      return () => h('div', [String(attrs.title ?? attrs.label ?? ''), slots.default?.()])
    },
  })
  const empty = defineComponent({ render: () => null })
  return {
    Button: titled,
    Dialog: empty,
    SettingsBody: titled,
    SettingsHeader: titled,
    SettingsRow: titled,
    Switch: empty,
  }
})
vi.mock('../../internal/locations', () => ({ locationLabel: () => 'Shared files' }))
vi.mock('./CopyField.vue', () => ({
  default: defineComponent({
    setup:
      (_, { attrs }) =>
      () =>
        h('div', `${String(attrs.label)}: ${String(attrs.value)}`),
  }),
}))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(ExternalAccessSettings)
  app.mount(root)
  return root
}

beforeEach(() => {
  window.__ = (text: string) => text
})
afterEach(() => app.unmount())

const MEMBER = {
  globally_enabled: true,
  enabled_for_user: true,
  server_url: 'https://suite.test/dav',
  username: 'maya@suite.test',
}

it('offers an admin the site switch while WebDAV is off', () => {
  state.webdav = { data: { is_admin: true, globally_enabled: false } }
  const text = mount().textContent

  expect(text).toContain('External access')
  expect(text).toContain('Let everyone connect file apps')
  expect(text).not.toContain('Server URL')
})

it('gives a member the connection details, without the site switch', () => {
  state.webdav = { data: MEMBER }
  const text = mount().textContent

  expect(text).toContain('Server URL: https://suite.test/dav')
  expect(text).toContain('Username: maya@suite.test')
  expect(text).toContain('Your Suite password, or an API key.')
  expect(text).not.toContain('Let everyone connect file apps')
})

it("keeps the connection details back until the user's own switch is on", () => {
  state.webdav = { data: { ...MEMBER, enabled_for_user: false } }
  const text = mount().textContent

  expect(text).toContain('Connect file apps')
  expect(text).not.toContain('Server URL')
  expect(text).not.toContain('Generate API key')
})

it('sends a two-factor user to an API key, as their password will not sign in', () => {
  state.webdav = { data: { ...MEMBER, two_factor_blocked: true } }
  const text = mount().textContent

  expect(text).toContain('Use an API key.')
  expect(text).not.toContain('Your Suite password')
})
