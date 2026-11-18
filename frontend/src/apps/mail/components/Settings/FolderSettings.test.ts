import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

import { requireTestElement } from '@/platform/testing/dom'

import FolderSettings from './FolderSettings.vue'

vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({
    mailboxes: {
      data: [
        { name: 'in', _name: 'Inbox', role: 'inbox', subscribed: true },
        { name: 'rc', _name: 'Receipts', role: null, subscribed: true },
      ],
    },
  }),
}))
vi.mock('@/api', () => ({
  api: { mail: { mailboxes: { subscribe: {} } } },
  useMutation: () => ({ run: vi.fn() }),
}))
vi.mock('@/apps/mail/utils', () => ({ getIcon: () => 'folder' }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
// The dialogs a folder's line opens, which these tests don't open
vi.mock('@/apps/mail/components/Modals/FolderModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/Modals/DeleteFolderModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/platform/settings/SettingsDialogActions.vue', () => ({
  default: { render: () => null },
}))
interface Option {
  label: string
  condition?: () => boolean
}
// A folder's menu as the real one once opened: a line for each option whose condition holds
vi.mock('@/platform/feedback', () => ({
  Dropdown: defineComponent({
    props: { options: { type: Array<Option>, default: () => [] } },
    setup(props) {
      return () =>
        h(
          'menu',
          props.options
            .filter((option) => option.condition?.() ?? true)
            .map((option) => h('li', option.label)),
        )
    },
  }),
}))

let app: ReturnType<typeof createApp>
function menuOf(folder: string) {
  const root = document.createElement('div')
  app = createApp(FolderSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  const line = Array.from(root.querySelectorAll('span'))
    .find((name) => name.textContent === folder)
    ?.closest('.justify-between')
  const menu = requireTestElement(line?.querySelector('menu'), HTMLElement)

  return Array.from(menu.querySelectorAll('li')).map((item) => item.textContent)
}

beforeEach(() => {
  window.__ = (text: string) => text
})
afterEach(() => app.unmount())

it('offers to delete a folder you made', () => {
  expect(menuOf('Receipts')).toContain('Delete')
})
it('offers no Delete for a built-in folder, which the server keeps', () => {
  expect(menuOf('Inbox')).toEqual(['Hide'])
})
