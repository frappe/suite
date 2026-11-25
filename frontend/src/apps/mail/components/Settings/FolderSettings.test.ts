import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type SetupContext } from 'vue'

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
// The dialog a folder is edited in, which names its folder
vi.mock('@/apps/mail/components/Modals/FolderModal.vue', () => ({
  default: defineComponent({
    props: { modelValue: Boolean, mailbox: { type: Object, default: undefined } },
    setup(props) {
      return () => h('dialog', { open: props.modelValue }, props.mailbox?._name)
    },
  }),
}))
vi.mock('@/apps/mail/components/Modals/DeleteFolderModal.vue', () => ({
  default: { render: () => null },
}))
// The tab's frame, which shows what it holds
const frame = vi.hoisted(() => ({
  setup:
    (_: unknown, { slots }: SetupContext) =>
    () =>
      h('div', slots.default?.()),
}))
vi.mock('@/platform/settings/SettingsPage.vue', () => ({ default: frame }))
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
let root: HTMLElement
function nameOf(folder: string) {
  root = document.createElement('div')
  app = createApp(FolderSettings)
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)

  return Array.from(root.querySelectorAll('span')).find((name) => name.textContent === folder)
}

function menuOf(folder: string) {
  const line = nameOf(folder)?.closest('button')?.parentElement
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
  expect(menuOf('Inbox')).toEqual(['Edit', 'Hide'])
})
it('opens a folder to edit when its line is pressed', async () => {
  requireTestElement(nameOf('Receipts')?.closest('button'), HTMLElement).click()
  await nextTick()

  expect(root.querySelector('dialog[open]')?.textContent).toBe('Receipts')
})
