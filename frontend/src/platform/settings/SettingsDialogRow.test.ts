import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'

import { openSettings, settingsSection } from '@/platform/settings'

import SettingsDialogRow from './SettingsDialogRow.vue'

vi.mock('frappe-ui', () => ({
  Button: defineComponent({
    props: { label: { type: String, default: '' } },
    setup(props) {
      return () => h('button', props.label)
    },
  }),
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
  SettingsRow: defineComponent({
    props: { title: { type: String, default: '' } },
    setup(props, { slots }) {
      return () => h('section', [props.title, slots.default?.()])
    },
  }),
}))

let app: ReturnType<typeof createApp>
/** Mail's Import and export page; gives back the open dialogs' titles. */
function showPage() {
  const root = document.createElement('div')
  app = createApp({
    render: () => [
      h(SettingsDialogRow, {
        title: 'Import',
        action: 'Import',
        section: 'mail.import-export.import',
      }),
      h(SettingsDialogRow, {
        title: 'Export',
        action: 'Export',
        section: 'mail.import-export.export',
      }),
    ],
  })
  app.mount(root)
  return () =>
    Array.from(root.querySelectorAll('dialog')).map((dialog) => dialog.getAttribute('aria-label'))
}

beforeEach(() => {
  window.__ = (text: string) => text
  settingsSection.value = undefined
})
afterEach(() => app.unmount())

it('opens the dialog of the section Settings was opened on, and no other', () => {
  openSettings('mail.import-export', 'export')
  expect(showPage()()).toEqual(['Export'])
})
it('opens a section asked for while its page is showing', async () => {
  const opened = showPage()
  expect(opened()).toEqual([])
  openSettings('mail.import-export', 'import')
  await nextTick()
  expect(opened()).toEqual(['Import'])
})
it('opens a section once: its page shown again later stays closed', () => {
  openSettings('mail.import-export', 'export')
  showPage()
  app.unmount()
  expect(showPage()()).toEqual([])
})
it('leaves closed the section of the same name on another tab', () => {
  openSettings('calendar.advanced', 'import')
  expect(showPage()()).toEqual([])
})
it('opens no section when Settings is opened on a tab alone', () => {
  openSettings('mail.import-export', 'import')
  openSettings('mail.import-export')
  expect(showPage()()).toEqual([])
})
