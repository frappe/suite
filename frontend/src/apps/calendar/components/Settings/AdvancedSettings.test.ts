import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import AdvancedSettings from './AdvancedSettings.vue'

const state = vi.hoisted(() => ({ config: { server_url: '', calendar_url: '', username: '' } }))
// The parts this file doesn't open
vi.mock('./ImportSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('./ExportSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('@/api', () => ({
  api: { mail: { calendar: { clientConfig: { id: 'client_config' } } } },
  useQuery: () => reactive({ data: state.config }),
}))
vi.mock('frappe-ui', () => ({
  SettingsHeader: { render: () => null },
  SettingsBody: defineComponent({
    setup(_, { slots }) {
      return () => h('main', slots.default?.())
    },
  }),
  Button: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('button', props.label)
    },
  }),
  Dialog: defineComponent({
    props: { open: Boolean, title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => {
        if (!props.open) {
          return null
        }

        return h('dialog', { 'aria-label': props.title }, slots.default?.())
      }
    },
  }),
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => h('section', [props.title, slots.default?.()])
    },
  }),
}))

let app: ReturnType<typeof createApp>
function mount() {
  const root = document.createElement('div')
  app = createApp(AdvancedSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.config.errorHandler = vi.fn()
  app.mount(root)
  return root
}

beforeEach(() => {
  window.__ = (text: string) => text
  state.config = { server_url: '', calendar_url: '', username: '' }
})
afterEach(() => app.unmount())

it('leaves out Calendar client setup on a site with no CalDAV server', () => {
  const root = mount()
  expect(root.textContent).not.toContain('Calendar client setup')
  expect(root.textContent).toContain('Import')
  expect(root.textContent).toContain('Export')
})
it('shows the CalDAV details once Calendar client setup is opened', async () => {
  state.config = {
    server_url: 'https://dav.example.com',
    calendar_url: 'https://dav.example.com/maya/personal',
    username: 'maya@example.com',
  }
  const root = mount()
  expect(root.textContent).not.toContain('https://dav.example.com')
  const row = Array.from(root.querySelectorAll('section')).find((section) =>
    section.textContent.startsWith('Calendar client setup'),
  )
  requireTestElement(row?.querySelector('button'), HTMLButtonElement).click()
  await nextTick()
  const dialog = requireTestElement(root.querySelector('dialog'), HTMLElement)
  expect(dialog.textContent).toContain('https://dav.example.com/maya/personal')
  expect(dialog.textContent).toContain('maya@example.com')
})
